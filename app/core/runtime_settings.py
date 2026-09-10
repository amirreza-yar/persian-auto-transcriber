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
    "upload.max_bytes": 150 * 1024 * 1024,
    "upload.max_duration_seconds": 6 * 60 * 60,
    "circuit.gemini.failure_threshold": 4,
    "circuit.gemini.cooldown_seconds": 300,
    "system.stream_interval_seconds": 2,
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
    "worker.poll_seconds": lambda v: 0.5 <= float(v) <= 60,
    "worker.max_attempts": lambda v: 1 <= int(v) <= 20,
    "worker.retry_base_seconds": lambda v: 1 <= int(v) <= 3600,
    "worker.stale_after_seconds": lambda v: 30 <= int(v) <= 86400,
    "upload.max_bytes": lambda v: 1024 * 1024 <= int(v) <= 10 * 1024 * 1024 * 1024,
    "upload.max_duration_seconds": lambda v: 60 <= int(v) <= 48 * 60 * 60,
    "circuit.gemini.failure_threshold": lambda v: 1 <= int(v) <= 50,
    "circuit.gemini.cooldown_seconds": lambda v: 10 <= int(v) <= 86400,
    "system.stream_interval_seconds": lambda v: 1 <= float(v) <= 30,
}


TRANSCRIPTION_KEYS = {
    "model": "transcription.model",
    "core_seconds": "transcription.core_seconds",
    "context_seconds": "transcription.context_seconds",
    "cpu_threads": "transcription.cpu_threads",
    "beam_size": "transcription.beam_size",
}

CLEANING_KEYS = {
    "enabled": "cleaning.enabled",
    "model": "cleaning.model",
    "chunk_chars": "cleaning.chunk_chars",
    "retry_count": "cleaning.retry_count",
    "retry_base_seconds": "cleaning.retry_base_seconds",
    "request_timeout_seconds": "cleaning.request_timeout_seconds",
    "token_cooldown_seconds": "cleaning.token_cooldown_seconds",
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
        if not str(value).startswith(("socks5://", "socks5h://")):
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


def make_job_config(db: Session, section: str, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    values = get_all_settings(db)
    mapping = TRANSCRIPTION_KEYS if section == "transcription" else CLEANING_KEYS
    config = {name: values[key] for name, key in mapping.items()}
    for name, value in (overrides or {}).items():
        if name not in mapping:
            raise ValueError(f"Unknown {section} override: {name}")
        global_key = mapping[name]
        validator = VALIDATORS.get(global_key)
        if validator and not validator(value):
            raise ValueError(f"Invalid {section} override: {name}")
        config[name] = value
    return config
