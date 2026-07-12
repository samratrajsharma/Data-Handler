"""
AI-Powered Label Predictor — uses configured LLM to predict labels for text and image data.
"""

import asyncio
import logging
from dataclasses import dataclass, asdict

import core.paths  # noqa: F401

from core.llm.service import LLMService
from core.llm.providers import LLMConfig
from core.llm.prompts import SYNTHETIC_GENERATION_SYSTEM, SYNTHETIC_GENERATION_USER

logger = logging.getLogger(__name__)


# ── Data classes ───────────────────────────────────────────────────────

@dataclass
class AILabelPrediction:
    """A single AI-generated label prediction."""
    text: str
    predicted_label: str
    confidence: float
    reasoning: str


@dataclass
class AILabelingReport:
    """Summary report from AI-powered labeling."""
    total_items: int
    labeled_count: int
    predictions: list[AILabelPrediction]
    model_used: str
    provider: str
    avg_confidence: float

    def to_dict(self):
        return asdict(self)


# ── Helpers ────────────────────────────────────────────────────────────

def _run_async(coro):
    """Run an async coroutine from synchronous code."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Already inside an event loop — create a new one in a thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()
    else:
        return asyncio.run(coro)


# ── Text labeling ─────────────────────────────────────────────────────

def predict_text_labels(
    texts: list[str],
    labels: list[str],
    config: LLMConfig,
    batch_size: int = 10,
    examples: list[dict] | None = None,
    instructions: str | None = None,
    concurrency: int = 5,
    progress_callback=None,
) -> AILabelingReport:
    """Predict labels for a list of text items using the configured LLM.

    Args:
        texts: List of text strings to classify.
        labels: Allowed label names.
        config: LLM provider configuration.
        batch_size: How often to fire a progress update (every N items).
        examples: Optional few-shot examples as ``[{"text": ..., "label": ...}]``.
        instructions: Optional plain-English guidance on how to assign labels.
        concurrency: Number of LLM calls to run in parallel. Local Ollama
            handles a few concurrent requests fine; cloud providers (OpenAI
            etc.) handle many more. Default 5 is a safe middle ground that
            roughly 5x's throughput vs sequential.
        progress_callback: Optional ``callable(done: int, total: int, eta_seconds: float|None)``
            invoked every ``batch_size`` items so the caller can update a
            progress bar in real time.

    Returns:
        An :class:`AILabelingReport` with all predictions.
    """
    if not texts:
        logger.info("No texts provided - returning empty report.")
        return AILabelingReport(
            total_items=0, labeled_count=0, predictions=[],
            model_used=config.model_name, provider=config.provider.value,
            avg_confidence=0.0,
        )

    if not labels:
        raise ValueError("At least one label must be provided.")

    service = LLMService(config)
    # Pre-allocate so we can fill results in arbitrary completion order
    # without losing the original row position.
    predictions: list[AILabelPrediction | None] = [None] * len(texts)
    total_confidence = 0.0
    completed = 0
    import time as _time
    start_time = _time.monotonic()

    async def _classify_one(idx: int, text: str, sem: asyncio.Semaphore):
        nonlocal completed, total_confidence
        async with sem:
            try:
                result = await service.classify(text, labels, examples, instructions)
                predicted_label = result.get("label") or ""
                confidence = float(result.get("confidence", 0.0))
                reasoning = result.get("reasoning", "")
                predictions[idx] = AILabelPrediction(
                    text=text, predicted_label=predicted_label,
                    confidence=confidence, reasoning=reasoning,
                )
                total_confidence += confidence
            except Exception as exc:
                logger.warning("Failed to classify item %d: %s", idx, exc, exc_info=True)
                predictions[idx] = AILabelPrediction(
                    text=text, predicted_label="", confidence=0.0,
                    reasoning=f"Classification error: {exc}",
                )

        completed += 1
        if completed % batch_size == 0 or completed == len(texts):
            elapsed = _time.monotonic() - start_time
            rate = completed / max(0.001, elapsed)
            remaining = (len(texts) - completed) / max(0.001, rate)
            logger.info(
                "AI labeling progress: %d/%d items, %.1f/s, ETA %.0fs",
                completed, len(texts), rate, remaining,
            )
            if progress_callback:
                try:
                    progress_callback(completed, len(texts), remaining)
                except Exception:  # noqa: BLE001
                    pass  # never let a broken callback kill the job

    async def _classify_all():
        sem = asyncio.Semaphore(max(1, concurrency))
        tasks = [_classify_one(i, t, sem) for i, t in enumerate(texts)]
        await asyncio.gather(*tasks)

    _run_async(_classify_all())

    # Drop any None placeholders (shouldn't happen but be defensive).
    predictions = [p for p in predictions if p is not None]

    labeled_count = sum(1 for p in predictions if p.predicted_label)
    avg_confidence = total_confidence / len(predictions) if predictions else 0.0

    logger.info(
        "AI text labeling complete: %d/%d items labeled, avg confidence=%.3f",
        labeled_count, len(texts), avg_confidence,
    )

    return AILabelingReport(
        total_items=len(texts),
        labeled_count=labeled_count,
        predictions=predictions,
        model_used=config.model_name,
        provider=config.provider.value,
        avg_confidence=round(avg_confidence, 4),
    )


# ── Image labeling ────────────────────────────────────────────────────

def predict_image_labels(
    image_base64_list: list[str],
    labels: list[str],
    config: LLMConfig,
    mime_types: list[str] | None = None,
) -> AILabelingReport:
    """Predict labels for a list of base64-encoded images using the configured LLM.

    Args:
        image_base64_list: List of base64-encoded image strings.
        labels: Allowed label names.
        config: LLM provider configuration.
        mime_types: Optional per-image MIME types (defaults to ``"image/png"``).

    Returns:
        An :class:`AILabelingReport` with all predictions.
    """
    if not image_base64_list:
        logger.info("No images provided — returning empty report.")
        return AILabelingReport(
            total_items=0,
            labeled_count=0,
            predictions=[],
            model_used=config.model_name,
            provider=config.provider.value,
            avg_confidence=0.0,
        )

    if not labels:
        raise ValueError("At least one label must be provided.")

    if mime_types and len(mime_types) != len(image_base64_list):
        raise ValueError(
            f"mime_types length ({len(mime_types)}) must match "
            f"image_base64_list length ({len(image_base64_list)})."
        )

    service = LLMService(config)
    predictions: list[AILabelPrediction] = []
    total_confidence = 0.0

    async def _classify_all_images():
        nonlocal total_confidence
        for idx, image_b64 in enumerate(image_base64_list):
            mime_type = mime_types[idx] if mime_types else "image/png"
            try:
                result = await service.classify_image(image_b64, labels, mime_type)
                predicted_label = result.get("label") or ""
                confidence = float(result.get("confidence", 0.0))
                reasoning = result.get("reasoning", "")

                predictions.append(AILabelPrediction(
                    text=f"[image_{idx}]",
                    predicted_label=predicted_label,
                    confidence=confidence,
                    reasoning=reasoning,
                ))
                total_confidence += confidence

            except Exception as exc:
                logger.warning(
                    "Failed to classify image %d: %s", idx, exc, exc_info=True
                )
                predictions.append(AILabelPrediction(
                    text=f"[image_{idx}]",
                    predicted_label="",
                    confidence=0.0,
                    reasoning=f"Image classification error: {exc}",
                ))

    _run_async(_classify_all_images())

    labeled_count = sum(1 for p in predictions if p.predicted_label)
    avg_confidence = total_confidence / len(predictions) if predictions else 0.0

    logger.info(
        "AI image labeling complete: %d/%d images labeled, avg confidence=%.3f",
        labeled_count, len(image_base64_list), avg_confidence,
    )

    return AILabelingReport(
        total_items=len(image_base64_list),
        labeled_count=labeled_count,
        predictions=predictions,
        model_used=config.model_name,
        provider=config.provider.value,
        avg_confidence=round(avg_confidence, 4),
    )


# ── Synthetic data generation ─────────────────────────────────────────

def generate_synthetic_data(
    label: str,
    count: int,
    config: LLMConfig,
    examples: list[dict] | None = None,
) -> list[str]:
    """Generate synthetic text samples for a given label using the LLM.

    Args:
        label: The target label/category to generate samples for.
        count: Number of samples to generate.
        config: LLM provider configuration.
        examples: Optional examples as ``[{"text": ..., "label": ...}]``.

    Returns:
        A list of generated text strings.
    """
    if count <= 0:
        return []

    if not label:
        raise ValueError("A label must be provided for synthetic generation.")

    service = LLMService(config)

    examples_block = ""
    if examples:
        examples_block = "Reference examples:\n"
        for ex in examples:
            examples_block += f'  - "{ex.get("text", "")}"\n'
        examples_block += "\n"

    prompt = SYNTHETIC_GENERATION_USER.format(
        count=count,
        label=label,
        examples=examples_block,
    )

    schema = {
        "type": "object",
        "properties": {
            "samples": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
            }
        },
        "required": ["samples"],
    }

    async def _generate():
        # Use structured output with the synthetic generation prompt
        messages_prompt = (
            f"{SYNTHETIC_GENERATION_SYSTEM}\n\n{prompt}"
        )
        return await service.generate_structured(messages_prompt, schema)

    try:
        result = _run_async(_generate())
    except Exception as exc:
        logger.error("Synthetic data generation failed: %s", exc, exc_info=True)
        return []

    if "error" in result:
        logger.warning("Synthetic generation returned error: %s", result["error"])
        return []

    samples = result.get("samples", [])
    if not isinstance(samples, list):
        logger.warning("Unexpected samples format: %s", type(samples).__name__)
        return []

    # Ensure all items are strings
    samples = [str(s) for s in samples if s]

    logger.info(
        "Generated %d synthetic samples for label '%s' (requested %d).",
        len(samples), label, count,
    )
    return samples
