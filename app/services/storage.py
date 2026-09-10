import re
import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Artifact


SAFE_NAME_RE = re.compile(r"[^\w.()\-\u0600-\u06FF ]+", re.UNICODE)


def safe_name(name: str) -> str:
    clean = SAFE_NAME_RE.sub("_", Path(name).name).strip(" .")
    return clean or "audio"


def job_dir(job_id: str) -> Path:
    path = settings.data_dir / "jobs" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def source_dir(job_id: str) -> Path:
    path = job_dir(job_id) / "source"
    path.mkdir(parents=True, exist_ok=True)
    return path


def work_dir(job_id: str, feature: str) -> Path:
    path = job_dir(job_id) / "work" / feature
    path.mkdir(parents=True, exist_ok=True)
    return path


def artifact_dir(job_id: str) -> Path:
    path = job_dir(job_id) / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_upload(job_id: str, upload: UploadFile) -> tuple[Path, int]:
    filename = safe_name(upload.filename or "audio")
    destination = source_dir(job_id) / filename
    size = 0
    with destination.open("wb") as output:
        while chunk := upload.file.read(1024 * 1024):
            output.write(chunk)
            size += len(chunk)
    return destination, size


def register_text_artifact(db: Session, job_id: str, kind: str, name: str, text: str) -> Artifact:
    path = artifact_dir(job_id) / name
    path.write_text(text, encoding="utf-8-sig")

    artifact = db.query(Artifact).filter(Artifact.job_id == job_id, Artifact.kind == kind).first()
    if artifact:
        artifact.name = name
        artifact.path = str(path)
    else:
        artifact = Artifact(
            id=str(uuid.uuid4()),
            job_id=job_id,
            kind=kind,
            name=name,
            path=str(path),
            mime_type="text/plain; charset=utf-8",
        )
        db.add(artifact)
    db.flush()
    return artifact


def delete_job_files(job_id: str) -> None:
    shutil.rmtree(settings.data_dir / "jobs" / job_id, ignore_errors=True)
