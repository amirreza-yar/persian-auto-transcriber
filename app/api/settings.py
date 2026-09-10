from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.runtime_settings import get_all_settings, set_setting
from app.schemas import SettingsPatch


router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def read_settings(db: Session = Depends(get_db)):
    return get_all_settings(db)


@router.patch("")
def update_settings(body: SettingsPatch, db: Session = Depends(get_db)):
    try:
        for key, value in body.values.items():
            set_setting(db, key, value)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc
    return get_all_settings(db)
