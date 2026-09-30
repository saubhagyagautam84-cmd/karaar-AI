import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    """Every test gets its own empty SQLite file and recordings folder."""
    monkeypatch.setattr(settings, "db_path", tmp_path / "test.db")
    monkeypatch.setattr(settings, "recordings_dir", tmp_path / "recordings")
    from app.models.db import init_db

    init_db()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
