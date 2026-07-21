"""FastAPI entry point for the loopback-only speech companion."""

from __future__ import annotations

import json
from typing import cast

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .config import SpeechSettings
from .health import SpeechRuntime
from .protocol import SERVICE_VERSION, dump_message
from .session import SpeechConnection


def create_app(
    settings: SpeechSettings | None = None,
    *,
    runtime: SpeechRuntime | None = None,
) -> FastAPI:
    resolved_settings = settings or SpeechSettings.from_env()
    resolved_runtime = runtime or SpeechRuntime(settings=resolved_settings)
    app = FastAPI(
        title="SUITS speech companion",
        version=SERVICE_VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=[],
    )
    app.state.speech_runtime = resolved_runtime

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "serviceVersion": SERVICE_VERSION}

    @app.get("/v1/capabilities")
    async def capabilities() -> dict[str, object]:
        return cast(
            dict[str, object],
            json.loads(dump_message(resolved_runtime.capabilities())),
        )

    @app.websocket("/v1/speech")
    async def speech_socket(websocket: WebSocket) -> None:
        await SpeechConnection(websocket=websocket, runtime=resolved_runtime).run()

    return app


def main() -> None:
    settings = SpeechSettings.from_env()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        ws_max_queue=settings.stt_input_max_frames,
        ws_max_size=262_144,
    )
