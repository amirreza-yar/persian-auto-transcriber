import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import decrypt_secret, encrypt_secret
from app.models import ApiToken
from app.schemas import TokenCreate, TokenOut, TokenPatch
from app.services.token_manager import remaining, refresh_daily_usage


router = APIRouter(prefix="/tokens", tags=["tokens"])


def _out(token: ApiToken) -> TokenOut:
    refresh_daily_usage(token)
    remaining_tokens, remaining_requests = remaining(token)
    try:
        raw = decrypt_secret(token.secret)
        masked = ("*" * max(4, len(raw) - 4)) + raw[-4:]
    except Exception:
        masked = "********"
    return TokenOut(
        id=token.id,
        provider=token.provider,
        label=token.label,
        masked_token=masked,
        enabled=token.enabled,
        priority=token.priority,
        cooldown_until=token.cooldown_until,
        usage_date=token.usage_date,
        prompt_tokens_today=token.prompt_tokens_today,
        response_tokens_today=token.response_tokens_today,
        total_tokens_today=token.total_tokens_today,
        requests_today=token.requests_today,
        prompt_tokens_total=token.prompt_tokens_total,
        response_tokens_total=token.response_tokens_total,
        total_tokens_total=token.total_tokens_total,
        requests_total=token.requests_total,
        failures_total=token.failures_total,
        daily_token_limit=token.daily_token_limit,
        daily_request_limit=token.daily_request_limit,
        remaining_tokens_today=remaining_tokens,
        remaining_requests_today=remaining_requests,
        last_used_at=token.last_used_at,
        last_error=token.last_error,
    )


@router.get("", response_model=list[TokenOut])
def list_tokens(db: Session = Depends(get_db)):
    tokens = db.scalars(select(ApiToken).order_by(ApiToken.priority.desc(), ApiToken.created_at)).all()
    result = [_out(token) for token in tokens]
    db.commit()
    return result


@router.post("", response_model=TokenOut)
def create_token(body: TokenCreate, db: Session = Depends(get_db)):
    if body.provider != "gemini":
        raise HTTPException(400, "Only gemini tokens are supported right now")
    token = ApiToken(
        id=str(uuid.uuid4()),
        provider=body.provider,
        label=body.label,
        secret=encrypt_secret(body.token),
        priority=body.priority,
        daily_token_limit=body.daily_token_limit,
        daily_request_limit=body.daily_request_limit,
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return _out(token)


@router.patch("/{token_id}", response_model=TokenOut)
def update_token(token_id: str, body: TokenPatch, db: Session = Depends(get_db)):
    token = db.get(ApiToken, token_id)
    if not token:
        raise HTTPException(404, "Token not found")
    for field in ("label", "enabled", "priority", "daily_token_limit", "daily_request_limit"):
        value = getattr(body, field)
        if value is not None:
            setattr(token, field, value)
    if body.clear_daily_token_limit:
        token.daily_token_limit = None
    if body.clear_daily_request_limit:
        token.daily_request_limit = None
    db.commit()
    db.refresh(token)
    return _out(token)


@router.delete("/{token_id}")
def delete_token(token_id: str, db: Session = Depends(get_db)):
    token = db.get(ApiToken, token_id)
    if not token:
        raise HTTPException(404, "Token not found")
    db.delete(token)
    db.commit()
    return {"deleted": token_id}
