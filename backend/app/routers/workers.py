"""The worker's own record: private by default, shared only by an expiring link."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import work

router = APIRouter(prefix="/api/workers", tags=["workers"])


@router.get("/{worker_id}")
def get_profile(worker_id: int, key: str | None = None, share: str | None = None) -> dict:
    return work.profile(worker_id, work.authorize(worker_id, key, share))


class OwnerIn(BaseModel):
    key: str


@router.post("/{worker_id}/share")
def share(worker_id: int, body: OwnerIn) -> dict:
    if work.authorize(worker_id, body.key, None) != "owner":
        raise work.NotFound(str(worker_id))
    return work.create_share_link(worker_id)


@router.post("/{worker_id}/share/revoke")
def revoke(worker_id: int, body: OwnerIn) -> dict:
    if work.authorize(worker_id, body.key, None) != "owner":
        raise work.NotFound(str(worker_id))
    work.revoke_share_links(worker_id)
    return {"ok": True}


class EshramIn(OwnerIn):
    uan: str


@router.post("/{worker_id}/eshram")
def link_eshram(worker_id: int, body: EshramIn) -> dict:
    if work.authorize(worker_id, body.key, None) != "owner":
        raise work.NotFound(str(worker_id))
    return work.link_eshram(worker_id, body.uan)


@router.post("/{worker_id}/erase")
def erase(worker_id: int, body: OwnerIn) -> dict:
    from app.services import privacy_actions

    if work.authorize(worker_id, body.key, None) != "owner":
        raise work.NotFound(str(worker_id))
    privacy_actions.erase_worker(worker_id)
    return {"erased": True}
