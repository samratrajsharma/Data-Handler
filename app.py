"""
Orchestraty — Enterprise AI Operating System
FastAPI application entry point.
"""

from contextlib import asynccontextmanager
import importlib.util
import logging
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure project root is on sys.path so `core.*` imports work everywhere
_PROJECT_ROOT = Path(__file__).parent
sys.path.insert(0, str(_PROJECT_ROOT))

from core.settings import settings  # noqa: E402
from core.database import init_db  # noqa: E402

# Standard routers (normal package imports)
from core.api.task_routes import router as task_router  # noqa: E402
from core.api.structuring_routes import router as structuring_router  # noqa: E402
from core.api.eda_routes import router as eda_router  # noqa: E402
from core.api.labeling_routes import router as labeling_router  # noqa: E402
from core.api.llm_routes import router as llm_router  # noqa: E402
from core.api.image_routes import router as image_router  # noqa: E402
from core.api.ai_labeling_routes import router as ai_labeling_router  # noqa: E402
from core.api.review_routes import router as review_router  # noqa: E402
from core.api.workflow_routes import router as workflow_router  # noqa: E402

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers for importing from the hyphenated `data-intelligence-system` dir
# ---------------------------------------------------------------------------


def _import_from_file(module_name: str, file_path: Path, package: str | None = None):
    """Import a Python module directly from a filesystem path.

    This is necessary because ``data-intelligence-system`` contains hyphens,
    which are not valid in Python package names.
    """
    spec = importlib.util.spec_from_file_location(
        module_name, file_path,
        submodule_search_locations=[str(file_path.parent)] if file_path.is_dir() or file_path.name == "__init__.py" else None,
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {file_path}")
    module = importlib.util.module_from_spec(spec)
    if package:
        module.__package__ = package
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _setup_ingestion_package():
    """Register the ingestion package hierarchy so relative imports work."""
    dis_dir = _PROJECT_ROOT / "data-intelligence-system"
    ing_dir = dis_dir / "ingestion"

    # Create synthetic packages with search locations so child imports resolve
    import types

    # Top-level: dis (data-intelligence-system)
    dis_pkg = types.ModuleType("dis_pkg")
    dis_pkg.__path__ = [str(dis_dir)]
    dis_pkg.__package__ = "dis_pkg"
    sys.modules["dis_pkg"] = dis_pkg

    # dis_pkg.ingestion
    ing_init = ing_dir / "__init__.py"
    if ing_init.exists():
        _import_from_file("dis_pkg.ingestion", ing_init, package="dis_pkg.ingestion")
    else:
        ing_pkg = types.ModuleType("dis_pkg.ingestion")
        ing_pkg.__path__ = [str(ing_dir)]
        ing_pkg.__package__ = "dis_pkg.ingestion"
        sys.modules["dis_pkg.ingestion"] = ing_pkg

    # dis_pkg.ingestion.api
    api_dir = ing_dir / "api"
    api_init = api_dir / "__init__.py"
    if api_init.exists():
        _import_from_file("dis_pkg.ingestion.api", api_init, package="dis_pkg.ingestion.api")
    else:
        api_pkg = types.ModuleType("dis_pkg.ingestion.api")
        api_pkg.__path__ = [str(api_dir)]
        api_pkg.__package__ = "dis_pkg.ingestion.api"
        sys.modules["dis_pkg.ingestion.api"] = api_pkg

    # dis_pkg.ingestion.storage
    storage_dir = ing_dir / "storage"
    storage_init = storage_dir / "__init__.py"
    if storage_init.exists():
        _import_from_file("dis_pkg.ingestion.storage", storage_init, package="dis_pkg.ingestion.storage")
    else:
        storage_pkg = types.ModuleType("dis_pkg.ingestion.storage")
        storage_pkg.__path__ = [str(storage_dir)]
        storage_pkg.__package__ = "dis_pkg.ingestion.storage"
        sys.modules["dis_pkg.ingestion.storage"] = storage_pkg

    # dis_pkg.ingestion.services
    services_dir = ing_dir / "services"
    services_init = services_dir / "__init__.py"
    if services_init.exists():
        _import_from_file("dis_pkg.ingestion.services", services_init, package="dis_pkg.ingestion.services")
    else:
        services_pkg = types.ModuleType("dis_pkg.ingestion.services")
        services_pkg.__path__ = [str(services_dir)]
        services_pkg.__package__ = "dis_pkg.ingestion.services"
        sys.modules["dis_pkg.ingestion.services"] = services_pkg

    # Now load the actual modules
    _import_from_file(
        "dis_pkg.ingestion.api.schemas",
        api_dir / "schemas.py",
        package="dis_pkg.ingestion.api",
    )
    _import_from_file(
        "dis_pkg.ingestion.storage.minio_client",
        storage_dir / "minio_client.py",
        package="dis_pkg.ingestion.storage",
    )
    _import_from_file(
        "dis_pkg.ingestion.api.routes",
        api_dir / "routes.py",
        package="dis_pkg.ingestion.api",
    )


_setup_ingestion_package()
ingestion_router = sys.modules["dis_pkg.ingestion.api.routes"].router


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle hook."""
    # ── Startup ──────────────────────────────────────────────────────────
    await init_db()
    logger.info("Database tables initialised")

    # Ensure the MinIO bucket exists (non-fatal if MinIO is unreachable)
    try:
        minio_mod = sys.modules["dis_pkg.ingestion.storage.minio_client"]
        await minio_mod.minio_storage.ensure_bucket()
        logger.info("MinIO bucket ready")
    except Exception as exc:
        logger.warning("MinIO not available — skipping bucket init: %s", exc)

    # Phase D — no SuperAdmin, no users table, no auto-seed.
    # Lifespan startup is just init_db + MinIO bucket ensure.

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────
    logger.info("Orchestraty shutting down")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Orchestraty",
    description="Enterprise AI Operating System",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow all origins in development; tighten for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────
app.include_router(task_router)
app.include_router(ingestion_router)
app.include_router(structuring_router)
app.include_router(eda_router)
app.include_router(labeling_router)
app.include_router(llm_router)
app.include_router(image_router)
app.include_router(ai_labeling_router)
app.include_router(review_router)
app.include_router(workflow_router)


# ── Root endpoints ───────────────────────────────────────────────────────


@app.get("/health", tags=["system"])
async def health_check():
    """Lightweight liveness probe."""
    return {
        "status": "healthy",
        "service": "orchestraty",
        "version": "0.1.0",
    }


@app.get("/", tags=["system"])
async def root():
    """Landing page with pointer to interactive docs."""
    return {
        "message": "Welcome to Orchestraty - Enterprise AI Operating System",
        "docs": "/docs",
    }
