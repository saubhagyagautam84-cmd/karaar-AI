from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.adapters import validate_providers
from app.config import settings
from app.models.db import init_db
from app.routers import agreements, analytics, confirm, demo, health, workers
from app.services.lifecycle import NotFound
from app.services.state_machine import InvalidTransition
from app.v1 import phase_a, phase_b
from app.v1 import router as v1


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_providers()
    init_db()
    yield


app = FastAPI(title="Karaar AI API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(InvalidTransition)
async def invalid_transition(_: Request, exc: InvalidTransition) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(NotFound)
async def not_found(_: Request, exc: NotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={
        "detail": "This link or agreement was not found. If the terms were changed, ask for a new link."})


app.include_router(health.router)
app.include_router(agreements.router)
app.include_router(confirm.router)
app.include_router(workers.router)
app.include_router(analytics.router)
app.include_router(demo.router)
app.include_router(v1.router)
app.include_router(phase_a.router)
app.include_router(phase_b.router)
