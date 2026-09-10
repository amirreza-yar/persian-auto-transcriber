from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.security import decrypt_secret
from app.models import ApiToken


def _now():
    return datetime.now(UTC).replace(tzinfo=None)


def _today() -> str:
    return _now().date().isoformat()


def refresh_daily_usage(token: ApiToken) -> None:
    today = _today()
    if token.usage_date == today:
        return
    token.usage_date = today
    token.prompt_tokens_today = 0
    token.response_tokens_today = 0
    token.total_tokens_today = 0
    token.requests_today = 0


def token_available(token: ApiToken) -> bool:
    refresh_daily_usage(token)
    now = _now()
    if not token.enabled:
        return False
    if token.cooldown_until and token.cooldown_until > now:
        return False
    if token.daily_token_limit and token.total_tokens_today >= token.daily_token_limit:
        return False
    if token.daily_request_limit and token.requests_today >= token.daily_request_limit:
        return False
    return True


def acquire_token(db: Session, provider: str = "gemini") -> tuple[ApiToken, str] | None:
    now = _now()
    stmt = (
        select(ApiToken)
        .where(
            ApiToken.provider == provider,
            ApiToken.enabled.is_(True),
            or_(ApiToken.cooldown_until.is_(None), ApiToken.cooldown_until <= now),
        )
        .order_by(ApiToken.priority.desc(), ApiToken.last_used_at.asc().nullsfirst(), ApiToken.created_at.asc())
    )
    for token in db.scalars(stmt):
        refresh_daily_usage(token)
        if token_available(token):
            secret = decrypt_secret(token.secret)
            db.commit()
            return token, secret
    db.commit()
    return None


def record_success(
    db: Session,
    token: ApiToken,
    prompt_tokens: int = 0,
    response_tokens: int = 0,
    total_tokens: int = 0,
) -> None:
    refresh_daily_usage(token)
    token.prompt_tokens_today += prompt_tokens
    token.response_tokens_today += response_tokens
    token.total_tokens_today += total_tokens
    token.requests_today += 1
    token.prompt_tokens_total += prompt_tokens
    token.response_tokens_total += response_tokens
    token.total_tokens_total += total_tokens
    token.requests_total += 1
    token.last_used_at = _now()
    token.last_error = None
    db.commit()


def record_failure(
    db: Session,
    token: ApiToken,
    error: str,
    cooldown_seconds: int = 0,
    disable: bool = False,
) -> None:
    refresh_daily_usage(token)
    token.failures_total += 1
    token.last_error = error[:4000]
    token.last_used_at = _now()
    if cooldown_seconds:
        token.cooldown_until = _now() + timedelta(seconds=cooldown_seconds)
    if disable:
        token.enabled = False
    db.commit()


def remaining(token: ApiToken) -> tuple[int | None, int | None]:
    refresh_daily_usage(token)
    remaining_tokens = None
    remaining_requests = None
    if token.daily_token_limit:
        remaining_tokens = max(0, token.daily_token_limit - token.total_tokens_today)
    if token.daily_request_limit:
        remaining_requests = max(0, token.daily_request_limit - token.requests_today)
    return remaining_tokens, remaining_requests
