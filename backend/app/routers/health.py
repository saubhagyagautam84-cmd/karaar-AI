from fastapi import APIRouter

from app.config import settings

router = APIRouter()


@router.get("/health")
@router.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": "Karaar AI",
        "mode": "mock" if settings.all_mock else "mixed",
        "demo_mode": settings.demo_mode,
        "providers": settings.providers,
        "database": "sqlite",
    }
