import { useState, useEffect } from "react";
import { llmApi } from "../../../shared/api/llm";

interface Provider {
  name: string; display_name: string; default_base_url: string;
  models: string[]; requires_api_key: boolean;
}
interface Config {
  id: string; provider: string; model_name: string; base_url: string;
  temperature: number; max_tokens: number; is_default: boolean; has_api_key: boolean;
}

export default function LLMConfig() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [tab, setTab] = useState<"configs" | "add" | "test">("configs");
  const [selProvider, setSelProvider] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testing, setTesting] = useState(false);
  const [modelWarning, setModelWarning] = useState<string | null>(null);

  useEffect(() => {
    llmApi.getProviders().then((r) => setProviders(r.data.providers || r.data || [])).catch(() => {});
    loadConfigs();
  }, []);

  const loadConfigs = () => {
    llmApi.getConfig().then((r) => setConfigs(r.data.configs || r.data || [])).catch(() => {});
  };

  useEffect(() => {
    if (selProvider) {
      llmApi.getModels(selProvider).then((r) => {
        setModels(r.data.models || []);
        setModelWarning(r.data.warning || null);
        if (r.data.models?.length) setModelName(r.data.models[0]);
      }).catch(() => { setModels([]); setModelWarning(null); });
      const p = providers.find((p) => p.name === selProvider);
      if (p) setBaseUrl(p.default_base_url || "");
    } else {
      setModelWarning(null);
    }
  }, [selProvider, providers]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await llmApi.saveConfig({
        provider: selProvider, model_name: modelName,
        api_key: apiKey || undefined, base_url: baseUrl || undefined,
        temperature, max_tokens: maxTokens, is_default: isDefault,
      });
      loadConfigs();
      setTab("configs");
      setApiKey("");
    } catch { alert("Failed to save"); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await llmApi.test({
        provider: selProvider, model_name: modelName,
        api_key: apiKey || undefined, base_url: baseUrl || undefined,
      });
      setTestResult(res.data);
    } catch (err: unknown) {
      setTestResult({ error: (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Test failed" });
    }
    finally { setTesting(false); }
  };

  const handleDelete = async (provider: string) => {
    if (!confirm(`Delete ${provider} config?`)) return;
    try { await llmApi.deleteConfig(provider); loadConfigs(); }
    catch { alert("Failed"); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>LLM Configuration</h1>
        <p>Manage AI provider connections and model settings</p>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "configs" ? "tab--active" : ""}`} onClick={() => setTab("configs")}>Configurations</button>
        <button className={`tab ${tab === "add" ? "tab--active" : ""}`} onClick={() => setTab("add")}>Add / Edit</button>
        <button className={`tab ${tab === "test" ? "tab--active" : ""}`} onClick={() => setTab("test")}>Test Connection</button>
      </div>

      {tab === "configs" && (
        <div className="card">
          {configs.length === 0 ? (
            <div className="empty-state">
              <h3>No configurations</h3>
              <p>Add an LLM provider to get started</p>
              <button className="btn btn--primary" style={{marginTop: 12}} onClick={() => setTab("add")}>Add Provider</button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Provider</th><th>Model</th><th>Temp</th><th>Max Tokens</th><th>Default</th><th>API Key</th><th></th></tr></thead>
                <tbody>
                  {configs.map((c) => (
                    <tr key={c.id}>
                      <td style={{color:"var(--dash-text)", fontWeight: 600}}>{c.provider}</td>
                      <td>{c.model_name}</td>
                      <td>{c.temperature}</td>
                      <td>{c.max_tokens}</td>
                      <td>{c.is_default ? <span className="badge badge--success">Default</span> : "\u2014"}</td>
                      <td>{c.has_api_key ? <span className="badge badge--info">Set</span> : <span className="badge badge--neutral">None</span>}</td>
                      <td><button className="btn btn--sm btn--danger" onClick={() => handleDelete(c.provider)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(tab === "add" || tab === "test") && (
        <div className="card">
          <div className="input-group">
            <label>Provider</label>
            <select value={selProvider} onChange={(e) => setSelProvider(e.target.value)}>
              <option value="">Select provider</option>
              {providers.map((p) => <option key={p.name} value={p.name}>{p.display_name || p.name}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label>Model</label>
            {models.length > 0 ? (
              <select value={modelName} onChange={(e) => setModelName(e.target.value)}>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Model name" />
            )}
            {modelWarning && (
              <div style={{marginTop: 6, fontSize: 13, color: "var(--dash-warning, var(--dash-text-secondary))"}}>
                {modelWarning}
              </div>
            )}
          </div>
          <div className="input-group">
            <label>API Key</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          </div>
          <div className="input-group">
            <label>Base URL</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.provider.com/v1" />
          </div>

          {tab === "add" && (
            <>
              <div className="form-row">
                <div className="input-group">
                  <label>Temperature</label>
                  <input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(+e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Max Tokens</label>
                  <input type="number" min={1} value={maxTokens} onChange={(e) => setMaxTokens(+e.target.value)} />
                </div>
              </div>
              <label style={{display:"flex", alignItems:"center", gap: 8, fontSize: 14, color: "var(--dash-text-secondary)", marginBottom: 16}}>
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Set as default provider
              </label>
              <button className="btn btn--primary" onClick={handleSave} disabled={!selProvider || !modelName || saving}>
                {saving ? "Saving..." : "Save Configuration"}
              </button>
            </>
          )}

          {tab === "test" && (
            <>
              <button className="btn btn--primary" onClick={handleTest} disabled={!selProvider || !modelName || testing}>
                {testing ? "Testing..." : "Test Connection"}
              </button>
              {testResult && (
                <pre style={{marginTop: 16, fontSize: 13, color: "var(--dash-text-secondary)", overflow: "auto", whiteSpace: "pre-wrap"}}>
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
