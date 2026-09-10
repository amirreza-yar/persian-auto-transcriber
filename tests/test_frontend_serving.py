from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.frontend import install_frontend


def test_frontend_is_optional(tmp_path: Path):
    app = FastAPI()
    app.get("/api/health")(lambda: {"status": "ok"})
    install_frontend(app, tmp_path / "missing")

    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 404


def test_spa_fallback_and_static_file(tmp_path: Path):
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (dist / "index.html").write_text("<html>frontend</html>", encoding="utf-8")
    (assets / "app.js").write_text("console.log('ok')", encoding="utf-8")

    app = FastAPI()
    app.get("/api/health")(lambda: {"status": "ok"})
    install_frontend(app, dist)

    with TestClient(app) as client:
        assert client.get("/").text == "<html>frontend</html>"
        assert client.get("/files/123").text == "<html>frontend</html>"
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/not-real").status_code == 404
