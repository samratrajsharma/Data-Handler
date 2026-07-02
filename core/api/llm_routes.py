"""
LLM Configuration API — manage provider settings, test connections,
and discover available models.
All endpoints require at minimum the 'viewer' role.
"""

from typing import Optional
from uuid import UUID

import httpx
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.services.auth_service import User, get_current_user
from core.models.llm_config import LLMConfigRecord
from core.llm.providers import LLMProvider, LLMConfig, PROVIDER_DEFAULTS
from core.llm.service import LLMService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/llm", tags=["llm"])


# ── Schemas ──────────────────────────────────────────────────────────────


class LLMConfigSave(BaseModel):
    provider: str
    model_name: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1)
    is_default: bool = False


class LLMTestRequest(BaseModel):
    provider: str
    model_name: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────


def _provider_display_name(provider: LLMProvider) -> str:
    names = {
        LLMProvider.OLLAMA: "Ollama (Local)",
        LLMProvider.OPENAI: "OpenAI",
        LLMProvider.ANTHROPIC: "Anthropic",
        LLMProvider.GROQ: "Groq",
        LLMProvider.CUSTOM: "Custom / OpenAI-compatible",
    }
    return names.get(provider, provider.value)


def _provider_requires_api_key(provider: LLMProvider) -> bool:
    return provider not in (LLMProvider.OLLAMA,)


def _resolve_provider(value: str) -> LLMProvider:
    """Convert a string to LLMProvider, raising 400 on invalid input."""
    try:
        return LLMProvider(value)
    except ValueError:
        valid = [p.value for p in LLMProvider]
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider '{value}'. Must be one of: {', '.join(valid)}",
        )


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("/providers")
async def list_providers(
    current_user: User = Depends(get_current_user),
):
    """Return all supported LLM providers with their defaults."""
    providers = []
    for provider, defaults in PROVIDER_DEFAULTS.items():
        providers.append(
            {
                "name": provider.value,
                "display_name": _provider_display_name(provider),
                "default_base_url": defaults.get("base_url"),
                "models": defaults.get("models", []),
                "requires_api_key": _provider_requires_api_key(provider),
            }
        )
    return {"providers": providers}


@router.get("/models/{provider}")
async def list_models(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return available models for a provider.

    Behaviour:
      * **Ollama** — live query to the local instance.
      * **OpenAI / Groq** (OpenAI-compatible `/v1/models`) — live query
        using the user's saved API key. Falls back to the static list if
        the key isn't set or the call fails.
      * **Anthropic** — live query to ``/v1/models`` with the saved API key
        (Anthropic added a list-models endpoint in late 2024).
      * **Other / no key** — static defaults from ``PROVIDER_DEFAULTS``.
    """
    llm_provider = _resolve_provider(provider)
    defaults = PROVIDER_DEFAULTS.get(llm_provider, {})
    default_models: list[str] = defaults.get("models", [])

    # ── Ollama: local query ────────────────────────────────────────────
    if llm_provider == LLMProvider.OLLAMA:
        from core.settings import settings as _settings
        from core.llm.service import _normalize_local_url
        raw_url = _settings.OLLAMA_BASE_URL or defaults.get("base_url", "http://localhost:11434")
        base_url = _normalize_local_url(raw_url)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{base_url}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                model_names = [m["name"] for m in data.get("models", [])]
                return {
                    "provider": provider,
                    "models": model_names,
                    "source": "live",
                    "warning": None,
                }
        except Exception as exc:
            logger.warning("Ollama unreachable at %s: %s", base_url, exc)
            return {
                "provider": provider,
                "models": default_models,
                "source": "defaults",
                "warning": f"Ollama unreachable at {base_url}. Showing default model list.",
            }

    # ── Cloud providers: live /v1/models via user's saved API key ──────
    # Look up the saved config so we can use the user's own API key for the
    # live query — never any global / shared key.
    cfg_stmt = select(LLMConfigRecord).where(
        LLMConfigRecord.provider == provider,
    )
    cfg_row = (await db.execute(cfg_stmt)).scalars().first()
    api_key = cfg_row.api_key_encrypted if cfg_row else None

    if not api_key:
        return {
            "provider": provider,
            "models": default_models,
            "source": "defaults",
            "warning": "No API key configured yet — showing built-in model list. Configure the provider in LLM Settings to see live models.",
        }

    base_url = (cfg_row.base_url if cfg_row and cfg_row.base_url else defaults.get("base_url"))
    if not base_url:
        return {"provider": provider, "models": default_models, "source": "defaults", "warning": None}

    # OpenAI, Groq, Anthropic all expose GET /v1/models with bearer auth.
    # Anthropic uses x-api-key + anthropic-version headers instead.
    headers: dict[str, str] = {}
    if llm_provider == LLMProvider.ANTHROPIC:
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
        models_url = f"{base_url.rstrip('/')}/v1/models"
    else:
        headers["Authorization"] = f"Bearer {api_key}"
        # OpenAI compat: /v1/models if not already path-suffixed.
        models_url = (
            f"{base_url.rstrip('/')}/models"
            if base_url.endswith("/v1") or "/v1/" in base_url
            else f"{base_url.rstrip('/')}/v1/models"
        )

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(models_url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        # Both OpenAI-compat and Anthropic return ``{"data": [{"id": "..."}, ...]}``.
        raw_models = data.get("data") if isinstance(data, dict) else None
        if not isinstance(raw_models, list):
            raise ValueError(f"Unexpected /models response shape: {type(data).__name__}")
        # Filter to chat-capable IDs. OpenAI returns embedding / TTS / etc.
        # mixed in; we skip anything that's obviously not a chat model.
        skip_prefixes = (
            "text-embedding", "text-moderation", "tts-", "dall-e",
            "whisper", "babbage-", "davinci-", "ada-",
        )
        model_ids = sorted({
            m["id"] for m in raw_models
            if isinstance(m, dict) and isinstance(m.get("id"), str)
            and not any(m["id"].startswith(p) for p in skip_prefixes)
        })
        if not model_ids:
            # API call succeeded but filtered to nothing — fall back so the
            # dropdown isn't empty.
            return {
                "provider": provider,
                "models": default_models,
                "source": "defaults",
                "warning": "Live query returned no chat models — showing defaults.",
            }
        return {
            "provider": provider,
            "models": model_ids,
            "source": "live",
            "warning": None,
        }
    except Exception as exc:
        logger.warning("Live model fetch failed for %s at %s: %s", provider, models_url, exc)
        # Common reasons: invalid key, network blocked, rate limit. We still
        # need to give the user SOMETHING so the dropdown isn't empty.
        return {
            "provider": provider,
            "models": default_models,
            "source": "defaults",
            "warning": f"Could not fetch live model list ({type(exc).__name__}). Showing built-in list.",
        }


@router.get("/config")
async def get_configs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all LLM configurations for the current user."""
    result = await db.execute(
        select(LLMConfigRecord)
    )
    records = result.scalars().all()

    configs = [
        {
            "id": str(rec.id),
            "provider": rec.provider,
            "model_name": rec.model_name,
            "base_url": rec.base_url,
            "temperature": rec.temperature,
            "max_tokens": rec.max_tokens,
            "is_default": rec.is_default,
            "has_api_key": rec.api_key_encrypted is not None
            and rec.api_key_encrypted != "",
        }
        for rec in records
    ]
    return {"configs": configs}


@router.post("/config")
async def save_config(
    body: LLMConfigSave,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create or update an LLM provider configuration for the current user."""
    _resolve_provider(body.provider)  # validate provider name

    # If marking as default, clear other defaults first
    if body.is_default:
        await db.execute(
            update(LLMConfigRecord)
            
            .values(is_default=False)
        )

    # Check for existing config for this user + provider
    result = await db.execute(
        select(LLMConfigRecord).where(
            LLMConfigRecord.provider == body.provider,
        )
    )
    existing = result.scalars().first()

    if existing:
        # Build update values
        values: dict = {
            "model_name": body.model_name,
            "base_url": body.base_url,
            "temperature": body.temperature,
            "max_tokens": body.max_tokens,
            "is_default": body.is_default,
        }
        # Only overwrite api_key if a new one was provided
        if body.api_key is not None:
            values["api_key_encrypted"] = body.api_key

        await db.execute(
            update(LLMConfigRecord)
            .where(LLMConfigRecord.id == existing.id)
            .values(**values)
        )
        await db.commit()
        return {"message": "Configuration saved", "config_id": str(existing.id)}

    # Insert new record
    new_record = LLMConfigRecord(
        provider=body.provider,
        model_name=body.model_name,
        api_key_encrypted=body.api_key,
        base_url=body.base_url,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
        is_default=body.is_default,
    )
    db.add(new_record)
    await db.commit()
    await db.refresh(new_record)
    return {"message": "Configuration saved", "config_id": str(new_record.id)}


@router.delete("/config/{provider}")
async def delete_config(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete the current user's configuration for a specific provider."""
    _resolve_provider(provider)  # validate

    result = await db.execute(
        select(LLMConfigRecord).where(
            LLMConfigRecord.provider == provider,
        )
    )
    existing = result.scalars().first()
    if not existing:
        raise HTTPException(
            status_code=404,
            detail=f"No configuration found for provider '{provider}'",
        )

    await db.execute(
        delete(LLMConfigRecord).where(LLMConfigRecord.id == existing.id)
    )
    await db.commit()
    return {"message": "Configuration deleted"}


@router.post("/test")
async def test_connection(
    body: LLMTestRequest,
    current_user: User = Depends(get_current_user),
):
    """Test connectivity to an LLM provider without persisting anything."""
    llm_provider = _resolve_provider(body.provider)
    defaults = PROVIDER_DEFAULTS.get(llm_provider, {})

    config = LLMConfig(
        provider=llm_provider,
        model_name=body.model_name,
        api_key=body.api_key,
        base_url=body.base_url or defaults.get("base_url"),
    )

    service = LLMService(config)
    result = await service.test_connection()
    return result
