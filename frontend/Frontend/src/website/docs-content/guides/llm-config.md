# LLM configuration

Connect the model providers Orchestraty uses for AI labeling and synthetic data. Configuration
is workspace-global (single user) and your API keys never leave your machine.

## Providers

- **OpenAI**, **Anthropic**, **Groq** — bring your API key.
- **Ollama** — fully local / offline models.
- **LM Studio** / any **OpenAI-compatible** endpoint — set a custom base URL.

## What you control

Per provider: **model name**, **API key**, **base URL**, **temperature**, **max tokens**, and a
**default** flag. You can **test the connection** live (it returns latency and a sample reply).

## API

| Method | Endpoint |
|--------|----------|
| `GET` | `/api/v1/llm/providers` · `/models/{provider}` · `/config` |
| `POST` | `/api/v1/llm/config` · `/test` |
| `DELETE` | `/api/v1/llm/config/{provider}` |

!!! tip
    Running the API in Docker but Ollama on the host? Use
    `http://host.docker.internal:11434` as the base URL.
