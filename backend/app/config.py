"""Runtime settings, read from the environment (and backend/.env if present).

No python-dotenv dependency: the .env loader below handles plain KEY=VALUE lines.
Real environment variables always win over the file.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Adapter kind -> env var that selects its provider.
PROVIDER_ENV = {
    "speech": "SPEECH_PROVIDER",
    "translate": "TRANSLATE_PROVIDER",
    "payment": "PAYMENT_PROVIDER",
    "identity": "IDENTITY_PROVIDER",
    "eshram": "ESHRAM_PROVIDER",
    "notify": "NOTIFY_PROVIDER",
    "digilocker": "DIGILOCKER_PROVIDER",
    "edaakhil": "EDAAKHIL_PROVIDER",
    "llm": "LLM_PROVIDER",
}


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split(" #", 1)[0].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _resolve(path_str: str) -> Path:
    path = Path(path_str)
    return path if path.is_absolute() else BACKEND_DIR / path


@dataclass
class Settings:
    db_path: Path
    recordings_dir: Path
    phone_hash_salt: str
    cors_origins: list[str]
    default_district: str
    id_region: str
    llm_model: str
    public_base_url: str
    demo_mode: bool
    providers: dict[str, str] = field(default_factory=dict)

    @property
    def all_mock(self) -> bool:
        return all(p == "mock" for p in self.providers.values())


def load_settings() -> Settings:
    _load_dotenv(BACKEND_DIR / ".env")
    env = os.environ.get
    return Settings(
        db_path=_resolve(env("DB_PATH", "data/karaar.db")),
        recordings_dir=_resolve(env("RECORDINGS_DIR", "data/recordings")),
        phone_hash_salt=env("PHONE_HASH_SALT", "karaar-dev-salt"),
        cors_origins=[
            o.strip()
            for o in env("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
            if o.strip()
        ],
        default_district=env("DEFAULT_DISTRICT", "South Delhi"),
        id_region=env("ID_REGION", "DL").upper(),
        llm_model=env("LLM_MODEL", "claude-opus-5-5"),
        public_base_url=env("PUBLIC_BASE_URL", "http://localhost:3000").rstrip("/"),
        demo_mode=env("DEMO_MODE", "true").lower() in {"1", "true", "yes"},
        providers={kind: env(var, "mock").lower() for kind, var in PROVIDER_ENV.items()},
    )


settings = load_settings()
