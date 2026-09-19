"""API routing and registration module."""

from fastapi import APIRouter, Depends

from ..core.dependencies import get_current_principal
from .routes import agent, audit, backups, files, health, logs

api_v1 = APIRouter(prefix="/api/v1", dependencies=[Depends(get_current_principal)])
api_v1.include_router(health.router)
api_v1.include_router(files.router)
api_v1.include_router(backups.router)
api_v1.include_router(logs.router)
api_v1.include_router(agent.router)
api_v1.include_router(audit.router)

__all__ = ["api_v1"]
