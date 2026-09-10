from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import artifacts, events, jobs, settings as settings_api, system, tokens
from app.core.runtime_settings import bootstrap_settings
from app.db import Base, SessionLocal, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        bootstrap_settings(db)
    yield


app = FastAPI(title="Persian STT Backend", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(artifacts.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")
app.include_router(tokens.router, prefix="/api")
app.include_router(events.router, prefix="/api")
