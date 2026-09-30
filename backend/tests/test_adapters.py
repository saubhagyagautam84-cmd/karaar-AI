import pytest

from app.adapters import REGISTRY, get_adapter, validate_providers
from app.adapters.base import NotConfigured
from app.adapters.notify import outbox
from app.config import settings
from app.models import db
from app.services.privacy import hash_phone, mask_phone

RAW_PHONE = "+91 98100 43210"


def _audit_rows():
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM audit_log").fetchall()]


def test_every_kind_defaults_to_mock():
    validate_providers()
    for kind in REGISTRY:
        assert get_adapter(kind).provider == "mock"


def test_unknown_provider_fails_fast(monkeypatch):
    monkeypatch.setitem(settings.providers, "speech", "nope")
    with pytest.raises(ValueError, match="SPEECH_PROVIDER"):
        validate_providers()


def test_real_stub_raises_not_configured(monkeypatch):
    monkeypatch.setitem(settings.providers, "speech", "bhashini")
    with pytest.raises(NotConfigured):
        get_adapter("speech").transcribe(b"x", "a.webm")


def test_mocks_are_deterministic():
    pay = get_adapter("payment")
    a = pay.check_status("KA-2026-DL-00001", 2000)
    b = pay.check_status("KA-2026-DL-00001", 2000)
    assert a == b and a.status == "SUCCESS"
    intent = pay.create_intent("KA-2026-DL-00001", 2000, "ramesh@upi", "Ramesh Kumar")
    assert intent.upi_link.startswith("upi://pay?") and "KA-2026-DL-00001" in intent.upi_link

    eshram = get_adapter("eshram").lookup("1234 5678 9012")
    assert eshram.linked and eshram.uan_masked == "XXXX XXXX 9012"

    ident = get_adapter("identity").verify("1234 5678 9012", "Ramesh Kumar")
    assert ident.verified and ident.masked_name == "R***** K****"


def test_adapter_calls_are_audited_with_provider():
    get_adapter("translate").translate("Is ceiling painting included?", "en", "hi", agreement_id="KA-X")
    rows = _audit_rows()
    assert rows[-1]["provider"] == "translate.mock"
    assert rows[-1]["agreement_id"] == "KA-X"


def test_no_raw_phone_or_aadhaar_in_logs_or_outbox():
    get_adapter("notify").send(mask_phone(RAW_PHONE), "Namaste", agreement_id="KA-X", to_phone=RAW_PHONE)
    get_adapter("identity").verify("1234 5678 9012", "Ramesh Kumar", agreement_id="KA-X")
    dump = repr(_audit_rows()) + repr(outbox())
    assert "9810043210" not in dump and "98100 43210" not in dump
    assert "123456789012" not in dump and "1234 5678 9012" not in dump
    assert outbox()[0].to_masked == "+91XXXXXX3210"


def test_phone_hash_and_mask():
    assert mask_phone(RAW_PHONE) == "+91XXXXXX3210"
    assert hash_phone(RAW_PHONE) == hash_phone("9810043210")
    assert len(hash_phone(RAW_PHONE)) == 64
