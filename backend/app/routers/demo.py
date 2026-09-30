"""DEMO_MODE helpers: reset between runs. Disabled unless DEMO_MODE=true."""

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.services import privacy_actions

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/reset")
def reset() -> dict:
    if not settings.demo_mode:
        raise HTTPException(404, "Demo reset is only available when DEMO_MODE=true.")
    return privacy_actions.reset_demo()
