from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models import Artifact
from app.schemas import ArtifactOut


router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("", response_model=list[ArtifactOut])
def list_artifacts(job_id: str | None = None, kind: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Artifact)
    if job_id:
        stmt = stmt.where(Artifact.job_id == job_id)
    if kind:
        stmt = stmt.where(Artifact.kind == kind)
    return list(db.scalars(stmt.order_by(Artifact.created_at.desc())))


@router.get("/{artifact_id}/download")
def download_artifact(artifact_id: str, db: Session = Depends(get_db)):
    artifact = db.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    path = Path(artifact.path)
    if not path.exists():
        raise HTTPException(404, "Artifact file is missing")
    return FileResponse(path, filename=artifact.name, media_type=artifact.mime_type)
