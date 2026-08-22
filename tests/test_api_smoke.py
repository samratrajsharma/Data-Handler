"""API smoke tests (Docker/full-stack only — boots the FastAPI app + DB)."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402


def test_health():
    from app import app
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 200 and r.json().get("status") == "healthy"


def test_openapi_lists_core_routes():
    # Route registration is introspectable straight from the schema — no need to
    # boot the app lifespan/DB (doing so opens the async engine on a second event
    # loop and clashes with the connection from the health test above).
    from app import app
    paths = app.openapi().get("paths", {})
    assert any(p.startswith("/api/v1/datasets") for p in paths)
    assert any(p.startswith("/api/v1/labeling") for p in paths)
