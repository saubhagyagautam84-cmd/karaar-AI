"""Phone hashing and masking. Raw numbers are never stored or logged."""

from __future__ import annotations

import hashlib
import re

from app.config import settings


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        digits = "91" + digits
    return "+" + digits


def hash_phone(phone: str) -> str:
    normalized = normalize_phone(phone)
    return hashlib.sha256(f"{settings.phone_hash_salt}:{normalized}".encode()).hexdigest()


def mask_phone(phone: str) -> str:
    """'+91 98100 43210' -> '+91XXXXXX3210'."""
    normalized = normalize_phone(phone)
    return normalized[:3] + "X" * max(len(normalized) - 7, 0) + normalized[-4:]
