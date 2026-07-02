"""
Unified LLM service — wraps litellm to provide completion, classification,
image classification, structured output, and connection testing across all
supported providers.
"""

import json
import logging
import os
import time
from typing import Any

import litellm

from core.llm.prompts import (
    CLASSIFICATION_SYSTEM,
    CLASSIFICATION_USER,
    IMAGE_CLASSIFICATION_SYSTEM,
    IMAGE_CLASSIFICATION_USER,
    STRUCTURED_OUTPUT_SYSTEM,
)
from core.llm.providers import LLMConfig, LLMProvider

logger = logging.getLogger(__name__)


# Cache the in-Docker check so we don't stat() on every LLM call.
_IN_DOCKER: bool | None = None


def _is_in_docker() -> bool:
    """Detect whether the process is running inside a Docker container."""
    global _IN_DOCKER
    if _IN_DOCKER is None:
        _IN_DOCKER = (
            os.path.exists("/.dockerenv")
            or os.environ.get("DOCKER_CONTAINER") == "1"
        )
    return _IN_DOCKER


def _normalize_local_url(url: str) -> str:
    """Rewrite ``localhost`` / ``127.0.0.1`` to ``host.docker.internal`` when
    the caller is running inside a Docker container.

    This is the saving-grace fix for the most common dev-time gotcha: a user
    has Ollama on the host machine but the API container can't see it
    because the saved LLM config (or the OLLAMA_BASE_URL env var) points
    at ``localhost`` — which from inside the container means *the container
    itself*, not the host. Outside Docker this is a no-op.
    """
    if not url or not _is_in_docker():
        return url
    rewritten = (
        url.replace("://localhost:", "://host.docker.internal:")
           .replace("://127.0.0.1:", "://host.docker.internal:")
           .replace("://localhost/", "://host.docker.internal/")
           .replace("://127.0.0.1/", "://host.docker.internal/")
    )
    if rewritten != url:
        logger.info("Rewrote LLM base_url for Docker: %s -> %s", url, rewritten)
    return rewritten


class LLMService:
    """High-level interface to any supported LLM provider via litellm."""

    def __init__(self, config: LLMConfig) -> None:
        self.config = config
        self._model = self._build_model_string()
        self._api_params = self._get_api_params()
        logger.info(
            "LLMService initialised: provider=%s model=%s",
            config.provider.value,
            self._model,
        )

    # ------------------------------------------------------------------
    # Public methods
    # ------------------------------------------------------------------

    async def complete(self, messages: list[dict], **kwargs: Any) -> dict:
        """Send a chat-completion request and return a normalised result dict."""
        try:
            response = await litellm.acompletion(
                model=self._model,
                messages=messages,
                temperature=kwargs.get("temperature", self.config.temperature),
                max_tokens=kwargs.get("max_tokens", self.config.max_tokens),
                timeout=self.config.timeout,
                **self._api_params,
            )
            choice = response.choices[0]
            return {
                "content": choice.message.content,
                "model": response.model,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                },
                "finish_reason": choice.finish_reason,
            }
        except Exception as exc:
            logger.error("LLM completion failed: %s", exc, exc_info=True)
            return {
                "content": None,
                "model": self._model,
                "usage": {},
                "finish_reason": "error",
                "error": str(exc),
            }

    async def classify(
        self,
        text: str,
        labels: list[str],
        examples: list[dict] | None = None,
        instructions: str | None = None,
    ) -> dict:
        """Classify *text* into one of *labels* using the LLM.

        *instructions* is an optional plain-English description of how to decide
        the label; it is injected into the prompt ahead of any examples.
        """
        examples_block = ""
        if instructions and instructions.strip():
            examples_block += f"Task instructions: {instructions.strip()}\n\n"
        if examples:
            examples_block += "Examples:\n"
            for ex in examples:
                examples_block += f'  - Text: "{ex.get("text", "")}" -> Label: "{ex.get("label", "")}"\n'
            examples_block += "\n"

        user_content = CLASSIFICATION_USER.format(
            text=text,
            labels=", ".join(labels),
            examples=examples_block,
        )

        messages = [
            {"role": "system", "content": CLASSIFICATION_SYSTEM},
            {"role": "user", "content": user_content},
        ]

        result = await self.complete(messages, temperature=0.1)
        return self._parse_classification_response(result, labels)

    async def classify_image(
        self,
        image_base64: str,
        labels: list[str],
        mime_type: str = "image/png",
    ) -> dict:
        """Classify an image (base64-encoded) into one of *labels*."""
        user_content_text = IMAGE_CLASSIFICATION_USER.format(
            labels=", ".join(labels),
        )

        messages = [
            {"role": "system", "content": IMAGE_CLASSIFICATION_SYSTEM},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{image_base64}",
                        },
                    },
                    {"type": "text", "text": user_content_text},
                ],
            },
        ]

        result = await self.complete(messages, temperature=0.1)
        return self._parse_classification_response(result, labels)

    async def generate_structured(self, prompt: str, schema: dict) -> dict:
        """Ask the LLM to return JSON conforming to *schema*."""
        schema_str = json.dumps(schema, indent=2)
        messages = [
            {"role": "system", "content": STRUCTURED_OUTPUT_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"{prompt}\n\n"
                    f"Respond with a JSON object matching this schema:\n{schema_str}"
                ),
            },
        ]

        result = await self.complete(messages, temperature=0.2)
        if result.get("error"):
            return {"error": result["error"]}

        try:
            parsed = json.loads(result["content"])
            return parsed
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Structured output parse failed: %s", exc)
            return {
                "error": f"Failed to parse LLM response as JSON: {exc}",
                "raw_content": result.get("content"),
            }

    async def test_connection(self) -> dict:
        """Send a lightweight probe to verify provider connectivity."""
        messages = [
            {"role": "user", "content": "Say hello in one sentence."},
        ]
        start = time.perf_counter()
        try:
            response = await litellm.acompletion(
                model=self._model,
                messages=messages,
                max_tokens=32,
                timeout=self.config.timeout,
                **self._api_params,
            )
            latency_ms = (time.perf_counter() - start) * 1000
            return {
                "success": True,
                "message": response.choices[0].message.content,
                "model": response.model,
                "latency_ms": round(latency_ms, 2),
            }
        except Exception as exc:
            latency_ms = (time.perf_counter() - start) * 1000
            logger.error("Connection test failed: %s", exc, exc_info=True)
            return {
                "success": False,
                "message": str(exc),
                "model": self._model,
                "latency_ms": round(latency_ms, 2),
            }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_model_string(self) -> str:
        """Return the litellm-formatted model identifier for the configured provider."""
        model = self.config.model_name
        provider = self.config.provider

        if provider == LLMProvider.OLLAMA:
            return f"ollama/{model}"
        if provider == LLMProvider.OPENAI:
            return model
        if provider == LLMProvider.ANTHROPIC:
            return model
        if provider == LLMProvider.GROQ:
            return f"groq/{model}"
        if provider == LLMProvider.CUSTOM:
            return f"openai/{model}"

        return model

    def _get_api_params(self) -> dict:
        """Build the extra kwargs dict that litellm needs for this provider."""
        params: dict[str, Any] = {}
        provider = self.config.provider

        if provider == LLMProvider.OLLAMA:
            from core.settings import settings as _settings
            raw_url = (
                self.config.base_url
                or _settings.OLLAMA_BASE_URL
                or "http://localhost:11434"
            )
            params["api_base"] = _normalize_local_url(raw_url)

        elif provider == LLMProvider.OPENAI:
            if self.config.api_key:
                params["api_key"] = self.config.api_key

        elif provider == LLMProvider.ANTHROPIC:
            if self.config.api_key:
                params["api_key"] = self.config.api_key

        elif provider == LLMProvider.GROQ:
            if self.config.api_key:
                params["api_key"] = self.config.api_key

        elif provider == LLMProvider.CUSTOM:
            if self.config.base_url:
                params["api_base"] = _normalize_local_url(self.config.base_url)
            if self.config.api_key:
                params["api_key"] = self.config.api_key

        return params

    def _parse_classification_response(
        self, result: dict, labels: list[str]
    ) -> dict:
        """Extract structured classification data from an LLM response."""
        if result.get("error"):
            return {
                "label": None,
                "confidence": 0.0,
                "reasoning": f"LLM error: {result['error']}",
            }

        content = result.get("content", "") or ""

        # Strip markdown code fences if present
        cleaned = content.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            cleaned = "\n".join(lines)

        try:
            parsed = json.loads(cleaned)
            label = parsed.get("label", "")
            confidence = float(parsed.get("confidence", 0.0))
            reasoning = parsed.get("reasoning", "")

            # Validate the label is in the allowed set (case-insensitive)
            labels_lower = [l.lower() for l in labels]
            if label.lower() not in labels_lower:
                logger.warning(
                    "LLM returned label '%s' not in allowed labels %s — coercing to None",
                    label,
                    labels,
                )
                label = None

            return {
                "label": label,
                "confidence": max(0.0, min(1.0, confidence)),
                "reasoning": reasoning,
            }
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            logger.warning(
                "Failed to parse classification response: %s | raw=%s",
                exc,
                content[:200],
            )
            return {
                "label": None,
                "confidence": 0.0,
                "reasoning": f"Parse error: {exc}",
            }
