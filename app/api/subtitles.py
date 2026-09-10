from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models import Artifact, Job


router = APIRouter(prefix="/subtitles", tags=["subtitles"])


def _artifact(db: Session, job_id: str, version: str, extension: str) -> Artifact:
    if not db.get(Job, job_id):
        raise HTTPException(404, "Job not found")
    kind = f"subtitle_{version}_{extension}"
    artifact = db.query(Artifact).filter(Artifact.job_id == job_id, Artifact.kind == kind).first()
    if not artifact:
        raise HTTPException(404, f"{version} subtitle is not available yet")
    if not Path(artifact.path).exists():
        raise HTTPException(404, "Subtitle artifact is missing from storage")
    return artifact


@router.get("/{job_id}")
def subtitle_json(
    job_id: str,
    version: str = Query("cleaned", pattern="^(raw|normalized|cleaned)$"),
    db: Session = Depends(get_db),
):
    artifact = _artifact(db, job_id, version, "json")
    import json

    return json.loads(Path(artifact.path).read_text(encoding="utf-8-sig"))


@router.get("/{job_id}/srt")
def subtitle_srt(
    job_id: str,
    version: str = Query("cleaned", pattern="^(raw|cleaned)$"),
    db: Session = Depends(get_db),
):
    artifact = _artifact(db, job_id, version, "srt")
    return FileResponse(artifact.path, filename=artifact.name, media_type=artifact.mime_type, content_disposition_type="inline")


@router.get("/{job_id}/vtt")
def subtitle_vtt(
    job_id: str,
    version: str = Query("cleaned", pattern="^(raw|cleaned)$"),
    db: Session = Depends(get_db),
):
    artifact = _artifact(db, job_id, version, "vtt")
    return FileResponse(artifact.path, filename=artifact.name, media_type=artifact.mime_type, content_disposition_type="inline")
