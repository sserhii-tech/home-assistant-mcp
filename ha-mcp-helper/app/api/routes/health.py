"""Health check endpoint."""

from typing import Any
from fastapi import APIRouter, Depends

from ...core.config import get_config_root
from ...services.snapshot_service import SnapshotService
from ..schemas import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
def get_health(config_root: str = Depends(get_config_root)) -> dict[str, Any]:
    """Return system health status and memory footprint."""
    memory_mb = 0.0
    try:
        import psutil
        process = psutil.Process()
        memory_mb = round(process.memory_info().rss / (1024 * 1024), 2)
    except Exception:
        memory_mb = 0.0

    snapshots = SnapshotService.list_snapshots(config_root)
    return {
        "status": "ok",
        "version": "0.4.0",
        "config_root": config_root,
        "snapshots_count": len(snapshots),
        "memory_mb": memory_mb,
    }
