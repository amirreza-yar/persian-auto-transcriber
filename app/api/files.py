import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.events import add_event
from app.db import utcnow
from app.models import Job
from app.schemas import AudioFileOut, AudioFilePatch
from app.services.presenters import audio_to_out


router = APIRouter(prefix="/files", tags=["files"])


def _normalize_tags(tags: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in tags:
        tag = raw.strip()
        if not tag or tag.casefold() in seen:
            continue
        seen.add(tag.casefold())
        result.append(tag[:64])
    return result[:30]


@router.get("", response_model=list[AudioFileOut])
def list_files(
    q: str | None = None,
    tag: str | None = None,
    status: str | None = None,
    batch_id: str | None = None,
    include_deleted: bool = False,
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = select(Job)
    if not include_deleted:
        stmt = stmt.where(Job.source_deleted_at.is_(None))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Job.original_name.ilike(like), Job.description.ilike(like)))
    if tag:
        stmt = stmt.where(Job.tags_json.like(f'%"{tag}"%'))
    if status:
        stmt = stmt.where(Job.status == status)
    if batch_id:
        stmt = stmt.where(Job.batch_id == batch_id)
    jobs = db.scalars(stmt.order_by(Job.created_at.desc()).limit(limit)).all()
    return [audio_to_out(job) for job in jobs]


@router.get("/{file_id}", response_model=AudioFileOut)
def get_file(file_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, file_id)
    if not job:
        raise HTTPException(404, "Audio file not found")
    return audio_to_out(job)


@router.patch("/{file_id}", response_model=AudioFileOut)
def update_file(file_id: str, body: AudioFilePatch, db: Session = Depends(get_db)):
    job = db.get(Job, file_id)
    if not job:
        raise HTTPException(404, "Audio file not found")
    if body.description is not None:
        job.description = body.description.strip() or None
    if body.tags is not None:
        job.tags_json = json.dumps(_normalize_tags(body.tags), ensure_ascii=False)
    add_event(
        db,
        "Audio metadata updated",
        job.id,
        event_type="file.updated",
        data={"description": job.description, "tags": json.loads(job.tags_json)},
    )
    db.commit()
    return audio_to_out(job)


def _file_response(job: Job, inline: bool):
    if job.source_deleted_at is not None or not job.source_path:
        raise HTTPException(404, "Audio file has been deleted")
    path = Path(job.source_path)
    if not path.exists():
        raise HTTPException(404, "Audio file is missing from storage")
    return FileResponse(
        path,
        filename=job.original_name,
        media_type=job.source_mime_type or "application/octet-stream",
        content_disposition_type="inline" if inline else "attachment",
    )


@router.get("/{file_id}/stream")
def stream_file(file_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, file_id)
    if not job:
        raise HTTPException(404, "Audio file not found")
    return _file_response(job, inline=True)


@router.get("/{file_id}/download")
def download_file(file_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, file_id)
    if not job:
        raise HTTPException(404, "Audio file not found")
    return _file_response(job, inline=False)


@router.delete("/{file_id}")
def delete_source_file(file_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, file_id)
    if not job:
        raise HTTPException(404, "Audio file not found")
    if any(task.status in ("claimed", "running", "queued", "retry_wait") for task in job.tasks):
        raise HTTPException(409, "The source audio is still needed by an active job")
    if job.source_deleted_at is not None:
        return {"deleted": file_id}
    path = Path(job.source_path)
    if path.exists():
        path.unlink()
    job.source_deleted_at = utcnow()
    add_event(db, "Source audio deleted", job.id, event_type="file.deleted")
    db.commit()
    return {"deleted": file_id}
