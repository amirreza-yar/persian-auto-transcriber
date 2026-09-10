#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -x .venv/bin/python ]] && [[ -x .venv/bin/pytest ]]; then
  PYTHON=.venv/bin/python
  PYTEST=.venv/bin/pytest
elif command -v python >/dev/null 2>&1 \
  && command -v pytest >/dev/null 2>&1 \
  && python -c 'import fastapi, httpx, sqlalchemy' >/dev/null 2>&1; then
  PYTHON=python
  PYTEST=pytest
else
  echo "Test dependencies are not installed."
  echo "Run: uv sync --group dev"
  exit 2
fi

echo "==> Syntax check"
"$PYTHON" -m compileall -q app tests scripts

echo "==> Unit tests"
"$PYTEST" -q

if [[ -n "${API_BASE_URL:-}" ]]; then
  echo "==> Read-only API smoke test: ${API_BASE_URL}"
  "$PYTHON" scripts/smoke_api.py "${API_BASE_URL}"
else
  echo "==> API smoke test skipped (set API_BASE_URL to enable it)"
fi

echo "==> Test pipeline passed"
