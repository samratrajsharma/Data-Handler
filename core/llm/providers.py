"""
LLM provider definitions, configuration schema, and provider defaults.
"""

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class LLMProvider(str, Enum):
    """Supported LLM provider backends."""

    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GROQ = "groq"
    CUSTOM = "custom"


class LLMConfig(BaseModel):
    """Configuration for connecting to an LLM provider."""

    provider: LLMProvider
    model_name: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1)
    timeout: int = Field(default=60, ge=1)


PROVIDER_DEFAULTS: dict[LLMProvider, dict] = {
    LLMProvider.OLLAMA: {
        "base_url": "http://localhost:11434",
        "models": ["llama3", "mistral", "phi3", "gemma2", "llava"],
    },
    LLMProvider.OPENAI: {
        "base_url": "https://api.openai.com/v1",
        # Fallback list — when the user adds an API key we fetch the live
        # /models list at runtime, which is always current.
        "models": [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4-turbo",
            "gpt-4",
            "o1",
            "o1-mini",
            "o1-preview",
            "gpt-3.5-turbo",
        ],
    },
    LLMProvider.ANTHROPIC: {
        "base_url": "https://api.anthropic.com",
        "models": [
            "claude-opus-4-7",
            "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001",
        ],
    },
    LLMProvider.GROQ: {
        "base_url": "https://api.groq.com/openai/v1",
        # Fallback static list for when the user hasn't entered an API key
        # yet (live /models query needs one). When the API key IS configured
        # we fetch the live list at runtime via llm_routes.list_models.
        "models": [
            # ── Llama 3.3 (current flagship) ──
            "llama-3.3-70b-versatile",
            # ── Llama 3.1 ──
            "llama-3.1-8b-instant",
            # ── Llama 3 (8k context, legacy but fast) ──
            "llama3-70b-8192",
            "llama3-8b-8192",
            # ── Gemma 2 ──
            "gemma2-9b-it",
            # ── Llama 3.2 vision/preview ──
            "llama-3.2-11b-vision-preview",
            "llama-3.2-90b-vision-preview",
            "llama-3.2-1b-preview",
            "llama-3.2-3b-preview",
            # ── Reasoning / coder / safety ──
            "deepseek-r1-distill-llama-70b",
            "qwen-2.5-32b",
            "qwen-2.5-coder-32b",
            "llama-guard-3-8b",
        ],
    },
    LLMProvider.CUSTOM: {
        "base_url": None,
        "models": [],
    },
}
