"""The seal: SHA-256 over canonical JSON, byte-identical to frontend/lib/hash.ts.

Sealed payload = id, createdAt, parties (name + hashed phone), consent, terms,
transcript, confirmations. Payments, status and events are outside the hash.
"""

from __future__ import annotations

import hashlib
import json
import re


def canonical(value) -> str:
    # JS canonical(): sorted keys, no spaces, raw UTF-8; undefined never reaches JSON.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def phone_hash(phone: str) -> str:
    return sha256_hex("karaar:" + re.sub(r"\D", "", phone or ""))


def _party(p: dict) -> dict:
    return {"name": p.get("name"), "phoneHash": p.get("phoneHash") or phone_hash(p.get("phone", ""))}


def seal_payload(a: dict) -> dict:
    payload = {
        "id": a.get("id"),
        "createdAt": a.get("createdAt"),
        "worker": _party(a.get("worker") or {}),
        "hirer": _party(a.get("hirer") or {}),
        "consent": a.get("consent"),
        "terms": a.get("terms"),
        "transcript": a.get("transcript"),
        "confirmations": a.get("confirmations"),
    }
    # JS drops undefined keys; a missing key here must not become "null".
    return {k: v for k, v in payload.items() if v is not None or k in (a or {})}


def hash_agreement(a: dict) -> str:
    return sha256_hex(canonical(seal_payload(a)))
