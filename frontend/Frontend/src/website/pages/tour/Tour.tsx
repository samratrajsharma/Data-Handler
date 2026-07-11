import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import OrchestrateIcon from '../../../shared/Logo/AntigravityLogo';
import InstallPill from '../../components/InstallPill/InstallPill';
import './Tour.css';

// ─────────────────────────────────────────────────────────────────
// /tour — scroll-driven product walkthrough. Each step slides one clean
// dashboard window into view (real logo + sidebar, no browser chrome).
// Tab-rich screens auto-cycle their tabs with a visible progress cue.
// 10 stages: Dashboard → Datasets → Structuring → EDA → Labeling →
// AI Labeling → Images → Review & Export → Workflows → LLM Config.
// ─────────────────────────────────────────────────────────────────

interface ScreenProps { active?: boolean; }
interface NavItem { key: string; label: string; icon: string; }

const NAV: NavItem[] = [
  { key: 'dashboard',   label: 'Dashboard',       icon: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zm0 11h7v7h-7v-7zM3 14h7v7H3v-7z' },
  { key: 'datasets',    label: 'Datasets',        icon: 'M12 2C6.48 2 2 4 2 6.5v11C2 20 6.48 22 12 22s10-2 10-4.5v-11C22 4 17.52 2 12 2zM2 9.5c0 2.5 4.48 4.5 10 4.5s10-2 10-4.5' },
  { key: 'structuring', label: 'Structuring',     icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { key: 'eda',         label: 'EDA',             icon: 'M18 20V10M12 20V4M6 20v-6' },
  { key: 'labeling',    label: 'Labeling',        icon: 'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01' },
  { key: 'ai',          label: 'AI Labeling',     icon: 'M18 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2zM9 9h6v6H9V9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3' },
  { key: 'images',      label: 'Images',          icon: 'M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21' },
  { key: 'review',      label: 'Review & Export', icon: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3' },
  { key: 'workflows',   label: 'Workflows',       icon: 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9' },
  { key: 'llm',         label: 'LLM Config',      icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  { key: 'tasks',       label: 'Tasks',           icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
];

const Sidebar: React.FC<{ active: string }> = ({ active }) => (
  <div className="tw__sidebar">
    <div className="tw__brand"><OrchestrateIcon size={22} /><span>Orchestraty</span></div>
    <nav className="tw__nav">
      {NAV.map((n) => (
        <div key={n.key} className={`tw__navitem${n.key === active ? ' tw__navitem--on' : ''}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg>
          <span>{n.label}</span>
        </div>
      ))}
    </nav>
  </div>
);

// Single clean window — no browser chrome.
const WindowFrame: React.FC<{ active: string; children: React.ReactNode }> = ({ active, children }) => (
  <div className="tw">
    <div className="tw__body">
      <Sidebar active={active} />
      <div className="tw__content">{children}</div>
    </div>
  </div>
);

// Auto-advance helper + tab bar with a visible progress cue.
function useCycle(active: boolean | undefined, n: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    setI(0);
    const id = window.setInterval(() => setI((t) => (t + 1) % n), 1400);
    return () => window.clearInterval(id);
  }, [active, n]);
  return i;
}

const CycleTabs: React.FC<{ tabs: string[]; activeLabel: string; cur: string }> = ({ tabs, activeLabel, cur }) => (
  <div className="cyc">
    <div className="cyc__bar">
      {tabs.map((t) => (<span key={t} className={`cyc__tab${activeLabel === t ? ' cyc__tab--on' : ''}`}>{t}</span>))}
      <span className="cyc__auto"><span className="cyc__autodot" />auto</span>
    </div>
    <div className="cyc__track"><span className="cyc__fill" key={cur} /></div>
  </div>
);

// ── Dashboard ────────────────────────────────────────────────────
const DASH_QA = [
  { label: 'New Dataset', desc: 'Ingest a CSV or JSON file', color: '#1DB954', icon: 'M12 5v14M5 12h14' },
  { label: 'Run Workflow', desc: 'Orchestrate a pipeline', color: '#1ED760', icon: 'M8 5v14l11-7z' },
  { label: 'Configure LLM', desc: 'Connect model providers', color: '#f5b14b', icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  { label: 'Image Pipeline', desc: 'Upload & embed images', color: '#34d399', icon: 'M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21' },
];
const DASH_TASKS: [string, string][] = [['labeling', 'completed'], ['eda', 'completed'], ['structuring', 'completed']];

const DashboardScreen: React.FC<ScreenProps> = () => (
  <div className="scr">
    <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
      <div><div className="scr__h1">Welcome back</div><div className="scr__sub">Here’s what’s happening across your workspace</div></div>
    </div>
    <div className="dash-two">
      <div className="card a-fade" style={{ animationDelay: '0.15s' }}>
        <div className="card__label">Quick Actions</div>
        <div className="dash-qa">
          {DASH_QA.map((q, i) => (
            <div key={q.label} className="dash-qa-tile a-fade" style={{ animationDelay: `${0.2 + i * 0.06}s` }}>
              <span className="dash-qa-ico" style={{ background: `${q.color}22`, color: q.color }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={q.icon} /></svg>
              </span>
              <div><div className="dash-qa-t">{q.label}</div><div className="dash-qa-d">{q.desc}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="card a-fade" style={{ animationDelay: '0.2s' }}>
        <div className="lbl-resit" style={{ marginBottom: '10px' }}><div className="card__label" style={{ margin: 0 }}>Recent Tasks</div><span className="btn btn--ghost btn--xs">View all</span></div>
        <table className="tbl">
          <thead><tr><th>TYPE</th><th>STATUS</th><th>CREATED</th></tr></thead>
          <tbody>
            {DASH_TASKS.map((t, i) => (
              <tr key={i} className="a-row" style={{ animationDelay: `${0.25 + i * 0.06}s` }}>
                <td>{t[0]}</td><td><span className="pill pill--ok">● {t[1]}</span></td><td>6/17/2026</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

// ── Datasets (tabular + image dataset) ───────────────────────────
const DS_COLS = ['age', 'gender', 'daily_social_media_hours', 'platform_usage', 'sleep_hours', 'stress_level', 'anxiety_level', 'depression_label'];
const DS_ROWS = [
  ['14', 'male', '7.9', 'Instagram', '7.4', '2', '2', '0'],
  ['19', 'female', '1.9', 'TikTok', '8.0', '8', '1', '0'],
  ['17', 'female', '1.3', 'Instagram', '7.6', '2', '4', '0'],
  ['15', 'male', '7.4', 'TikTok', '6.9', '1', '7', '0'],
  ['15', 'female', '4.7', 'Both', '4.9', '3', '5', '0'],
  ['19', 'female', '7.4', 'Both', '4.4', '3', '5', '0'],
  ['18', 'female', '2.5', 'Instagram', '6.4', '2', '2', '0'],
];
const DS_THUMBS = ['#1AA34A', '#3a5a4a', '#6b4a2a', '#4a6b3a', '#1AA34A'];

const DatasetsScreen: React.FC<ScreenProps> = () => (
  <div className="scr">
    <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
      <div><div className="scr__h1">Datasets</div><div className="scr__sub">Your data assets — each shows a live preview right here</div></div>
      <span className="btn btn--primary">+ New Dataset</span>
    </div>

    <div className="card a-fade" style={{ animationDelay: '0.12s' }}>
      <div className="card__head">
        <span className="card__icon" style={{ background: 'rgba(29, 185, 84, 0.08)', color: '#8fe6f5' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21" /></svg>
        </span>
        <div style={{ flex: 1 }}><div className="card__title">cat-g0fcd844a4_640 (images)</div><div className="card__meta">Image dataset · 80 images · created just now</div></div>
        <span className="pill pill--mut">Raw</span><span className="link">Open →</span>
      </div>
      <div className="ds-imgs">
        {DS_THUMBS.map((c, i) => (<div key={i} className="ds-img a-fade" style={{ background: `linear-gradient(135deg, ${c}, #1c1c28)`, animationDelay: `${0.2 + i * 0.05}s` }} />))}
        <div className="ds-img ds-img--more">+74 more</div>
      </div>
    </div>

    <div className="card a-fade" style={{ animationDelay: '0.22s', marginTop: '12px' }}>
      <div className="card__head">
        <span className="card__icon" style={{ background: 'rgba(29, 185, 84, 0.08)', color: '#4ADE80' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2C6.48 2 2 4 2 6.5v11C2 20 6.48 22 12 22s10-2 10-4.5v-11C22 4 17.52 2 12 2zM2 9.5c0 2.5 4.48 4.5 10 4.5s10-2 10-4.5" /></svg>
        </span>
        <div style={{ flex: 1 }}><div className="card__title">Teen</div><div className="card__meta">Tabular dataset · 1,200 rows · created 10m ago</div></div>
        <span className="pill pill--info">Processed</span><span className="link">Open →</span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr>{DS_COLS.map((c) => <th key={c}>{c.toUpperCase()}</th>)}</tr></thead>
          <tbody>
            {DS_ROWS.map((r, i) => (
              <tr key={i} className="a-row" style={{ animationDelay: `${0.3 + i * 0.04}s` }}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="scr__foot">13 columns · showing first 10 of 1,200 rows&nbsp;&nbsp;← scroll →</div>
    </div>

    <div className="dropzone a-fade" style={{ animationDelay: '0.55s' }}>
      <span className="dropzone__plus">+</span><span>Add another dataset</span>
      <span className="dropzone__hint">CSV, JSON, JSONL, TSV, TXT, or images</span>
    </div>
  </div>
);

// ── Structuring (auto-cycle Visual / Steps / Raw JSON) ───────────
const AUDIT = [
  { col: 'age', type: 'NUMERIC', distinct: '7 distinct', action: 'Looks clean', clean: true },
  { col: 'gender', type: 'TEXT', distinct: '2 distinct', action: 'Encode as onehot (2 categories)', clean: false },
  { col: 'daily_social_media_hours', type: 'NUMERIC', distinct: '71 distinct', action: 'Looks clean', clean: true },
  { col: 'platform_usage', type: 'TEXT', distinct: '3 distinct', action: 'Encode as onehot (3 categories)', clean: false },
];
const STAT_CARDS = [{ n: '1,200', l: 'Original Rows' }, { n: '1,200', l: 'Final Rows' }, { n: '0', l: 'Rows Removed' }, { n: '0', l: 'Nulls Handled' }];
const PIPELINE = [
  { t: 'Encode Categorical', d: 'gender, platform_usage, social_interaction_level → one-hot' },
  { t: 'Remove Duplicates', d: 'Removed 0 duplicate rows' },
  { t: 'Handle Nulls', d: 'Strategy: fill_mode · 0 → 0' },
  { t: 'Normalize Text', d: 'Trimmed whitespace in 0 columns' },
];
const ST_CYCLE = ['visual', 'steps', 'json'] as const;
const ST_BAR = ['Visual', 'Steps', 'Raw JSON'];
const ST_LABEL: Record<string, string> = { visual: 'Visual', steps: 'Steps', json: 'Raw JSON' };
const ST_JSON = `{
  "quality_score": 99,
  "grade": "A",
  "rows": { "in": 1200, "out": 1200 },
  "columns": { "in": 13, "out": 18 },
  "nulls_handled": 0,
  "encoded": ["gender", "platform_usage", "social_interaction_level"]
}`;

const StVisual: React.FC = () => (
  <>
    <div className="qscore"><span className="qscore__label">Data Quality Score</span><span className="qscore__val a-pop">99 · Grade A</span></div>
    <div className="st-stats">
      {STAT_CARDS.map((s) => (<div key={s.l} className="st-stat"><div className="st-stat__n">{s.n}</div><div className="st-stat__l">{s.l}</div></div>))}
    </div>
    <div className="ret">
      <div className="ret__top"><span>Data Retention</span><span className="ret__pct">100%</span></div>
      <div className="ret__bar"><div className="ret__fill a-bar" /></div>
      <div className="ret__note">13 columns → 18 final columns</div>
    </div>
  </>
);
const StSteps: React.FC = () => (
  <>
    {PIPELINE.map((p) => (<div key={p.t} className="pl"><span className="pl__dot" /><div><div className="pl__t">{p.t}</div><div className="pl__d">{p.d}</div></div></div>))}
  </>
);
const StJson: React.FC = () => (<pre className="st-json">{ST_JSON}</pre>);

const StructuringScreen: React.FC<ScreenProps> = ({ active }) => {
  const cur = ST_CYCLE[useCycle(active, ST_CYCLE.length)];
  return (
    <div className="scr">
      <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
        <div><div className="scr__h1">Data Structuring</div><div className="scr__sub">Clean, normalize, and structure your datasets</div></div>
      </div>
      <div className="st-grid">
        <div className="card a-fade" style={{ animationDelay: '0.15s' }}>
          <div className="card__label">Configuration</div>
          <div className="select">Teen <span className="select__chev">▾</span></div>
          <div className="reco">
            <div className="reco__head"><span className="reco__title">⚡ Recommended for this dataset</span><span className="btn btn--primary btn--xs">Apply all</span></div>
            <div className="reco__chips">
              <span className="chip chip--ghost">Encode “gender” → one-hot</span>
              <span className="chip chip--ghost">Encode “platform_usage” → one-hot</span>
              <span className="chip chip--ghost">Encode “social_interaction_level” → one-hot</span>
            </div>
          </div>
          <div className="audit__head">Per-column audit <span>13 columns · click an action to apply</span></div>
          {AUDIT.map((a, i) => (
            <div key={a.col} className="audit a-fade" style={{ animationDelay: `${0.3 + i * 0.07}s` }}>
              <div className="audit__row"><span className="audit__col">{a.col}</span><span className="audit__type">{a.type}</span><span className="audit__distinct">{a.distinct}</span></div>
              <span className={`chip ${a.clean ? 'chip--ok' : 'chip--act'}`}>{a.action}</span>
            </div>
          ))}
          <div className="card__label" style={{ marginTop: '14px' }}>Null Handling Strategy</div>
          <div className="select">Fill with Mode <span className="select__chev">▾</span></div>
          <div className="checks">
            <label className="check"><span className="check__box check__box--on">✓</span> Remove Duplicates</label>
            <label className="check"><span className="check__box" /> Handle Outliers</label>
            <label className="check"><span className="check__box" /> Standardize Column Names</label>
          </div>
        </div>

        <div className="card a-fade" style={{ animationDelay: '0.2s' }}>
          <div className="st-actions"><span className="btn btn--ghost btn--xs">⬇ Download cleaned CSV</span><span className="btn btn--primary btn--xs">Continue to EDA →</span></div>
          <CycleTabs tabs={ST_BAR} activeLabel={ST_LABEL[cur]} cur={cur} />
          <div className="st-panel"><div className="eda-in" key={cur}>
            {cur === 'visual' && <StVisual />}
            {cur === 'steps' && <StSteps />}
            {cur === 'json' && <StJson />}
          </div></div>
        </div>
      </div>
    </div>
  );
};

// ── EDA ──────────────────────────────────────────────────────────
const EDA_CYCLE = ['overview', 'columns', 'correlations', 'graphs'] as const;
const EDA_TAB_BAR = ['Overview', 'Columns', 'Correlations', 'Distributions', 'Graphs', 'Raw JSON'];
const TAB_LABEL: Record<string, string> = { overview: 'Overview', columns: 'Columns', correlations: 'Correlations', graphs: 'Graphs' };
interface ColCard { kind: 'num' | 'cat'; name: string; nulls?: string; unique?: string; mean?: string; std?: string; skew?: string; cats?: [string, number][]; }
const COL_CARDS: ColCard[] = [
  { kind: 'num', name: 'age', nulls: '0 (0%)', unique: '7', mean: '15.928', std: '2.022', skew: '0.017' },
  { kind: 'cat', name: 'gender', cats: [['male', 615], ['female', 585]] },
  { kind: 'num', name: 'daily_social_media_hours', nulls: '0 (0%)', unique: '71', mean: '4.537', std: '2.030', skew: '0.009' },
  { kind: 'cat', name: 'platform_usage', cats: [['Both', 391], ['TikTok', 398], ['Instagram', 411]] },
  { kind: 'num', name: 'sleep_hours', nulls: '0 (0%)', unique: '51', mean: '6.449', std: '1.443', skew: '0.017' },
  { kind: 'cat', name: 'social_interaction_level', cats: [['low', 415], ['high', 369], ['medium', 416]] },
];
const HLAB = ['age', 'slp', 'str', 'anx', 'add', 'dep', 'phy'];
const MAT: number[][] = [
  [1.00, 0.00, -0.03, 0.03, 0.04, 0.01, 0.01],
  [0.00, 1.00, -0.01, -0.01, -0.05, -0.19, 0.01],
  [-0.03, -0.01, 1.00, 0.02, -0.00, 0.17, 0.01],
  [0.03, -0.01, 0.02, 1.00, 0.03, 0.17, -0.02],
  [0.04, -0.05, -0.00, 0.03, 1.00, -0.01, 0.03],
  [0.01, -0.19, 0.17, 0.17, -0.01, 1.00, -0.02],
  [0.01, 0.01, 0.01, -0.02, 0.03, -0.02, 1.00],
];
const CORR: [string, number][] = [
  ['depression_label × sleep_hours', -0.1906],
  ['daily_social_media_hours × depression_label', 0.1752],
  ['depression_label × stress_level', 0.1705],
  ['anxiety_level × depression_label', 0.1696],
  ['age × screen_time_before_sleep', 0.0756],
  ['academic_performance × anxiety_level', -0.0644],
];
function cellStyle(v: number): React.CSSProperties {
  if (v >= 0.999) return { background: 'rgba(22, 22, 22, 0.85)', color: '#06281d' };
  const a = Math.min(0.6, Math.abs(v) * 2.6);
  return { background: v >= 0 ? `rgba(29, 185, 84,${a})` : `rgba(248,113,113,${a})`, color: '#4ADE80' };
}
const DOTS: { x: number; y: number }[] = [];
for (let b = 0; b < 13; b++) { for (let k = 0; k < 7; k++) { DOTS.push({ x: 70 + b * 41 + (k % 3) * 7, y: 36 + ((b * 23 + k * 37) % 210) }); } }

const EdaOverview: React.FC = () => (
  <>
    <div className="eda-block-t">Column Type Distribution</div>
    <div className="eda-typebar"><span className="eda-typebar__num" style={{ width: `${(10 / 13) * 100}%` }} /><span className="eda-typebar__cat" style={{ width: `${(3 / 13) * 100}%` }} /></div>
    <div className="eda-legend"><span><i className="dotp" />numeric (10)</span><span><i className="dotc" />categorical (3)</span></div>
    <div className="eda-block-t" style={{ marginTop: '16px' }}>Missing Values</div>
    <div className="eda-muted">No missing values detected</div>
    <div className="eda-block-t" style={{ marginTop: '16px' }}>Data Quality Warnings</div>
    <div className="eda-warn">⚠ Column ‘depression_label’ has &gt;95% single value (near-constant)</div>
    <div className="eda-warn">⚠ Column ‘depression_label’ has high skewness (5.99)</div>
  </>
);
const EdaColumns: React.FC = () => (
  <div className="eda-cols">
    {COL_CARDS.map((c) => {
      const max = Math.max(...(c.cats ?? []).map((x) => x[1]), 1);
      return (
        <div key={c.name} className="eda-col">
          <div className="eda-col__head"><span className="eda-col__name">{c.name}</span><span className={`eda-col__type eda-col__type--${c.kind}`}>{c.kind === 'num' ? 'Numeric' : 'Categorical'}</span></div>
          {c.kind === 'num' ? (
            <>
              <div className="eda-col__row"><span>NULLS</span><b>{c.nulls}</b></div>
              <div className="eda-col__row"><span>UNIQUE</span><b>{c.unique}</b></div>
              <div className="eda-col__stat3"><span>MEAN<b>{c.mean}</b></span><span>STD<b>{c.std}</b></span><span>SKEW<b>{c.skew}</b></span></div>
            </>
          ) : (
            <div className="eda-cat">
              {(c.cats ?? []).map(([lbl, cnt]) => (
                <div key={lbl} className="eda-cat__row"><span className="eda-cat__lbl">{lbl}</span><span className="eda-cat__bar"><span style={{ width: `${(cnt / max) * 100}%` }} /></span><span className="eda-cat__cnt">{cnt}</span></div>
              ))}
            </div>
          )}
        </div>
      );
    })}
  </div>
);
const EdaCorr: React.FC = () => (
  <>
    <div className="eda-block-t">Numeric Correlation Matrix</div>
    <div className="eda-heat">
      <div className="eda-heat__row"><span className="eda-heat__corner" />{HLAB.map((l) => <span key={l} className="eda-heat__h">{l}</span>)}</div>
      {MAT.map((row, i) => (
        <div key={i} className="eda-heat__row"><span className="eda-heat__h">{HLAB[i]}</span>{row.map((v, j) => <span key={j} className="eda-heat__cell" style={cellStyle(v)}>{v.toFixed(2)}</span>)}</div>
      ))}
    </div>
    <div className="eda-block-t" style={{ marginTop: '14px' }}>Strongest Correlations</div>
    {CORR.map(([k, v]) => (<div key={k} className="eda-corr"><span>{k}</span><b style={{ color: v < 0 ? '#f08a8a' : '#7ff0c6' }}>{v.toFixed(4)}</b></div>))}
  </>
);
const EdaGraphs: React.FC = () => (
  <>
    <div className="eda-chips"><span className="chip2">Bar</span><span className="chip2">Histogram</span><span className="chip2 chip2--on">Scatter</span><span className="chip2">Line</span><span className="btn btn--ghost btn--xs" style={{ marginLeft: 'auto' }}>⬇ Download PNG</span></div>
    <div className="eda-axes"><span>X · screen_time_before_sleep</span><span>Y · daily_social_media_hours</span></div>
    <svg className="eda-scatter" viewBox="0 0 620 280" preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2, 3, 4].map((i) => <line key={i} x1="48" x2="610" y1={30 + i * 52} y2={30 + i * 52} className="eda-gl" />)}
      {DOTS.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="2.6" className="eda-dot" />)}
    </svg>
  </>
);
const EdaScreen: React.FC<ScreenProps> = ({ active }) => {
  const cur = EDA_CYCLE[useCycle(active, EDA_CYCLE.length)];
  return (
    <div className="scr">
      <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
        <div><div className="scr__h1">Exploratory Data Analysis</div><div className="scr__sub">Profile, embed, cluster, and visualize your data</div></div>
      </div>
      <div className="eda-grid">
        <div className="card a-fade" style={{ animationDelay: '0.15s' }}>
          <div className="card__label">Configuration</div>
          <div className="select">Teen <span className="select__chev">▾</span></div>
          <div className="checks" style={{ marginTop: '10px' }}>
            <label className="check"><span className="check__box check__box--on">✓</span> Run Profiling</label>
            <label className="check"><span className="check__box check__box--on">✓</span> Run Embeddings</label>
            <label className="check"><span className="check__box check__box--on">✓</span> Run Clustering</label>
          </div>
          <div className="card__label" style={{ marginTop: '12px' }}>Number of Clusters</div>
          <div className="select">5</div>
          <div className="st-actions" style={{ justifyContent: 'flex-start', marginTop: '12px', flexWrap: 'wrap' }}>
            <span className="btn btn--primary btn--xs">Run EDA</span><span className="btn btn--ghost btn--xs">⬇ Download report ▾</span><span className="btn btn--ghost btn--xs">Continue to Labeling →</span>
          </div>
          <div className="st-stats" style={{ marginTop: '14px' }}>
            <div className="st-stat"><div className="st-stat__n">1,200</div><div className="st-stat__l">Rows</div></div>
            <div className="st-stat"><div className="st-stat__n">13</div><div className="st-stat__l">Columns</div></div>
            <div className="st-stat"><div className="st-stat__n">0.31</div><div className="st-stat__l">MB</div></div>
            <div className="st-stat"><div className="st-stat__n">2</div><div className="st-stat__l">Warnings</div></div>
          </div>
        </div>
        <div className="card a-fade" style={{ animationDelay: '0.2s' }}>
          <CycleTabs tabs={EDA_TAB_BAR} activeLabel={TAB_LABEL[cur]} cur={cur} />
          <div className="eda-panel"><div className="eda-in" key={cur}>
            {cur === 'overview' && <EdaOverview />}
            {cur === 'columns' && <EdaColumns />}
            {cur === 'correlations' && <EdaCorr />}
            {cur === 'graphs' && <EdaGraphs />}
          </div></div>
        </div>
      </div>
    </div>
  );
};

// ── Rule-Based Labeling ──────────────────────────────────────────
const LabelingScreen: React.FC<ScreenProps> = () => (
  <div className="scr">
    <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
      <div><div className="scr__h1">Rule-Based Labeling</div><div className="scr__sub">Define rules to automatically label your data</div></div>
    </div>
    <div className="card a-fade" style={{ animationDelay: '0.15s' }}>
      <div className="lbl-head"><span className="card__label" style={{ margin: 0 }}>Label Rules</span><span className="btn btn--ghost btn--xs">+ Add Rule</span></div>
      <div className="select">Teen <span className="select__chev">▾</span></div>
      <div className="lbl-saved"><div className="select" style={{ flex: 1 }}>— pick a saved set — <span className="select__chev">▾</span></div><span className="btn btn--ghost btn--xs">Save as new</span></div>
      <div className="lbl-tmpl"><span className="lbl-tmpl__k">Quick templates:</span><span className="chip2">Sentiment (positive)</span><span className="chip2">Sentiment (negative)</span><span className="chip2">Category by keyword</span><span className="chip2">Null detection</span><span className="chip2">Compound: female + age 30-45</span></div>
      <div className="rule a-fade" style={{ animationDelay: '0.3s' }}>
        <div className="rule__top"><span className="rule__grip">⋮⋮</span><span className="rule__n">1</span><span className="rule__when">When the condition matches, label as</span><span className="rule__label">Mature Teen</span></div>
        <div className="rule__cond"><span className="select">age <span className="select__chev">▾</span></span><span className="select">greater than <span className="select__chev">▾</span></span><span className="rule__val">15</span></div>
        <div className="rule__hint">Number. This column ranges 13 – 19 (mean 15.9283).</div>
        <span className="rule__add">+ Add condition</span>
      </div>
      <div className="lbl-actions"><span className="select select--sm">First Match <span className="select__chev">▾</span></span><span className="btn btn--ghost btn--xs">Preview on 500 rows</span><span className="btn btn--primary btn--xs">Run Labeling</span></div>
    </div>
    <div className="card a-fade" style={{ animationDelay: '0.4s', marginTop: '12px' }}>
      <div className="lbl-resit"><div className="cyc__bar" style={{ marginBottom: 0 }}><span className="cyc__tab cyc__tab--on">Results</span><span className="cyc__tab">Rule Performance</span><span className="cyc__tab">Raw JSON</span></div><div className="lbl-resit__btns"><span className="btn btn--ghost btn--xs">⬇ Download labeled CSV</span><span className="btn btn--primary btn--xs">Continue to Review →</span></div></div>
      <div className="lbl-stats">
        <div className="lbl-stat"><div className="lbl-stat__n">1,200</div><div className="lbl-stat__l">Total Rows</div></div>
        <div className="lbl-stat"><div className="lbl-stat__n" style={{ color: 'var(--grn)' }}>667</div><div className="lbl-stat__l">Labeled</div></div>
        <div className="lbl-stat"><div className="lbl-stat__n" style={{ color: 'var(--amb)' }}>533</div><div className="lbl-stat__l">Unlabeled</div></div>
        <div className="lbl-stat"><div className="lbl-stat__n">1</div><div className="lbl-stat__l">Rules Used</div></div>
        <div className="lbl-stat"><div className="lbl-stat__n">0</div><div className="lbl-stat__l">Conflicts</div></div>
      </div>
      <div className="ret" style={{ marginTop: '12px' }}><div className="ret__top"><span>Label Coverage</span><span className="ret__pct" style={{ color: 'var(--amb)' }}>56%</span></div><div className="ret__bar"><div className="ret__fill a-bar" style={{ width: '56%', background: 'linear-gradient(90deg, #e0922b, var(--amb))' }} /></div></div>
      <div className="card__label" style={{ marginTop: '12px' }}>Label Distribution</div>
      <div className="lbl-dist"><span className="lbl-dist__lbl">Mature Teen</span><span className="lbl-dist__bar"><span className="a-bar" /></span><span className="lbl-dist__cnt">667</span></div>
    </div>
  </div>
);

// ── AI Labeling ──────────────────────────────────────────────────
const AI_CYCLE = ['predict', 'propagation', 'aggregation', 'synthetic', 'active'] as const;
const AI_TAB_BAR = ['AI Predict', 'Propagation', 'Aggregation', 'Synthetic Data', 'Active Learning'];
const AI_LABEL: Record<string, string> = { predict: 'AI Predict', propagation: 'Propagation', aggregation: 'Aggregation', synthetic: 'Synthetic Data', active: 'Active Learning' };
const AI_RESULTS: [string, string, number][] = [['row 1042 · age 17, high social…', 'at_risk', 0.92], ['row 0337 · age 14, low social…', 'healthy', 0.88], ['row 0915 · age 19, high stress…', 'at_risk', 0.81], ['row 0461 · age 15, medium use…', 'healthy', 0.76]];
const SYN = ['"17yo, 6h daily scroll, poor sleep"', '"15yo, low usage, strong grades"', '"19yo, late-night TikTok, anxious"'];

const AiPredict: React.FC = () => (
  <div className="ai-2col">
    <div>
      <div className="card__label">Configuration</div>
      <div className="ai-field"><span className="ai-field__l">Dataset</span><div className="select">Teen <span className="select__chev">▾</span></div></div>
      <div className="ai-field"><span className="ai-field__l">Text Column</span><div className="select">age <span className="select__chev">▾</span></div></div>
      <div className="ai-field"><span className="ai-field__l">Labels</span><div className="ai-labels"><span className="chip chip--act">at_risk</span><span className="chip chip--act">healthy</span><span className="ai-labels__ph">Type a label…</span></div></div>
      <div className="ai-field2"><div><span className="ai-field__l">LLM Provider</span><div className="select">My default provider <span className="select__chev">▾</span></div></div><div><span className="ai-field__l">Model</span><div className="select select--mut">default model</div></div></div>
      <div className="ai-actions"><span className="btn btn--ghost btn--xs">Preview on 5 rows</span><span className="btn btn--primary btn--xs">Run Full Prediction</span></div>
    </div>
    <div>
      <div className="card__label">Results</div>
      {AI_RESULTS.map((r, i) => (<div key={i} className="ai-res a-fade" style={{ animationDelay: `${0.2 + i * 0.18}s` }}><span className="ai-res__txt">{r[0]}</span><span className="ai-res__lab">{r[1]}</span><span className="ai-res__conf"><span style={{ width: `${r[2] * 100}%` }} /></span><span className="ai-res__pct">{r[2].toFixed(2)}</span></div>))}
    </div>
  </div>
);
const AiPropagation: React.FC = () => (
  <div>
    <div className="ai-lead">Spread a handful of high-confidence labels across similar rows automatically, using embedding similarity.</div>
    <div className="ai-field"><span className="ai-field__l">Allowed labels</span><div className="ai-labels"><span className="chip chip--act">at_risk</span><span className="chip chip--act">healthy</span></div></div>
    <div className="card__label">Aggressiveness</div>
    <div className="ai-presets">
      <div className="ai-preset"><div className="ai-preset__t">Conservative</div><div className="ai-preset__k">HIGH CONFIDENCE</div><div className="ai-preset__d">threshold 0.85 · neighbors 3</div></div>
      <div className="ai-preset ai-preset--on"><div className="ai-preset__t">Balanced</div><div className="ai-preset__k">DEFAULT</div><div className="ai-preset__d">threshold 0.7 · neighbors 5</div></div>
      <div className="ai-preset"><div className="ai-preset__t">Aggressive</div><div className="ai-preset__k">MAX COVERAGE</div><div className="ai-preset__d">threshold 0.55 · neighbors 7</div></div>
    </div>
    <div className="ai-actions"><span className="btn btn--primary btn--xs">Run Propagation</span></div>
  </div>
);
const AiAggregation: React.FC = () => (
  <div>
    <div className="ai-lead">Combine rule-based, AI, and propagated labels into a single final label per row with a confidence score.</div>
    <div className="ai-presets ai-presets--2">
      <div className="ai-preset ai-preset--on"><div className="ai-preset__t">Confidence weighted</div><div className="ai-preset__k">RECOMMENDED</div><div className="ai-preset__d">Each source weighted by its confidence.</div></div>
      <div className="ai-preset"><div className="ai-preset__t">Majority vote</div><div className="ai-preset__k">SIMPLE</div><div className="ai-preset__d">Most sources wins.</div></div>
    </div>
    <div className="card__label" style={{ marginTop: '10px' }}>Which sources to include</div>
    <div className="ai-srcs"><label className="check"><span className="check__box check__box--on">✓</span> Rule labels</label><label className="check"><span className="check__box check__box--on">✓</span> AI labels</label><label className="check"><span className="check__box check__box--on">✓</span> Propagated labels</label></div>
    <div className="ai-actions"><span className="btn btn--primary btn--xs">Run Aggregation</span></div>
  </div>
);
const AiSynthetic: React.FC = () => (
  <div className="ai-2col">
    <div>
      <div className="ai-lead">Generate realistic synthetic example texts for a label — useful to balance a small or skewed dataset.</div>
      <div className="ai-field"><span className="ai-field__l">Label to generate for</span><div className="select select--mut">e.g. at_risk</div></div>
      <div className="card__label">How many samples</div>
      <div className="ai-presets ai-presets--4"><div className="ai-preset"><div className="ai-preset__t">5</div><div className="ai-preset__k">QUICK</div></div><div className="ai-preset ai-preset--on"><div className="ai-preset__t">20</div><div className="ai-preset__k">BALANCED</div></div><div className="ai-preset"><div className="ai-preset__t">50</div><div className="ai-preset__k">TRAINING</div></div><div className="ai-preset"><div className="ai-preset__t">100</div><div className="ai-preset__k">BULK</div></div></div>
      <div className="ai-actions"><span className="btn btn--primary btn--xs">Generate 20 samples</span></div>
    </div>
    <div><div className="card__label">Generated</div>{SYN.map((s, i) => (<div key={i} className="ai-syn a-fade" style={{ animationDelay: `${0.25 + i * 0.2}s` }}>{s}</div>))}</div>
  </div>
);
const AiActive: React.FC = () => (
  <div>
    <div className="ai-lead">Surface the rows the model is least certain about — the highest-value candidates for human review.</div>
    <div className="card__label">How many candidates to surface</div>
    <div className="ai-presets ai-presets--4"><div className="ai-preset"><div className="ai-preset__t">10</div><div className="ai-preset__k">QUICK WIN</div></div><div className="ai-preset ai-preset--on"><div className="ai-preset__t">25</div><div className="ai-preset__k">BALANCED</div></div><div className="ai-preset"><div className="ai-preset__t">50</div><div className="ai-preset__k">THOROUGH</div></div><div className="ai-preset"><div className="ai-preset__t">100</div><div className="ai-preset__k">DEEP DIVE</div></div></div>
    <div className="ai-actions"><span className="btn btn--primary btn--xs">Find 25 candidates</span></div>
  </div>
);
const AIScreen: React.FC<ScreenProps> = ({ active }) => {
  const cur = AI_CYCLE[useCycle(active, AI_CYCLE.length)];
  return (
    <div className="scr">
      <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
        <div><div className="scr__h1">AI-Powered Labeling</div><div className="scr__sub">Let an LLM label your data — predict, propagate, aggregate, and more</div></div>
      </div>
      <div className="card a-fade" style={{ animationDelay: '0.15s' }}>
        <CycleTabs tabs={AI_TAB_BAR} activeLabel={AI_LABEL[cur]} cur={cur} />
        <div className="ai-panel"><div className="eda-in" key={cur}>
          {cur === 'predict' && <AiPredict />}
          {cur === 'propagation' && <AiPropagation />}
          {cur === 'aggregation' && <AiAggregation />}
          {cur === 'synthetic' && <AiSynthetic />}
          {cur === 'active' && <AiActive />}
        </div></div>
      </div>
    </div>
  );
};

// ── Images (light preview) ───────────────────────────────────────
const IMG_TILES: { name: string; bg: string }[] = Array.from({ length: 12 }, (_, i) => {
  const hues = [255, 40, 0, 150, 95, 280, 210, 30, 60, 25, 130, 270];
  const h = hues[i];
  return { name: `img${i + 1}`, bg: `linear-gradient(135deg, hsl(${h} 40% 38%), hsl(${h + 25} 45% 24%))` };
});
const ImagesScreen: React.FC<ScreenProps> = () => (
  <div className="scr">
    <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
      <div><div className="scr__h1">Image Pipeline</div><div className="scr__sub">Select an image dataset to embed, cluster, and search its images with CLIP</div></div>
    </div>
    <div className="card a-fade" style={{ animationDelay: '0.12s' }}>
      <div className="img-ctrls"><div className="select" style={{ maxWidth: '230px', margin: 0 }}>cat-g0fcd844a4_640 (images) <span className="select__chev">▾</span></div><span className="btn btn--primary btn--xs">Generate Embeddings</span><span className="btn btn--ghost btn--xs">Run Clustering</span><span className="btn btn--ghost btn--xs">Load Clusters</span></div>
      <div className="img-prog"><div className="img-prog__bar"><div className="img-prog__fill a-bar" style={{ width: '40%' }} /></div><span className="img-prog__pct">40%</span></div>
      <div className="img-prog__note">Generating embeddings (32 / 80)…</div>
      <div className="cyc__bar" style={{ marginTop: '12px' }}><span className="cyc__tab cyc__tab--on">Gallery (80)</span><span className="cyc__tab">Clusters</span><span className="cyc__tab">Search</span></div>
      <div className="img-grid">
        {IMG_TILES.map((t, i) => (<div key={i} className="img-tile a-fade" style={{ animationDelay: `${0.2 + i * 0.03}s` }}><div className="img-thumb" style={{ background: t.bg }} /><div className="img-name">{t.name}</div></div>))}
      </div>
    </div>
  </div>
);

// ── Review & Export ──────────────────────────────────────────────
const REV_CYCLE = ['quality', 'review', 'export'] as const;
const REV_BAR = ['Quality Eval', 'Review Actions', 'Export'];
const REV_LABEL: Record<string, string> = { quality: 'Quality Eval', review: 'Review Actions', export: 'Export' };
const REV_ACTIONS: [string, string, string][] = [['row 1042', 'approve', ''], ['row 0337', 'relabel', 'healthy'], ['row 0915', 'reject', '']];
const STATUS_FLOW = ['raw', 'processed', 'labeled', 'reviewed', 'ready'];
const RevQuality: React.FC = () => (
  <div className="ai-2col">
    <div><div className="card__label">Run Quality Evaluation</div><div className="ai-field"><span className="ai-field__l">Expected labels (optional)</span><div className="select select--mut">at_risk, healthy</div></div><div className="ai-actions"><span className="btn btn--primary btn--xs">Evaluate Quality</span></div></div>
    <div><div className="card__label">Quality Results</div><div className="lbl-stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}><div className="lbl-stat"><div className="lbl-stat__n" style={{ color: 'var(--grn)' }}>56%</div><div className="lbl-stat__l">Coverage</div></div><div className="lbl-stat"><div className="lbl-stat__n">0.87</div><div className="lbl-stat__l">Avg confidence</div></div><div className="lbl-stat"><div className="lbl-stat__n">667</div><div className="lbl-stat__l">Labeled</div></div><div className="lbl-stat"><div className="lbl-stat__n">0</div><div className="lbl-stat__l">Conflicts</div></div></div></div>
  </div>
);
const RevReview: React.FC = () => (
  <div>
    <div className="rev-addrow"><div className="ai-field" style={{ flex: 1, margin: 0 }}><span className="ai-field__l">Item ID</span><div className="select select--mut">row id…</div></div><div className="ai-field" style={{ flex: 1, margin: 0 }}><span className="ai-field__l">Action</span><div className="select">Approve <span className="select__chev">▾</span></div></div><span className="btn btn--ghost btn--xs">Add</span></div>
    <table className="tbl" style={{ marginTop: '12px' }}><thead><tr><th>ITEM</th><th>ACTION</th><th>NEW LABEL</th></tr></thead><tbody>{REV_ACTIONS.map((a, i) => (<tr key={i} className="a-row" style={{ animationDelay: `${0.1 + i * 0.08}s` }}><td>{a[0]}</td><td><span className={`pill ${a[1] === 'approve' ? 'pill--ok' : a[1] === 'reject' ? 'pill--bad' : 'pill--warn'}`}>{a[1]}</span></td><td>{a[2] || '—'}</td></tr>))}</tbody></table>
    <div className="card__label" style={{ marginTop: '14px' }}>Dataset status</div>
    <div className="rev-flow">{STATUS_FLOW.map((s, i) => (<React.Fragment key={s}><span className={`rev-step${i <= 3 ? ' rev-step--done' : ''}${i === 3 ? ' rev-step--on' : ''}`}>{s}</span>{i < STATUS_FLOW.length - 1 && <span className="rev-arrow">→</span>}</React.Fragment>))}</div>
  </div>
);
const RevExport: React.FC = () => (
  <div className="ai-2col">
    <div><div className="card__label">Export Dataset</div><div className="ai-field"><span className="ai-field__l">Format</span><div className="select">CSV <span className="select__chev">▾</span></div></div><div className="ai-srcs" style={{ marginTop: '2px' }}><span className="chip2 chip2--on">CSV</span><span className="chip2">JSON</span><span className="chip2">COCO</span><span className="chip2">YOLO</span></div><div className="ai-actions"><span className="btn btn--primary btn--xs">Export</span></div></div>
    <div><div className="card__label">Export Result</div><div className="rev-result"><div className="rev-result__row"><span>file</span><b>teen_v3.csv</b></div><div className="rev-result__row"><span>rows</span><b>1,200</b></div><div className="rev-result__row"><span>version</span><b>v3</b></div><div className="rev-result__row"><span>lineage</span><b>sha256 · 8b3f…a91</b></div></div></div>
  </div>
);
const ReviewScreen: React.FC<ScreenProps> = ({ active }) => {
  const cur = REV_CYCLE[useCycle(active, REV_CYCLE.length)];
  return (
    <div className="scr">
      <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
        <div><div className="scr__h1">Review & Export</div><div className="scr__sub">Evaluate quality, review labels, and export datasets</div></div>
        <div className="rev-badges"><span className="pill pill--info">Reviewed 667</span><span className="pill pill--ok">Approved 612</span><span className="pill pill--bad">Rejected 18</span></div>
      </div>
      <div className="card a-fade" style={{ animationDelay: '0.15s' }}>
        <CycleTabs tabs={REV_BAR} activeLabel={REV_LABEL[cur]} cur={cur} />
        <div className="ai-panel"><div className="eda-in" key={cur}>
          {cur === 'quality' && <RevQuality />}
          {cur === 'review' && <RevReview />}
          {cur === 'export' && <RevExport />}
        </div></div>
      </div>
    </div>
  );
};

// ── Workflows ────────────────────────────────────────────────────
const WF_CYCLE = ['list', 'templates', 'create'] as const;
const WF_BAR = ['Workflows', 'Templates', 'Create'];
const WF_LABEL: Record<string, string> = { list: 'Workflows', templates: 'Templates', create: 'Create' };
const WF_ROWS: [string, string, number, number][] = [['Teen full pipeline', 'running', 3, 5], ['Q4 export run', 'completed', 5, 5], ['Image embed + cluster', 'paused', 1, 4]];
const WF_TMPL: [string, string, number][] = [['CSV → labeled dataset', 'Structure → EDA → rules → quality → export', 5], ['Image pipeline', 'Embeddings → cluster → quality → export', 4], ['Quick clean + EDA', 'Structure → EDA', 2]];
const WfList: React.FC = () => (
  <table className="tbl"><thead><tr><th>NAME</th><th>STATUS</th><th>PROGRESS</th><th>ACTIONS</th></tr></thead><tbody>{WF_ROWS.map((w, i) => { const pct = Math.round((w[2] / w[3]) * 100); return (<tr key={i} className="a-row" style={{ animationDelay: `${0.1 + i * 0.08}s` }}><td style={{ color: '#4ADE80', fontWeight: 600 }}>{w[0]}</td><td><span className={`pill ${w[1] === 'completed' ? 'pill--ok' : w[1] === 'running' ? 'pill--warn' : 'pill--info'}`}>{w[1]}</span></td><td><div className="wf-prog"><div className="wf-prog__bar"><div style={{ width: `${pct}%` }} /></div><span>{w[2]}/{w[3]}</span></div></td><td>{w[1] === 'running' ? <span className="btn btn--ghost btn--xs">Pause</span> : w[1] === 'paused' ? <span className="btn btn--primary btn--xs">Resume</span> : <span className="wf-dash">—</span>}</td></tr>); })}</tbody></table>
);
const WfTemplates: React.FC = () => (
  <div className="wf-tmpls">{WF_TMPL.map((t, i) => (<div key={i} className="wf-tmpl a-fade" style={{ animationDelay: `${0.1 + i * 0.08}s` }}><div className="wf-tmpl__t">{t[0]}</div><div className="wf-tmpl__d">{t[1]}</div><div className="wf-tmpl__chips"><span className="chip2">Built-in</span><span className="chip2">{t[2]} steps</span></div></div>))}</div>
);
const WfCreate: React.FC = () => (
  <div style={{ maxWidth: '460px' }}><div className="ai-field"><span className="ai-field__l">Name</span><div className="select select--mut">My pipeline</div></div><div className="ai-field"><span className="ai-field__l">Dataset</span><div className="select">Teen <span className="select__chev">▾</span></div></div><div className="ai-field"><span className="ai-field__l">Template (optional)</span><div className="select">CSV → labeled dataset <span className="select__chev">▾</span></div></div><div className="ai-actions"><span className="btn btn--primary btn--xs">Create & Start</span></div></div>
);
const WorkflowsScreen: React.FC<ScreenProps> = ({ active }) => {
  const cur = WF_CYCLE[useCycle(active, WF_CYCLE.length)];
  return (
    <div className="scr">
      <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
        <div><div className="scr__h1">Workflows</div><div className="scr__sub">Orchestrate multi-step data pipelines</div></div>
        <span className="btn btn--primary btn--xs">+ New Workflow</span>
      </div>
      <div className="card a-fade" style={{ animationDelay: '0.15s' }}>
        <CycleTabs tabs={WF_BAR} activeLabel={WF_LABEL[cur]} cur={cur} />
        <div className="ai-panel"><div className="eda-in" key={cur}>
          {cur === 'list' && <WfList />}
          {cur === 'templates' && <WfTemplates />}
          {cur === 'create' && <WfCreate />}
        </div></div>
      </div>
    </div>
  );
};

// ── LLM Config ───────────────────────────────────────────────────
const LLM_CYCLE = ['configs', 'add', 'test'] as const;
const LLM_BAR = ['Configurations', 'Add / Edit', 'Test Connection'];
const LLM_LABEL: Record<string, string> = { configs: 'Configurations', add: 'Add / Edit', test: 'Test Connection' };
const LLM_CONFIGS: [string, string, string, string, boolean, boolean][] = [['ollama', 'llama3', '0.7', '2048', true, false], ['openai', 'gpt-4o', '0.7', '2048', false, true], ['anthropic', 'claude-3-5-sonnet', '0.5', '4096', false, true]];
const LlmConfigs: React.FC = () => (
  <table className="tbl"><thead><tr><th>PROVIDER</th><th>MODEL</th><th>TEMP</th><th>MAX TOK</th><th>DEFAULT</th><th>API KEY</th></tr></thead><tbody>{LLM_CONFIGS.map((c, i) => (<tr key={i} className="a-row" style={{ animationDelay: `${0.1 + i * 0.08}s` }}><td style={{ color: '#4ADE80', fontWeight: 600 }}>{c[0]}</td><td>{c[1]}</td><td>{c[2]}</td><td>{c[3]}</td><td>{c[4] ? <span className="pill pill--ok">Default</span> : '—'}</td><td>{c[5] ? <span className="pill pill--info">Set</span> : <span className="pill pill--mut">None</span>}</td></tr>))}</tbody></table>
);
const LlmAdd: React.FC = () => (
  <div className="ai-2col">
    <div><div className="ai-field"><span className="ai-field__l">Provider</span><div className="select">Ollama <span className="select__chev">▾</span></div></div><div className="ai-field"><span className="ai-field__l">Model</span><div className="select">llama3 <span className="select__chev">▾</span></div></div><div className="ai-field"><span className="ai-field__l">API Key</span><div className="select select--mut">••••••••••••</div></div></div>
    <div><div className="ai-field"><span className="ai-field__l">Base URL</span><div className="select select--mut">http://localhost:11434</div></div><div className="ai-field2"><div><span className="ai-field__l">Temperature</span><div className="select">0.7</div></div><div><span className="ai-field__l">Max Tokens</span><div className="select">2048</div></div></div><label className="check" style={{ margin: '4px 0 10px' }}><span className="check__box check__box--on">✓</span> Set as default provider</label><div className="ai-actions"><span className="btn btn--primary btn--xs">Save Configuration</span></div></div>
  </div>
);
const LlmTest: React.FC = () => (
  <div className="ai-2col">
    <div><div className="ai-field"><span className="ai-field__l">Provider</span><div className="select">Ollama <span className="select__chev">▾</span></div></div><div className="ai-field"><span className="ai-field__l">Model</span><div className="select">llama3 <span className="select__chev">▾</span></div></div><div className="ai-actions"><span className="btn btn--primary btn--xs">Test Connection</span></div></div>
    <div><div className="card__label">Result</div><div className="rev-result"><div className="rev-result__row"><span>status</span><b style={{ color: 'var(--grn)' }}>✓ connected</b></div><div className="rev-result__row"><span>model</span><b>llama3</b></div><div className="rev-result__row"><span>latency</span><b>312 ms</b></div><div className="rev-result__row"><span>reply</span><b>“Hello!”</b></div></div></div>
  </div>
);
const LLMConfigScreen: React.FC<ScreenProps> = ({ active }) => {
  const cur = LLM_CYCLE[useCycle(active, LLM_CYCLE.length)];
  return (
    <div className="scr">
      <div className="scr__top a-fade" style={{ animationDelay: '0.05s' }}>
        <div><div className="scr__h1">LLM Configuration</div><div className="scr__sub">Manage AI provider connections and model settings</div></div>
      </div>
      <div className="card a-fade" style={{ animationDelay: '0.15s' }}>
        <CycleTabs tabs={LLM_BAR} activeLabel={LLM_LABEL[cur]} cur={cur} />
        <div className="ai-panel"><div className="eda-in" key={cur}>
          {cur === 'configs' && <LlmConfigs />}
          {cur === 'add' && <LlmAdd />}
          {cur === 'test' && <LlmTest />}
        </div></div>
      </div>
    </div>
  );
};

// ── Stage registry ───────────────────────────────────────────────
interface Stage { id: string; num: string; nav: string; label: string; title: string; lead: string; Screen: React.FC<ScreenProps>; }
const STAGES: Stage[] = [
  { id: 'dashboard', num: '01', nav: 'dashboard', label: 'Dashboard', title: 'Your whole workspace, at a glance', lead: 'Jump into any pipeline and see recent runs — the home base for everything that follows.', Screen: DashboardScreen },
  { id: 'datasets', num: '02', nav: 'datasets', label: 'Datasets', title: 'Every file becomes a versioned dataset', lead: 'Drop a CSV, JSON, or image folder — Orchestraty seals it and shows a live preview, tabular or visual.', Screen: DatasetsScreen },
  { id: 'structuring', num: '03', nav: 'structuring', label: 'Structuring', title: 'It audits every column and recommends the fix', lead: 'A per-column audit, one-click cleanup, and a 99 · Grade A quality score — written as a new sealed version.', Screen: StructuringScreen },
  { id: 'eda', num: '04', nav: 'eda', label: 'EDA', title: 'Profile, correlate, and chart — it demos itself', lead: 'Profiling, embeddings, and clustering run in parallel. The tabs cycle through column stats, correlations, and live graphs.', Screen: EdaScreen },
  { id: 'labeling', num: '05', nav: 'labeling', label: 'Labeling', title: 'Rules label thousands of rows in seconds', lead: 'Compound conditions, quick templates, a live preview — then coverage and distribution at a glance.', Screen: LabelingScreen },
  { id: 'ai', num: '06', nav: 'ai', label: 'AI Labeling', title: 'A labeling studio, not just a prompt box', lead: 'Predict with any LLM, propagate over embeddings, aggregate sources, generate synthetic data, queue the uncertain rows.', Screen: AIScreen },
  { id: 'images', num: '07', nav: 'images', label: 'Images', title: 'Images become a searchable library', lead: 'Upload a folder, CLIP-embed every image, cluster look-alikes, search by text. (Preview — still maturing.)', Screen: ImagesScreen },
  { id: 'review', num: '08', nav: 'review', label: 'Review & Export', title: 'Quality-gate, correct, and ship with lineage', lead: 'Score quality, work the review queue, advance the status lifecycle, and export with full provenance.', Screen: ReviewScreen },
  { id: 'workflows', num: '09', nav: 'workflows', label: 'Workflows', title: 'Save the whole sequence as a pipeline', lead: 'Chain the steps into a workflow, start from a template, re-run on tomorrow’s data — pause and resume any run.', Screen: WorkflowsScreen },
  { id: 'llm', num: '10', nav: 'llm', label: 'LLM Config', title: 'Bring your own model, any provider', lead: 'Connect OpenAI, Anthropic, Groq, or local Ollama / LM Studio — set a default, tune it, and test the connection live.', Screen: LLMConfigScreen },
];

// ── Page ─────────────────────────────────────────────────────────
const Tour: React.FC = () => {
  const [active, setActive] = useState(0);
  const sectionsRef = useRef<(HTMLElement | null)[]>([]);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.idx);
            if (!Number.isNaN(idx)) setActive(idx);
          }
        });
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    sectionsRef.current.forEach((s) => s && observer.observe(s));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setPct(max > 0 ? Math.round((el.scrollTop / max) * 100) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="tour">
      <header className="tour__header">
        <Link to="/" className="tour__back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          <span>Back to site</span>
        </Link>
        <div className="tour__brand"><OrchestrateIcon size={20} /><span>Orchestraty — Tour</span></div>
        <div className="tour__progress">{`${Math.min(active + 1, STAGES.length)} / ${STAGES.length}`}</div>
      </header>

      <nav className="tour__hud" aria-label="Tour progress">
        <div className="tour__hud-pct">{pct}<span>%</span></div>
        <div className="tour__hud-now">
          <span className="tour__hud-num">{STAGES[active].num}</span>
          <span className="tour__hud-name">{STAGES[active].label}</span>
          <span className="tour__hud-total">/ {String(STAGES.length).padStart(2, '0')}</span>
        </div>
        <div className="tour__hud-track">
          <span className="tour__hud-line" />
          <span className="tour__hud-fill" style={{ height: `${STAGES.length > 1 ? (active / (STAGES.length - 1)) * 100 : 0}%` }} />
          {STAGES.map((s, i) => (
            <a key={s.id} href={`#${s.id}`} className={`tour__tick${i < active ? ' tour__tick--done' : ''}${i === active ? ' tour__tick--on' : ''}`} style={{ top: `${(i / (STAGES.length - 1)) * 100}%` }}>
              <span className="tour__tick-dash" />
              <span className="tour__tick-label">{s.label}</span>
            </a>
          ))}
        </div>
      </nav>

      <main className="tour__main">
        <section className="tour__intro">
          <span className="tour__intro-eyebrow">The whole system, one scroll</span>
          <h1 className="tour__intro-title">Watch your data operating<br />system work, stage by stage.</h1>
          <p className="tour__intro-lead">Raw file in, production-ready dataset out — dashboard, ingest, structure, explore, label by rules and AI, search images, review, orchestrate, and connect your own model. Every step below is the real dashboard, animated. Scroll, and the pipeline assembles itself.</p>
          <a href="#dashboard" className="tour__intro-cue">Start the walkthrough
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
          </a>
        </section>

        {STAGES.map((s, i) => {
          const Screen = s.Screen;
          return (
            <section key={s.id} id={s.id} ref={(el) => { sectionsRef.current[i] = el; }} data-idx={i} className={`tour__sec${i === active ? ' is-active' : ''}`}>
              <div className="tour__head">
                <span className="tour__step">{s.num} · {s.label}</span>
                <h2 className="tour__title">{s.title}</h2>
                <p className="tour__lead">{s.lead}</p>
              </div>
              <div className="tour__winwrap"><WindowFrame active={s.nav}><Screen active={i === active} /></WindowFrame></div>
            </section>
          );
        })}

        <section className="tour__finale">
          <div className="tour__finale-card">
            <h2 className="tour__finale-title">That’s the whole system.</h2>
            <p className="tour__finale-desc">From your dashboard through ingest, structure, EDA, rules, AI labeling, vision, review, workflows, and your own LLM — every screen here is the real app, shipped and running on your machine. One command boots the whole stack.</p>
            <div className="tour__finale-install"><InstallPill withFootnote={false} size="md" /></div>
            <Link to="/" className="tour__finale-back">Back to site</Link>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Tour;
