from datetime import timedelta

from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import CircuitBreaker


def get_circuit(db: Session, name: str) -> CircuitBreaker:
    circuit = db.get(CircuitBreaker, name)
    if circuit is None:
        circuit = CircuitBreaker(name=name)
        db.add(circuit)
        db.flush()
    if circuit.state == "open" and circuit.opened_until and circuit.opened_until <= utcnow():
        circuit.state = "half_open"
    return circuit


def allow_request(db: Session, name: str) -> tuple[bool, int]:
    circuit = get_circuit(db, name)
    if circuit.state != "open":
        return True, 0
    remaining = max(1, int((circuit.opened_until - utcnow()).total_seconds())) if circuit.opened_until else 30
    return False, remaining


def record_circuit_success(db: Session, name: str) -> CircuitBreaker:
    circuit = get_circuit(db, name)
    circuit.state = "closed"
    circuit.consecutive_failures = 0
    circuit.opened_until = None
    circuit.last_error = None
    circuit.last_success_at = utcnow()
    db.flush()
    return circuit


def record_circuit_failure(
    db: Session,
    name: str,
    error: str,
    threshold: int,
    cooldown_seconds: int,
) -> CircuitBreaker:
    circuit = get_circuit(db, name)
    circuit.consecutive_failures += 1
    circuit.last_error = error[:4000]
    circuit.last_failure_at = utcnow()
    if circuit.consecutive_failures >= threshold:
        circuit.state = "open"
        circuit.opened_until = utcnow() + timedelta(seconds=cooldown_seconds)
    db.flush()
    return circuit


def reset_circuit(db: Session, name: str) -> CircuitBreaker:
    circuit = get_circuit(db, name)
    circuit.state = "closed"
    circuit.consecutive_failures = 0
    circuit.opened_until = None
    circuit.last_error = None
    db.flush()
    return circuit
