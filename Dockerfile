# syntax=docker/dockerfile:1

# Uncomment bellow to also build frontend in the docker build stage
# FROM node:22-bookworm-slim AS frontend-build

# WORKDIR /frontend

# COPY frontend/package.json frontend/package-lock.json ./
# RUN npm ci

# COPY frontend/ ./
# RUN npm run build


FROM python:3.13-slim AS runtime

COPY --from=astral/uv:0.12.12 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN uv sync --no-install-project

COPY app ./app
COPY scripts ./scripts

# Copy built frontend from above or pre-build version from src 
# COPY --from=frontend-build /frontend/dist ./frontend/dist
COPY frontend/dist ./frontend/dist

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]