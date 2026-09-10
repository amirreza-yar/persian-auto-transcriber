import json
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting


DEFAULTS: dict[str, Any] = {
    "transcription.model": "large-v3-turbo",
    "transcription.core_seconds": 60,
    "transcription.context_seconds": 2,
    "transcription.cpu_threads": 4,
    "transcription.beam_size": 5,
    "cleaning.enabled": True,
    "cleaning.model": "gemini-3.5-flash-lite",
    "cleaning.chunk_chars": 3500,
    "cleaning.retry_count": 4,
    "cleaning.retry_base_seconds": 15,
    "cleaning.request_timeout_seconds": 120,
    "cleaning.token_cooldown_seconds": 300,
    "network.proxy_url": settings.bootstrap_socks5_proxy,
    "worker.poll_seconds": 2,
    "worker.max_attempts": 3,
    "worker.retry_base_seconds": 30,
    "worker.stale_after_seconds": 300,
}


VALIDATORS = {
    "transcription.core_seconds": lambda v: 15 <= int(v) <= 300,
    "transcription.context_seconds": lambda v: 0 <= int(v) <= 15,
    "transcription.cpu_threads": lambda v: 1 <= int(v) <= 64,
    "transcription.beam_size": lambda v: 1 <= int(v) <= 20,
    "cleaning.chunk_chars": lambda v: 500 <= int(v) <= 20000,
    "cleaning.retry_count": lambda v: 0 <= int(v) <= 20,
    "cleaning.retry_base_seconds": lambda v: 1 <= int(v) <= 3600,
    "cleaning.request_timeout_seconds": lambda v: 10 <= int(v) <= 1800,
    "cleaning.token_cooldown_seconds": lambda v: 10 <= int(v) <= 86400,
    "worker.poll_seconds": lambda v: 1 <= int(v) <= 60,
    "worker.max_attempts": lambda v: 1 <= int(v) <= 20,
    "worker.retry_base_seconds": lambda v: 1 <= int(v) <= 3600,
    "worker.stale_after_seconds": lambda v: 30 <= int(v) <= 86400,
}


def bootstrap_settings(db: Session) -> None:
    for key, value in DEFAULTS.items():
        if db.get(AppSetting, key) is None:
            db.add(AppSetting(key=key, value=json.dumps(value, ensure_ascii=False)))
    db.commit()


def get_setting(db: Session, key: str) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        if key not in DEFAULTS:
            raise KeyError(key)
        return DEFAULTS[key]
    return json.loads(row.value)


def get_all_settings(db: Session) -> dict[str, Any]:
    rows = db.query(AppSetting).all()
    values = {row.key: json.loads(row.value) for row in rows}
    return {**DEFAULTS, **values}


def set_setting(db: Session, key: str, value: Any) -> None:
    if key not in DEFAULTS:
        raise ValueError(f"Unknown setting: {key}")
    if key == "network.proxy_url" and value:
        if not str(value).startswith("socks5://"):
            raise ValueError("network.proxy_url must be a SOCKS5 URL")
    validator = VALIDATORS.get(key)
    if validator and not validator(value):
        raise ValueError(f"Invalid value for {key}")
    row = db.get(AppSetting, key)
    encoded = json.dumps(value, ensure_ascii=False)
    if row:
        row.value = encoded
    else:
        db.add(AppSetting(key=key, value=encoded))
