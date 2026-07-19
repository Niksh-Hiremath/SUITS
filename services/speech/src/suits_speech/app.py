"""FastAPI entry point for the loopback-only speech companion."""

from __future__ import annotations

import json
import time
import uuid

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from .config import SpeechSettings
from .health import SpeechRuntime
from .protocol import (
    PROTOCOL_VERSION,
    SERVICE_VERSION,
    ErrorEvent,
    FlowControlEvent,
    HelloControl,
    LoadModelsControl,
    PingControl,
    PongEvent,
    ProtocolDecodeError,
    ProtocolModel,
    ReadyEvent,
    dump_message,
    parse_client_control,
)


def _now_ms() -> int:
    return int(time.time() * 1_000)


def _requested_subprotocols(websocket: WebSocket) -> set[str]:
    value = websocket.headers.get("sec-websocket-protocol", "")
    return {item.strip() for item in value.split(",") if item.strip()}


async def _send_event(websocket: WebSocket, event: ProtocolModel) -> None:
    await websocket.send_text(dump_message(event))


async def _send_error(
    websocket: WebSocket,
    *,
    code: str,
    message: str,
    request_id: str | None = None,
    fatal: bool = False,
) -> None:
    await _send_event(
        websocket,
        ErrorEvent(
            code=code,
            message=message,
            request_id=request_id,
            retryable=not fatal,
            fatal=fatal,
        ),
    )


async def _speech_socket(websocket: WebSocket, runtime: SpeechRuntime) -> None:
    origin = websocket.headers.get("origin")
    if origin not in runtime.settings.allowed_origins:
        await websocket.close(code=4_403, reason="origin not allowed")
        return
    if PROTOCOL_VERSION not in _requested_subprotocols(websocket):
        await websocket.close(code=4_406, reason="protocol not supported")
        return

    await websocket.accept(subprotocol=PROTOCOL_VERSION)
    session_id = f"session:{uuid.uuid4()}"
    hello_received = False

    try:
        while True:
            packet = await websocket.receive()
            if packet["type"] == "websocket.disconnect":
                return
            raw_bytes = packet.get("bytes")
            if raw_bytes is not None:
                await _send_error(
                    websocket,
                    code="UNEXPECTED_BINARY",
                    message="binary audio requires an active utterance and audio_chunk header",
                    fatal=not hello_received,
                )
                if not hello_received:
                    await websocket.close(code=4_400, reason="hello required")
                    return
                continue
            raw_text = packet.get("text")
            if raw_text is None:
                continue
            try:
                control = parse_client_control(raw_text)
            except (ProtocolDecodeError, ValidationError):
                await _send_error(
                    websocket,
                    code="INVALID_CONTROL",
                    message="control message failed strict protocol validation",
                    fatal=not hello_received,
                )
                if not hello_received:
                    await websocket.close(code=4_400, reason="invalid hello")
                    return
                continue

            if not hello_received:
                if not isinstance(control, HelloControl):
                    await _send_error(
                        websocket,
                        code="HELLO_REQUIRED",
                        message="hello must be the first control message",
                        fatal=True,
                    )
                    await websocket.close(code=4_400, reason="hello required")
                    return
                hello_received = True
                await _send_event(
                    websocket,
                    ReadyEvent(
                        session_id=session_id,
                        mode=runtime.settings.mode,
                    ),
                )
                await _send_event(websocket, runtime.capabilities())
                await _send_event(
                    websocket,
                    FlowControlEvent(
                        stt_available_frames=runtime.settings.stt_input_max_frames,
                        stt_available_bytes=runtime.settings.stt_input_max_bytes,
                        tts_window_bytes=runtime.settings.tts_ack_window_bytes,
                        tts_outstanding_bytes=0,
                    ),
                )
                continue

            if isinstance(control, HelloControl):
                await _send_error(
                    websocket,
                    code="DUPLICATE_HELLO",
                    message="hello has already completed for this session",
                    request_id=control.request_id,
                )
            elif isinstance(control, LoadModelsControl):
                if (
                    control.stt_provider is not None
                    and control.stt_provider != runtime.settings.stt_provider
                ) or (
                    control.tts_provider is not None
                    and control.tts_provider != runtime.settings.tts_provider
                ):
                    await _send_error(
                        websocket,
                        code="PROVIDER_MISMATCH",
                        message="requested providers do not match the configured local providers",
                        request_id=control.request_id,
                    )
                    continue
                capabilities = await runtime.load_models()
                await _send_event(
                    websocket,
                    capabilities.model_copy(update={"request_id": control.request_id}),
                )
            elif isinstance(control, PingControl):
                await _send_event(
                    websocket,
                    PongEvent(nonce=control.nonce, received_at_ms=_now_ms()),
                )
            else:
                await _send_error(
                    websocket,
                    code="CONTROL_NOT_READY",
                    message="speech streaming control is not enabled in this service slice",
                )
    except WebSocketDisconnect:
        return


def create_app(
    settings: SpeechSettings | None = None,
    *,
    runtime: SpeechRuntime | None = None,
) -> FastAPI:
    resolved_settings = settings or SpeechSettings.from_env()
    resolved_runtime = runtime or SpeechRuntime(settings=resolved_settings)
    app = FastAPI(
        title="SUITS local speech companion",
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
        return json.loads(dump_message(resolved_runtime.capabilities()))

    @app.websocket("/v1/speech")
    async def speech_socket(websocket: WebSocket) -> None:
        await _speech_socket(websocket, resolved_runtime)

    return app


def main() -> None:
    settings = SpeechSettings.from_env()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        ws_max_queue=settings.stt_input_max_frames,
    )
