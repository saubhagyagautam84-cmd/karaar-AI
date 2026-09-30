"""Governance layer: anonymised aggregates only (k-anonymity, groups < 10 hidden)."""

from fastapi import APIRouter

from app.services import analytics

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary")
def summary() -> dict:
    return analytics.summary()


@router.get("/wages")
def wages() -> dict:
    return analytics.wages()


@router.get("/delays")
def delays() -> dict:
    return analytics.delays()


@router.get("/disputes")
def disputes() -> dict:
    return analytics.disputes()


@router.get("/all")
def everything() -> dict:
    """One round trip for the dashboard."""
    return {"summary": analytics.summary(), "wages": analytics.wages(),
            "delays": analytics.delays(), "disputes": analytics.disputes()}
