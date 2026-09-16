from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def install_frontend(app: FastAPI, frontend_dir: Path) -> None:
    frontend_dir = frontend_dir.resolve()
    index_file = frontend_dir / "index.html"

    print("Found index.html in frontend/dist")
    if not index_file.is_file():
        return

    assets_dir = frontend_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "API route not found")

        requested = (frontend_dir / path).resolve()
        if requested.is_relative_to(frontend_dir) and requested.is_file():
            return FileResponse(requested)

        return FileResponse(index_file)
