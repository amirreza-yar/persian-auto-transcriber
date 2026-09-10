from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.services.circuit_breaker import allow_request, record_circuit_failure, record_circuit_success


def test_circuit_opens_and_resets():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        record_circuit_failure(db, "gemini", "timeout", threshold=2, cooldown_seconds=300)
        db.commit()
        allowed, _ = allow_request(db, "gemini")
        assert allowed is True

        record_circuit_failure(db, "gemini", "timeout", threshold=2, cooldown_seconds=300)
        db.commit()
        allowed, wait = allow_request(db, "gemini")
        assert allowed is False
        assert wait > 0

        record_circuit_success(db, "gemini")
        db.commit()
        allowed, _ = allow_request(db, "gemini")
        assert allowed is True
