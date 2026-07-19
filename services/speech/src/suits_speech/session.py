"""Per-connection speech state owner with revision and cancellation fencing."""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Literal

from fastapi import WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from .audio_queue import (
    AckReservation,
    InputBackpressureError,
    InputCreditWindow,
    PhraseQueue,
    TtsAckWindow,
    TtsBackpressureError,
    TtsJob,
    TtsLease,
)
from .capacity import CapacityLease
from .health import SpeechRuntime, SttSessionCapacityError
from .protocol import (
    PROTOCOL_VERSION,
    AckTtsAudioControl,
    AudioChunkControl,
    CancelSynthesisControl,
    CancelUtteranceControl,
    CancelledEvent,
    EndUtteranceControl,
    ErrorEvent,
    FlowControlEvent,
    HelloControl,
    LoadModelsControl,
    PingControl,
    PongEvent,
    ProtocolDecodeError,
    ProtocolModel,
    ReadyEvent,
    SetVoiceControl,
    SpeechEndedEvent,
    SpeechStartedEvent,
    StartUtteranceControl,
    SttFinalEvent,
    SttPartialEvent,
    SynthesizeControl,
    TimingMark,
    TtsAudioEvent,
    TtsFinishedEvent,
    TtsStartedEvent,
    TtsTimingEvent,
    dump_message,
    parse_client_control,
)
from .providers.base import (
    AudioChunk,
    ProviderCancelled,
    StreamingSttSession,
    SynthesizedPhrase,
    SynthesisTiming,
    TranscriptHypothesis,
)
from .tts_lane import TtsLaneQuarantinedError
from .vad import EnergyVad

_MAX_CONTROL_BYTES = 65_536
_UTTERANCE_TOMBSTONES = 2_048
_JOB_TOMBSTONES = 2_048
_MAX_OUTBOUND_BATCHES = 256
_MAX_VOICE_OVERRIDES = 64
_SOCKET_SEND_TIMEOUT_SECONDS = 0.25
_LOGGER = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1_000)


def _requested_subprotocols(websocket: WebSocket) -> set[str]:
    value = websocket.headers.get("sec-websocket-protocol", "")
    return {item.strip() for item in value.split(",") if item.strip()}


@dataclass(slots=True)
class _Utterance:
    utterance_id: str
    epoch: int
    sample_rate_hz: int
    stt_session: StreamingSttSession
    vad: EnergyVad
    status: Literal["listening", "finalizing", "failing", "cancelled", "final"] = "listening"
    next_sequence: int = 0
    revision: int = 0
    last_text: str | None = field(default=None, repr=False)
    pending_frames: int = 0
    accepted_duration_ms: int = 0
    last_audio_at: float = field(default_factory=time.monotonic, repr=False)
    end_reason: Literal["client_end", "vad_end"] | None = None
    finalize_task: asyncio.Task[None] | None = field(default=None, repr=False)
    idle_task: asyncio.Task[None] | None = field(default=None, repr=False)


@dataclass(frozen=True, slots=True)
class _SttFrame:
    utterance: _Utterance
    epoch: int
    sequence: int
    duration_ms: int
    pcm_s16le: bytes = field(repr=False)


@dataclass(slots=True)
class _OutboundBatch:
    packets: tuple[str | bytes, ...] = field(repr=False)
    scope: Literal["utterance", "tts"] | None = None
    target_id: str | None = None
    reservation: AckReservation | None = None
    completion: asyncio.Future[bool] | None = field(default=None, repr=False)
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    committed: bool = False


class _OutboundCancelled(RuntimeError):
    """A scoped batch was cancelled before its first packet committed."""


class SpeechConnection:
    """Owns all mutable speech state for one browser WebSocket."""

    def __init__(self, *, websocket: WebSocket, runtime: SpeechRuntime) -> None:
        self._websocket = websocket
        self._runtime = runtime
        self._settings = runtime.settings
        self._session_id = f"session:{uuid.uuid4()}"
        self._hello_received = False
        self._closed = False
        self._state_lock = asyncio.Lock()
        self._pending_audio_header: AudioChunkControl | None = None
        self._outbound: deque[_OutboundBatch] = deque()
        self._outbound_ready = asyncio.Event()
        self._outbound_current: _OutboundBatch | None = None
        self._transport_tasks: set[asyncio.Task[None]] = set()

        self._utterance_epoch = 0
        self._active_utterance: _Utterance | None = None
        self._used_utterance_ids: set[str] = set()
        self._utterance_terminals: dict[str, Literal["final", "cancelled", "failed"]] = {}
        self._utterance_order: deque[str] = deque()
        self._input_credits = InputCreditWindow(
            max_frames=self._settings.stt_input_max_frames,
            max_bytes=self._settings.stt_input_max_bytes,
        )
        self._stt_frames: asyncio.Queue[_SttFrame] = asyncio.Queue(
            maxsize=self._settings.stt_input_max_frames
        )

        self._phrase_queue = PhraseQueue(max_depth=self._settings.max_tts_queue_depth)
        self._ack_window = TtsAckWindow(max_outstanding_bytes=self._settings.tts_ack_window_bytes)
        self._voice_by_actor = self._voice_mapping(self._settings.tts_voices)
        self._job_responses: dict[str, str] = {}
        self._job_order: deque[str] = deque()

        self._stt_worker_task: asyncio.Task[None] | None = None
        self._tts_worker_task: asyncio.Task[None] | None = None
        self._outbound_worker_task: asyncio.Task[None] | None = None
        self._receive_task: asyncio.Task[None] | None = None
        self._finalizer_tasks: set[asyncio.Task[None]] = set()
        self._idle_tasks: set[asyncio.Task[None]] = set()
        self._cleanup_tasks: set[asyncio.Task[None]] = set()
        self._provider_cleanup_tasks: set[asyncio.Task[None]] = set()
        self._provider_finish_tasks: set[asyncio.Task[TranscriptHypothesis]] = set()
        self._connection_lease: CapacityLease | None = None

    async def run(self) -> None:
        peer = self._websocket.client
        if self._settings.mode != "fake" and (
            peer is None or not self._is_loopback_peer(peer.host)
        ):
            await self._websocket.close(code=4_403, reason="loopback peer required")
            return
        origin = self._websocket.headers.get("origin")
        if origin not in self._settings.allowed_origins:
            await self._websocket.close(code=4_403, reason="origin not allowed")
            return
        if PROTOCOL_VERSION not in _requested_subprotocols(self._websocket):
            await self._websocket.close(code=4_406, reason="protocol not supported")
            return

        lease = self._runtime.try_acquire_connection()
        if lease is None:
            await self._websocket.close(code=4_013, reason="speech connection capacity exhausted")
            return
        self._connection_lease = lease
        try:
            try:
                await self._run_admitted()
            finally:
                await self._shutdown()
        finally:
            lease.release()
            self._connection_lease = None

    async def _run_admitted(self) -> None:
        await self._websocket.accept(subprotocol=PROTOCOL_VERSION)
        self._outbound_worker_task = asyncio.create_task(
            self._outbound_worker(), name=f"{self._session_id}:outbound"
        )
        self._stt_worker_task = asyncio.create_task(
            self._stt_worker(), name=f"{self._session_id}:stt"
        )
        self._tts_worker_task = asyncio.create_task(
            self._tts_worker(), name=f"{self._session_id}:tts"
        )
        self._receive_task = asyncio.create_task(
            self._receive_loop(), name=f"{self._session_id}:receive"
        )
        try:
            done, _ = await asyncio.wait(
                {
                    self._receive_task,
                    self._outbound_worker_task,
                    self._stt_worker_task,
                    self._tts_worker_task,
                },
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in done:
                if task.cancelled():
                    continue
                error = task.exception()
                if error is not None and not isinstance(error, WebSocketDisconnect):
                    raise error
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    async def _receive_loop(self) -> None:
        while not self._closed:
            try:
                if self._hello_received:
                    packet = await self._websocket.receive()
                else:
                    packet = await asyncio.wait_for(
                        self._websocket.receive(),
                        timeout=self._settings.hello_timeout_ms / 1_000,
                    )
            except TimeoutError:
                await self._fatal_protocol_error(
                    "HELLO_TIMEOUT",
                    "hello was not received within the local connection deadline",
                )
                return
            if packet["type"] == "websocket.disconnect":
                return
            raw_bytes = packet.get("bytes")
            if raw_bytes is not None:
                await self._handle_binary(raw_bytes)
                continue
            raw_text = packet.get("text")
            if raw_text is None:
                continue
            if self._pending_audio_header is not None:
                await self._fatal_protocol_error(
                    "AUDIO_FRAME_REQUIRED",
                    "audio_chunk must be followed immediately by its binary frame",
                )
                return
            if len(raw_text.encode("utf-8")) > _MAX_CONTROL_BYTES:
                await self._fatal_protocol_error(
                    "CONTROL_TOO_LARGE",
                    "control message exceeds the local protocol limit",
                )
                return
            try:
                control = parse_client_control(raw_text)
            except (ProtocolDecodeError, ValidationError):
                await self._send_error(
                    code="INVALID_CONTROL",
                    message="control message failed strict protocol validation",
                    fatal=not self._hello_received,
                )
                if not self._hello_received:
                    await self._websocket.close(code=4_400, reason="invalid hello")
                    return
                continue
            await self._dispatch(control)

    async def _dispatch(self, control: object) -> None:
        if not self._hello_received:
            if not isinstance(control, HelloControl):
                await self._fatal_protocol_error(
                    "HELLO_REQUIRED",
                    "hello must be the first control message",
                )
                return
            if PROTOCOL_VERSION not in control.supported_protocols:
                await self._fatal_protocol_error(
                    "PROTOCOL_NOT_SUPPORTED",
                    "hello must advertise the negotiated speech protocol",
                )
                return
            self._hello_received = True
            await self._send_event(
                ReadyEvent(session_id=self._session_id, mode=self._settings.mode)
            )
            await self._send_event(self._runtime.capabilities())
            await self._send_flow_control()
            return

        if isinstance(control, HelloControl):
            await self._send_error(
                code="DUPLICATE_HELLO",
                message="hello has already completed for this session",
                request_id=control.request_id,
            )
        elif isinstance(control, LoadModelsControl):
            await self._load_models(control)
        elif isinstance(control, PingControl):
            await self._send_event(PongEvent(nonce=control.nonce, received_at_ms=_now_ms()))
        elif isinstance(control, StartUtteranceControl):
            await self._start_utterance(control)
        elif isinstance(control, AudioChunkControl):
            await self._accept_audio_header(control)
        elif isinstance(control, EndUtteranceControl):
            await self._end_utterance(control)
        elif isinstance(control, CancelUtteranceControl):
            await self._cancel_utterance(control)
        elif isinstance(control, SynthesizeControl):
            await self._enqueue_synthesis(control)
        elif isinstance(control, CancelSynthesisControl):
            await self._cancel_synthesis(control)
        elif isinstance(control, AckTtsAudioControl):
            await self._acknowledge_tts(control)
        elif isinstance(control, SetVoiceControl):
            if (
                control.actor not in self._voice_by_actor
                and len(self._voice_by_actor) >= _MAX_VOICE_OVERRIDES
            ):
                await self._send_error(
                    code="VOICE_OVERRIDE_LIMIT",
                    message="the local voice override limit was reached",
                )
            else:
                self._voice_by_actor[control.actor] = control.voice_id

    async def _load_models(self, control: LoadModelsControl) -> None:
        if (
            control.stt_provider is not None and control.stt_provider != self._settings.stt_provider
        ) or (
            control.tts_provider is not None and control.tts_provider != self._settings.tts_provider
        ):
            await self._send_error(
                code="PROVIDER_MISMATCH",
                message="requested providers do not match the configured local providers",
                request_id=control.request_id,
            )
            return
        try:
            capabilities = await self._runtime.load_models()
        except Exception as error:
            _LOGGER.warning(
                "speech model load failed session=%s errorType=%s",
                self._session_id,
                type(error).__name__,
            )
            await self._send_error(
                code="MODEL_LOAD_FAILED",
                message="the configured local speech providers could not load",
                request_id=control.request_id,
            )
            return
        await self._send_event(capabilities.model_copy(update={"request_id": control.request_id}))

    async def _start_utterance(self, control: StartUtteranceControl) -> None:
        if not self._runtime.stt_provider.status.ready:
            await self._send_error(
                code="STT_NOT_READY",
                message="load the configured local STT provider before recording",
                utterance_id=control.utterance_id,
            )
            return
        if control.sample_rate_hz != self._settings.stt_sample_rate_hz:
            await self._send_error(
                code="UNSUPPORTED_AUDIO_FORMAT",
                message=f"STT requires {self._settings.stt_sample_rate_hz} Hz mono PCM",
                utterance_id=control.utterance_id,
            )
            return

        async with self._state_lock:
            if self._active_utterance is not None:
                await self._send_error(
                    code="UTTERANCE_ACTIVE",
                    message="only one microphone utterance may be active",
                    utterance_id=control.utterance_id,
                )
                return
            if control.utterance_id in self._used_utterance_ids:
                await self._send_error(
                    code="UTTERANCE_REUSED",
                    message="utteranceId cannot be reused in one speech session",
                    utterance_id=control.utterance_id,
                )
                return

        if control.barge_in:
            await self._cancel_synthesis_scope(
                scope="all", target_id=None, reason="microphone_barge_in", emit_empty=False
            )
        stt_session: StreamingSttSession | None = None
        adopted = False
        try:
            try:
                stt_session = await asyncio.wait_for(
                    self._runtime.create_stt_session(sample_rate_hz=control.sample_rate_hz),
                    timeout=5,
                )
            except SttSessionCapacityError:
                await self._send_error(
                    code="STT_CAPACITY",
                    message="all local recognizer slots are currently active",
                    utterance_id=control.utterance_id,
                )
                return
            except Exception as error:
                _LOGGER.warning(
                    "STT session creation failed session=%s errorType=%s",
                    self._session_id,
                    type(error).__name__,
                )
                await self._send_error(
                    code="STT_SESSION_FAILED",
                    message="the configured local STT provider could not start a session",
                    utterance_id=control.utterance_id,
                )
                return

            rejection: tuple[str, str] | None = None
            async with self._state_lock:
                if self._closed:
                    return
                if self._read_active_utterance_locked() is not None:
                    rejection = (
                        "UTTERANCE_ACTIVE",
                        "only one microphone utterance may be active",
                    )
                elif control.utterance_id in self._used_utterance_ids:
                    rejection = (
                        "UTTERANCE_REUSED",
                        "utteranceId cannot be reused in one speech session",
                    )
                else:
                    self._utterance_epoch += 1
                    self._remember_utterance(control.utterance_id)
                    active = _Utterance(
                        utterance_id=control.utterance_id,
                        epoch=self._utterance_epoch,
                        sample_rate_hz=control.sample_rate_hz,
                        stt_session=stt_session,
                        vad=EnergyVad(end_silence_ms=control.end_of_utterance_silence_ms),
                    )
                    self._active_utterance = active
                    self._spawn_idle_watch_locked(active)
                    adopted = True
            if rejection is not None:
                await self._send_error(
                    code=rejection[0],
                    message=rejection[1],
                    utterance_id=control.utterance_id,
                )
        finally:
            if stt_session is not None and not adopted:
                self._spawn_stt_session_disposal(
                    stt_session,
                    label=f"unadopted:{control.utterance_id}",
                )

    async def _accept_audio_header(self, control: AudioChunkControl) -> None:
        sequence_gap = False
        async with self._state_lock:
            active = self._active_utterance
            if (
                active is None
                or active.utterance_id != control.utterance_id
                or active.status != "listening"
            ):
                await self._send_error(
                    code="UTTERANCE_NOT_LISTENING",
                    message="audio_chunk requires its matching listening utterance",
                    utterance_id=control.utterance_id,
                )
                return
            if control.sequence != active.next_sequence:
                sequence_gap = True
            else:
                self._pending_audio_header = control
        if sequence_gap:
            await self._cancel_active_utterance(
                utterance_id=control.utterance_id,
                reason="non_contiguous_audio",
                emit=True,
                terminal_kind="failed",
                error_code="STALE_AUDIO_SEQUENCE",
                error_message="microphone frame sequence must be contiguous",
            )

    async def _handle_binary(self, pcm_s16le: bytes) -> None:
        header = self._pending_audio_header
        self._pending_audio_header = None
        if header is None:
            if not self._hello_received:
                await self._fatal_protocol_error(
                    "UNEXPECTED_BINARY",
                    "binary audio requires an audio_chunk header",
                )
            else:
                async with self._state_lock:
                    active_id = (
                        self._active_utterance.utterance_id
                        if self._active_utterance is not None
                        else None
                    )
                if active_id is not None:
                    await self._cancel_active_utterance(
                        utterance_id=active_id,
                        reason="unexpected_binary_frame",
                        emit=True,
                        terminal_kind="failed",
                        error_code="UNEXPECTED_BINARY",
                        error_message="binary audio requires an audio_chunk header",
                    )
                else:
                    await self._send_error(
                        code="UNEXPECTED_BINARY",
                        message="binary audio requires an audio_chunk header",
                    )
            return

        expected_numerator = self._settings.stt_sample_rate_hz * 2 * header.duration_ms
        expected_bytes, remainder = divmod(expected_numerator, 1_000)
        if (
            remainder != 0
            or len(pcm_s16le) != header.byte_length
            or len(pcm_s16le) != expected_bytes
        ):
            await self._cancel_active_utterance(
                utterance_id=header.utterance_id,
                reason="invalid_audio_frame",
                emit=True,
                terminal_kind="failed",
                error_code="AUDIO_LENGTH_MISMATCH",
                error_message="binary PCM length does not match its declared metadata",
            )
            return

        backpressure = False
        duration_exceeded = False
        async with self._state_lock:
            active = self._active_utterance
            if (
                active is None
                or active.utterance_id != header.utterance_id
                or active.status not in {"listening", "finalizing"}
                or active.next_sequence != header.sequence
            ):
                await self._send_error(
                    code="STALE_AUDIO_FRAME",
                    message="binary PCM no longer belongs to the active utterance",
                    utterance_id=header.utterance_id,
                )
                return
            duration_exceeded = (
                active.accepted_duration_ms + header.duration_ms
                > self._settings.stt_max_utterance_ms
            )
            if not duration_exceeded:
                try:
                    await self._input_credits.reserve(
                        utterance_id=header.utterance_id,
                        sequence=header.sequence,
                        byte_length=len(pcm_s16le),
                    )
                    frame = _SttFrame(
                        utterance=active,
                        epoch=active.epoch,
                        sequence=header.sequence,
                        duration_ms=header.duration_ms,
                        pcm_s16le=pcm_s16le,
                    )
                    self._stt_frames.put_nowait(frame)
                except (InputBackpressureError, asyncio.QueueFull):
                    backpressure = True
                if not backpressure:
                    active.next_sequence += 1
                    active.pending_frames += 1
                    active.accepted_duration_ms += header.duration_ms
                    active.last_audio_at = time.monotonic()
        if duration_exceeded:
            await self._cancel_active_utterance(
                utterance_id=header.utterance_id,
                reason="utterance_duration_limit",
                emit=True,
                terminal_kind="failed",
                error_code="STT_UTTERANCE_LIMIT",
                error_message="the microphone utterance exceeded its local duration limit",
            )
            return
        if backpressure:
            await self._cancel_active_utterance(
                utterance_id=header.utterance_id,
                reason="input_backpressure",
                emit=True,
                terminal_kind="failed",
                error_code="STT_BACKPRESSURE",
                error_message="microphone input exceeded the advertised local credits",
            )
            return
        await self._send_flow_control()

    async def _end_utterance(self, control: EndUtteranceControl) -> None:
        async with self._state_lock:
            active = self._active_utterance
            if active is None or active.utterance_id != control.utterance_id:
                await self._send_error(
                    code="UTTERANCE_NOT_ACTIVE",
                    message="end_utterance requires its matching active utterance",
                    utterance_id=control.utterance_id,
                )
                return
            self._request_finalize_locked(active, reason="client_end")

    async def _cancel_utterance(self, control: CancelUtteranceControl) -> None:
        await self._cancel_active_utterance(
            utterance_id=control.utterance_id,
            reason=control.reason,
            emit=True,
        )

    async def _cancel_active_utterance(
        self,
        *,
        utterance_id: str,
        reason: str,
        emit: bool,
        terminal_kind: Literal["cancelled", "failed"] = "cancelled",
        error_code: str | None = None,
        error_message: str | None = None,
        expected_active: _Utterance | None = None,
        expected_epoch: int | None = None,
        stale_silent: bool = False,
    ) -> bool:
        started = time.perf_counter()
        finalizer: asyncio.Task[None] | None = None
        idle_task: asyncio.Task[None] | None = None
        outbound_fences: tuple[asyncio.Future[bool], ...] = ()
        async with self._state_lock:
            active = self._active_utterance
            if (
                active is None
                or active.utterance_id != utterance_id
                or (expected_active is not None and active is not expected_active)
                or (expected_epoch is not None and active.epoch != expected_epoch)
            ):
                if emit and not stale_silent:
                    terminal = self._utterance_terminals.get(utterance_id)
                    if terminal == "final":
                        self._queue_event_batch(
                            (
                                ErrorEvent(
                                    code="UTTERANCE_ALREADY_FINAL",
                                    message=(
                                        "the utterance already committed its final transcript"
                                    ),
                                    utterance_id=utterance_id,
                                    retryable=True,
                                    fatal=False,
                                ),
                            )
                        )
                    elif terminal in {"cancelled", "failed"}:
                        self._queue_event_batch(
                            (
                                CancelledEvent(
                                    target="utterance",
                                    target_id=utterance_id,
                                    reason="already_cancelled",
                                    cancellation_latency_ms=0,
                                ),
                            )
                        )
                    else:
                        self._queue_event_batch(
                            (
                                ErrorEvent(
                                    code="UTTERANCE_NOT_ACTIVE",
                                    message=(
                                        "cancel_utterance requires its matching active utterance"
                                    ),
                                    utterance_id=utterance_id,
                                    retryable=True,
                                    fatal=False,
                                ),
                            )
                        )
                return False
            active.status = "cancelled"
            active.last_text = None
            self._active_utterance = None
            self._remember_utterance(utterance_id, terminal=terminal_kind)
            finalizer = active.finalize_task
            idle_task = active.idle_task
            if (
                self._pending_audio_header is not None
                and self._pending_audio_header.utterance_id == utterance_id
            ):
                self._pending_audio_header = None
            outbound_fences = self._purge_outbound(
                scope="utterance",
                target_ids={utterance_id},
            )
            if emit:
                detected_at_ms = _now_ms()
                events: list[ProtocolModel] = []
                if error_code is not None and error_message is not None:
                    events.append(
                        ErrorEvent(
                            code=error_code,
                            message=error_message,
                            utterance_id=utterance_id,
                            retryable=True,
                            fatal=False,
                        )
                    )
                events.extend(
                    (
                        SpeechEndedEvent(
                            utterance_id=utterance_id,
                            reason="cancelled",
                            detected_at_ms=detected_at_ms,
                        ),
                        CancelledEvent(
                            target="utterance",
                            target_id=utterance_id,
                            reason=reason,
                            cancellation_latency_ms=max(
                                0, int((time.perf_counter() - started) * 1_000)
                            ),
                        ),
                    )
                )
                self._queue_event_batch(
                    tuple(events),
                    scope="utterance",
                    target_id=utterance_id,
                )
        await self._await_outbound_fences(outbound_fences)
        self._purge_stt_frames(utterance_id=utterance_id)
        await self._input_credits.release_utterance(utterance_id)
        current_task = asyncio.current_task()
        tasks_to_cancel = [
            task
            for task in (idle_task,)
            if task is not None and task is not current_task and not task.done()
        ]
        tasks_to_wait = [
            task
            for task in (finalizer,)
            if task is not None and task is not current_task and not task.done()
        ]
        self._spawn_utterance_cleanup(
            active,
            tasks_to_cancel=tuple(tasks_to_cancel),
            tasks_to_wait=tuple(tasks_to_wait),
        )
        if emit:
            await self._send_flow_control()
        return True

    def _spawn_utterance_cleanup(
        self,
        active: _Utterance,
        *,
        tasks_to_cancel: tuple[asyncio.Task[None], ...],
        tasks_to_wait: tuple[asyncio.Task[None], ...],
    ) -> None:
        task = asyncio.create_task(
            self._cleanup_utterance(
                active,
                tasks_to_cancel=tasks_to_cancel,
                tasks_to_wait=tasks_to_wait,
            ),
            name=f"{self._session_id}:cleanup:{active.utterance_id}",
        )
        self._cleanup_tasks.add(task)
        task.add_done_callback(self._cleanup_task_done)

    async def _cleanup_utterance(
        self,
        active: _Utterance,
        *,
        tasks_to_cancel: tuple[asyncio.Task[None], ...],
        tasks_to_wait: tuple[asyncio.Task[None], ...],
    ) -> None:
        for task in tasks_to_cancel:
            task.cancel()
        cancel_call = self._spawn_stt_session_disposal(
            active.stt_session,
            label=f"utterance:{active.utterance_id}",
        )
        watched: set[asyncio.Task[None]] = {
            *tasks_to_cancel,
            *tasks_to_wait,
            cancel_call,
        }
        done, pending = await asyncio.wait(watched, timeout=0.15)
        if done:
            await asyncio.gather(*done, return_exceptions=True)
        if pending:
            _LOGGER.warning(
                "speech provider cleanup remains active session=%s utterance=%s count=%s",
                self._session_id,
                active.utterance_id,
                len(pending),
            )

    def _spawn_stt_session_disposal(
        self,
        session: StreamingSttSession,
        *,
        label: str,
    ) -> asyncio.Task[None]:
        task = asyncio.create_task(
            session.cancel(),
            name=f"{self._session_id}:provider-cancel:{label}",
        )
        self._provider_cleanup_tasks.add(task)
        task.add_done_callback(self._provider_cleanup_done)
        return task

    def _provider_cleanup_done(self, task: asyncio.Task[None]) -> None:
        self._provider_cleanup_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            _LOGGER.error(
                "speech provider cancellation failed session=%s errorType=%s",
                self._session_id,
                type(error).__name__,
            )

    def _cleanup_task_done(self, task: asyncio.Task[None]) -> None:
        self._cleanup_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            _LOGGER.error(
                "speech cleanup failed session=%s errorType=%s",
                self._session_id,
                type(error).__name__,
            )

    @staticmethod
    def _consume_detached_task(task: asyncio.Task[None]) -> None:
        if task.cancelled():
            return
        task.exception()

    async def _stt_worker(self) -> None:
        while True:
            try:
                frame = await self._stt_frames.get()
            except asyncio.CancelledError:
                return
            failure = False
            worker_cancelled = False
            vad_ended = False
            try:
                if not await self._utterance_is_current(frame.utterance, frame.epoch):
                    continue
                observation = frame.utterance.vad.process(
                    frame.pcm_s16le,
                    sample_rate_hz=frame.utterance.sample_rate_hz,
                )
                if observation.speech_started:
                    await self._emit_speech_started(frame.utterance, frame.epoch)
                hypotheses = await frame.utterance.stt_session.push_audio(
                    AudioChunk(
                        sequence=frame.sequence,
                        pcm_s16le=frame.pcm_s16le,
                        duration_ms=frame.duration_ms,
                    )
                )
                for hypothesis in hypotheses:
                    if hypothesis.is_final:
                        raise RuntimeError("streaming STT emitted an early final")
                    await self._emit_partial(
                        frame.utterance,
                        frame.epoch,
                        text=hypothesis.text,
                        confidence=hypothesis.confidence,
                        audio_end_ms=hypothesis.audio_end_ms,
                    )
                vad_ended = observation.speech_ended
            except ProviderCancelled:
                failure = True
            except asyncio.CancelledError:
                worker_cancelled = True
            except Exception as error:
                _LOGGER.warning(
                    "STT frame failed session=%s errorType=%s",
                    self._session_id,
                    type(error).__name__,
                )
                failure = True
            finally:
                await self._input_credits.release(
                    utterance_id=frame.utterance.utterance_id,
                    sequence=frame.sequence,
                )
                self._stt_frames.task_done()
                should_finalize = False
                async with self._state_lock:
                    frame.utterance.pending_frames = max(0, frame.utterance.pending_frames - 1)
                    if (
                        self._active_utterance is frame.utterance
                        and frame.utterance.epoch == frame.epoch
                    ):
                        if failure:
                            frame.utterance.status = "failing"
                        elif vad_ended and not worker_cancelled:
                            self._request_finalize_locked(frame.utterance, reason="vad_end")
                        should_finalize = (
                            not failure
                            and not worker_cancelled
                            and frame.utterance.status == "finalizing"
                            and frame.utterance.pending_frames == 0
                            and frame.utterance.finalize_task is None
                            and not self._has_pending_binary_locked(frame.utterance)
                        )
                        if should_finalize:
                            self._spawn_finalizer_locked(frame.utterance, frame.epoch)
                if not failure and not worker_cancelled:
                    await self._send_flow_control()
            if worker_cancelled:
                return
            if failure:
                await self._cancel_active_utterance(
                    utterance_id=frame.utterance.utterance_id,
                    reason="provider_failure",
                    emit=True,
                    terminal_kind="failed",
                    error_code="STT_PROVIDER_FAILED",
                    error_message="the local STT provider rejected an audio frame",
                    expected_active=frame.utterance,
                    expected_epoch=frame.epoch,
                    stale_silent=True,
                )

    async def _emit_speech_started(self, active: _Utterance, epoch: int) -> None:
        async with self._state_lock:
            if not self._utterance_is_current_locked(active, epoch):
                return
            self._queue_event_batch(
                (
                    SpeechStartedEvent(
                        utterance_id=active.utterance_id,
                        detected_at_ms=_now_ms(),
                    ),
                ),
                scope="utterance",
                target_id=active.utterance_id,
            )

    async def _emit_partial(
        self,
        active: _Utterance,
        epoch: int,
        *,
        text: str,
        confidence: float | None,
        audio_end_ms: int,
    ) -> None:
        normalized = text.strip()
        if not normalized or len(normalized) > 8_192:
            raise ValueError("invalid STT partial text")
        async with self._state_lock:
            if not self._utterance_is_current_locked(active, epoch):
                return
            if active.last_text == normalized:
                return
            event = SttPartialEvent(
                utterance_id=active.utterance_id,
                revision=active.revision + 1,
                text=normalized,
                confidence=confidence,
                audio_end_ms=audio_end_ms,
                emitted_at_ms=_now_ms(),
            )
            active.revision = event.revision
            active.last_text = normalized
            self._queue_event_batch(
                (event,),
                scope="utterance",
                target_id=active.utterance_id,
            )

    async def _finalize_utterance(self, active: _Utterance, epoch: int) -> None:
        finish_task = asyncio.create_task(
            active.stt_session.finish(),
            name=f"{self._session_id}:provider-finish:{active.utterance_id}",
        )
        self._provider_finish_tasks.add(finish_task)
        finish_task.add_done_callback(self._provider_finish_done)
        try:
            done, _ = await asyncio.wait({finish_task}, timeout=30)
            if finish_task not in done:
                raise TimeoutError("STT finalization exceeded its local deadline")
            hypothesis = finish_task.result()
        except Exception as error:
            _LOGGER.warning(
                "STT finalization failed session=%s errorType=%s",
                self._session_id,
                type(error).__name__,
            )
            await self._cancel_active_utterance(
                utterance_id=active.utterance_id,
                reason="finalization_failure",
                emit=True,
                terminal_kind="failed",
                error_code="STT_FINAL_FAILED",
                error_message="the local STT provider could not finalize the utterance",
                expected_active=active,
                expected_epoch=epoch,
                stale_silent=True,
            )
            return
        try:
            normalized = hypothesis.text.strip()
            if hypothesis.is_final is not True or not normalized:
                raise ValueError("invalid final transcript")
            final_event = SttFinalEvent(
                utterance_id=active.utterance_id,
                revision=active.revision + 1,
                text=normalized,
                confidence=hypothesis.confidence,
                audio_end_ms=hypothesis.audio_end_ms,
                emitted_at_ms=_now_ms(),
            )
            ended_event = SpeechEndedEvent(
                utterance_id=active.utterance_id,
                reason=active.end_reason or "client_end",
                detected_at_ms=_now_ms(),
            )
        except (AttributeError, TypeError, ValueError, ValidationError):
            await self._cancel_active_utterance(
                utterance_id=active.utterance_id,
                reason="invalid_final",
                emit=True,
                terminal_kind="failed",
                error_code="INVALID_STT_FINAL",
                error_message="the local STT provider returned an invalid final transcript",
                expected_active=active,
                expected_epoch=epoch,
                stale_silent=True,
            )
            return

        idle_task: asyncio.Task[None] | None = None
        async with self._state_lock:
            if not self._utterance_is_current_locked(active, epoch):
                return
            active.revision = final_event.revision
            active.last_text = normalized
            active.status = "final"
            self._active_utterance = None
            self._remember_utterance(active.utterance_id, terminal="final")
            idle_task = active.idle_task
            self._queue_event_batch(
                (final_event, ended_event),
                scope="utterance",
                target_id=active.utterance_id,
            )
        if idle_task is not None and not idle_task.done():
            idle_task.cancel()
            await asyncio.gather(idle_task, return_exceptions=True)

    def _provider_finish_done(self, task: asyncio.Task[TranscriptHypothesis]) -> None:
        self._provider_finish_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            _LOGGER.debug(
                "speech provider finalization ended with error session=%s errorType=%s",
                self._session_id,
                type(error).__name__,
            )

    def _request_finalize_locked(
        self,
        active: _Utterance,
        *,
        reason: Literal["client_end", "vad_end"],
    ) -> None:
        if active.status == "listening":
            active.status = "finalizing"
            active.end_reason = reason
        if (
            active.status == "finalizing"
            and active.pending_frames == 0
            and active.finalize_task is None
            and not self._has_pending_binary_locked(active)
        ):
            self._spawn_finalizer_locked(active, active.epoch)

    def _has_pending_binary_locked(self, active: _Utterance) -> bool:
        return (
            self._pending_audio_header is not None
            and self._pending_audio_header.utterance_id == active.utterance_id
        )

    def _spawn_finalizer_locked(self, active: _Utterance, epoch: int) -> None:
        task = asyncio.create_task(
            self._finalize_utterance(active, epoch),
            name=f"{self._session_id}:finalize:{active.utterance_id}",
        )
        active.finalize_task = task
        self._finalizer_tasks.add(task)
        task.add_done_callback(self._finalizer_done)

    def _finalizer_done(self, task: asyncio.Task[None]) -> None:
        self._finalizer_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is None:
            return
        _LOGGER.error(
            "speech finalizer failed session=%s errorType=%s",
            self._session_id,
            type(error).__name__,
        )
        asyncio.create_task(self._close_internal_failure())

    def _spawn_idle_watch_locked(self, active: _Utterance) -> None:
        task = asyncio.create_task(
            self._watch_utterance_idle(active, active.epoch),
            name=f"{self._session_id}:idle:{active.utterance_id}",
        )
        active.idle_task = task
        self._idle_tasks.add(task)
        task.add_done_callback(self._idle_task_done)

    async def _watch_utterance_idle(self, active: _Utterance, epoch: int) -> None:
        timeout_seconds = self._settings.stt_idle_timeout_ms / 1_000
        while True:
            async with self._state_lock:
                if not self._utterance_is_current_locked(active, epoch):
                    return
                remaining = timeout_seconds - (time.monotonic() - active.last_audio_at)
            if remaining > 0:
                await asyncio.sleep(remaining)
                continue
            await self._cancel_active_utterance(
                utterance_id=active.utterance_id,
                reason="utterance_idle_timeout",
                emit=True,
                terminal_kind="failed",
                error_code="STT_IDLE_TIMEOUT",
                error_message="the microphone utterance exceeded its local idle timeout",
                expected_active=active,
                expected_epoch=epoch,
                stale_silent=True,
            )
            return

    def _idle_task_done(self, task: asyncio.Task[None]) -> None:
        self._idle_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is None:
            return
        _LOGGER.error(
            "speech idle watcher failed session=%s errorType=%s",
            self._session_id,
            type(error).__name__,
        )
        asyncio.create_task(self._close_internal_failure())

    async def _utterance_is_current(self, active: _Utterance, epoch: int) -> bool:
        async with self._state_lock:
            return self._utterance_is_current_locked(active, epoch)

    def _utterance_is_current_locked(self, active: _Utterance, epoch: int) -> bool:
        return (
            self._active_utterance is active
            and active.epoch == epoch
            and active.status in {"listening", "finalizing"}
        )

    def _read_active_utterance_locked(self) -> _Utterance | None:
        """Defeat stale narrowing when another task may change connection state."""

        return self._active_utterance

    def _purge_stt_frames(self, *, utterance_id: str | None = None) -> int:
        retained: list[_SttFrame] = []
        removed = 0
        while True:
            try:
                frame = self._stt_frames.get_nowait()
            except asyncio.QueueEmpty:
                break
            self._stt_frames.task_done()
            if utterance_id is None or frame.utterance.utterance_id == utterance_id:
                removed += 1
            else:
                retained.append(frame)
        for frame in retained:
            self._stt_frames.put_nowait(frame)
        return removed

    async def _enqueue_synthesis(self, control: SynthesizeControl) -> None:
        fixed_clip = None
        if control.clip_id is not None:
            fixed_clip = self._runtime.fixed_clip(control.clip_id)
            if fixed_clip is None:
                await self._send_error(
                    code="CLIP_NOT_READY",
                    message="the requested fixed local clip is not cached",
                    job_id=control.job_id,
                )
                return
            voice_id = self._runtime.fixed_clip_voice_id(fixed_clip.default_voice_role)
        else:
            if self._runtime.tts_lane_snapshot.quarantined:
                await self._send_error(
                    code="TTS_RESTART_REQUIRED",
                    message=(
                        "local synthesis is quarantined because provider termination could not be "
                        "confirmed; restart the speech service"
                    ),
                    job_id=control.job_id,
                    retryable=False,
                )
                await self._send_event(self._runtime.capabilities())
                return
            if not self._runtime.tts_provider.status.ready:
                await self._send_error(
                    code="TTS_NOT_READY",
                    message="load the configured local TTS provider before synthesis",
                    job_id=control.job_id,
                )
                return
            voice_id = control.voice_id or self._voice_for_actor(control.actor)
        job = TtsJob(
            job_id=control.job_id,
            response_id=control.response_id,
            actor=control.actor,
            sequence=control.sequence,
            text=control.text,
            clip_id=control.clip_id,
            voice_id=voice_id,
            enqueued_at_ms=_now_ms(),
            is_final=control.is_final,
        )
        try:
            await self._phrase_queue.enqueue(job)
        except TtsBackpressureError:
            await self._send_error(
                code="TTS_BACKPRESSURE",
                message="the local phrase queue is full; retry after playback advances",
                job_id=control.job_id,
            )
            return
        except ValueError:
            await self._send_error(
                code="INVALID_TTS_SEQUENCE",
                message="TTS job and phrase sequence identities must be unique and contiguous",
                job_id=control.job_id,
            )
            return
        self._remember_job(control.job_id, control.response_id)

    async def _tts_worker(self) -> None:
        while True:
            try:
                lease = await self._phrase_queue.next()
            except (RuntimeError, asyncio.CancelledError):
                return
            queue_latency_ms = max(0, _now_ms() - lease.job.enqueued_at_ms)
            synthesis_started = time.perf_counter()
            try:
                cached = lease.job.clip_id is not None
                if cached:
                    fixed_clip = self._runtime.fixed_clip(lease.job.clip_id or "")
                    if fixed_clip is None:
                        raise RuntimeError("fixed courtroom clip became unavailable")
                    phrase = SynthesizedPhrase(
                        pcm_s16le=fixed_clip.pcm_s16le,
                        sample_rate_hz=fixed_clip.sample_rate_hz,
                        channels=1,
                        duration_ms=fixed_clip.duration_ms,
                        timings=tuple(
                            SynthesisTiming(
                                kind=mark.kind,
                                value=mark.value,
                                start_ms=mark.start_ms,
                                end_ms=mark.end_ms,
                            )
                            for mark in fixed_clip.timings
                        ),
                    )
                    synthesis_latency_ms = 0
                else:
                    phrase = await self._runtime.synthesize_phrase(
                        text=lease.job.text or "",
                        voice_id=lease.job.voice_id,
                        cancel_event=lease.cancel_event,
                    )
                    synthesis_latency_ms = max(
                        0, int((time.perf_counter() - synthesis_started) * 1_000)
                    )
                derived_duration_ms = self._validate_synthesized_phrase(phrase)
                if not await self._phrase_queue.mark_streaming(lease):
                    raise asyncio.CancelledError
                self._queue_event_batch(
                    (
                        TtsStartedEvent(
                            job_id=lease.job.job_id,
                            response_id=lease.job.response_id,
                            actor=lease.job.actor,
                            sequence=lease.job.sequence,
                            voice_id=lease.job.voice_id,
                            cached=cached,
                            queue_latency_ms=queue_latency_ms,
                        ),
                        TtsTimingEvent(
                            job_id=lease.job.job_id,
                            response_id=lease.job.response_id,
                            actor=lease.job.actor,
                            sequence=lease.job.sequence,
                            marks=tuple(
                                TimingMark(
                                    kind=mark.kind,
                                    value=mark.value,
                                    start_ms=mark.start_ms,
                                    end_ms=mark.end_ms,
                                )
                                for mark in phrase.timings
                            ),
                        ),
                    ),
                    scope="tts",
                    target_id=lease.job.job_id,
                )
                await self._stream_phrase(lease, phrase)
                await self._ack_window.wait_for_job_drained(
                    job_id=lease.job.job_id,
                    cancel_event=lease.cancel_event,
                )
                if not await self._phrase_queue.is_current(lease):
                    raise asyncio.CancelledError
                if not await self._phrase_queue.finish(lease):
                    raise asyncio.CancelledError
                self._queue_event_batch(
                    (
                        TtsFinishedEvent(
                            job_id=lease.job.job_id,
                            response_id=lease.job.response_id,
                            actor=lease.job.actor,
                            sequence=lease.job.sequence,
                            audio_duration_ms=derived_duration_ms,
                            synthesis_latency_ms=synthesis_latency_ms,
                        ),
                    ),
                    scope="tts",
                    target_id=lease.job.job_id,
                )
            except ProviderCancelled:
                if await self._phrase_queue.is_current(lease):
                    await self._send_error(
                        code="TTS_PROVIDER_FAILED",
                        message="the local TTS provider cancelled an active phrase unexpectedly",
                        job_id=lease.job.job_id,
                    )
                    await self._cancel_synthesis_scope(
                        scope="response",
                        target_id=lease.job.response_id,
                        reason="tts_provider_cancelled",
                        emit_empty=False,
                    )
                await self._ack_window.cancel_job(lease.job.job_id)
                await self._phrase_queue.finish(lease)
            except asyncio.CancelledError:
                await self._ack_window.cancel_job(lease.job.job_id)
                await self._phrase_queue.finish(lease)
            except TtsBackpressureError:
                await self._send_error(
                    code="TTS_ACK_TIMEOUT",
                    message="browser playback did not acknowledge local audio in time",
                    job_id=lease.job.job_id,
                )
                await self._cancel_synthesis_scope(
                    scope="response",
                    target_id=lease.job.response_id,
                    reason="tts_ack_timeout",
                    emit_empty=False,
                )
                await self._phrase_queue.finish(lease)
            except TtsLaneQuarantinedError:
                if await self._phrase_queue.is_current(lease):
                    await self._send_error(
                        code="TTS_RESTART_REQUIRED",
                        message=(
                            "local synthesis was quarantined because provider termination could "
                            "not be confirmed; restart the speech service"
                        ),
                        job_id=lease.job.job_id,
                        retryable=False,
                    )
                    await self._send_event(self._runtime.capabilities())
                    await self._cancel_synthesis_scope(
                        scope="response",
                        target_id=lease.job.response_id,
                        reason="tts_lane_quarantined",
                        emit_empty=False,
                    )
                await self._ack_window.cancel_job(lease.job.job_id)
                await self._phrase_queue.finish(lease)
            except Exception as error:
                _LOGGER.warning(
                    "TTS phrase failed session=%s errorType=%s",
                    self._session_id,
                    type(error).__name__,
                )
                if await self._phrase_queue.is_current(lease):
                    await self._send_error(
                        code="TTS_PROVIDER_FAILED",
                        message="the local TTS provider returned invalid phrase audio",
                        job_id=lease.job.job_id,
                    )
                    await self._cancel_synthesis_scope(
                        scope="response",
                        target_id=lease.job.response_id,
                        reason="tts_provider_failure",
                        emit_empty=False,
                    )
                    await self._phrase_queue.finish(lease)
                else:
                    await self._phrase_queue.finish(lease)

    async def _stream_phrase(self, lease: TtsLease, phrase: SynthesizedPhrase) -> None:
        frame_bytes = phrase.sample_rate_hz * 2 * self._settings.tts_audio_frame_ms // 1_000
        frame_bytes -= frame_bytes % 2
        for frame_sequence, offset in enumerate(range(0, len(phrase.pcm_s16le), frame_bytes)):
            if not await self._phrase_queue.is_current(lease):
                raise asyncio.CancelledError
            audio = phrase.pcm_s16le[offset : offset + frame_bytes]
            frame_token = f"frame:{uuid.uuid4()}"
            reservation = AckReservation(
                job_id=lease.job.job_id,
                response_id=lease.job.response_id,
                frame_sequence=frame_sequence,
                frame_token=frame_token,
                byte_length=len(audio),
            )
            await self._ack_window.reserve(
                reservation,
                cancel_event=lease.cancel_event,
            )
            if not await self._phrase_queue.is_current(lease):
                await self._ack_window.cancel_job(lease.job.job_id)
                raise asyncio.CancelledError
            duration_ms = max(1, round(len(audio) * 1_000 / (phrase.sample_rate_hz * 2)))
            event = TtsAudioEvent(
                job_id=lease.job.job_id,
                response_id=lease.job.response_id,
                actor=lease.job.actor,
                sequence=lease.job.sequence,
                frame_sequence=frame_sequence,
                frame_token=frame_token,
                byte_length=len(audio),
                duration_ms=duration_ms,
                sample_rate_hz=phrase.sample_rate_hz,
            )
            await self._send_audio(event, audio, reservation)
            await self._send_flow_control()

    def _validate_synthesized_phrase(self, phrase: SynthesizedPhrase) -> int:
        if (
            phrase.channels != 1
            or phrase.sample_rate_hz < 8_000
            or phrase.sample_rate_hz > 48_000
            or not phrase.pcm_s16le
            or len(phrase.pcm_s16le) % 2 != 0
        ):
            raise ValueError("invalid synthesized phrase")
        derived_duration_ms = round(
            len(phrase.pcm_s16le) * 1_000 / (phrase.sample_rate_hz * phrase.channels * 2)
        )
        max_bytes = phrase.sample_rate_hz * 2 * self._settings.tts_max_phrase_duration_ms // 1_000
        if (
            phrase.duration_ms <= 0
            or phrase.duration_ms > self._settings.tts_max_phrase_duration_ms
            or abs(phrase.duration_ms - derived_duration_ms) > 1
            or len(phrase.pcm_s16le) > max_bytes
            or len(phrase.timings) > 2_048
            or any(
                timing.start_ms < 0
                or timing.end_ms < timing.start_ms
                or timing.end_ms > phrase.duration_ms
                for timing in phrase.timings
            )
        ):
            raise ValueError("invalid synthesized phrase")
        return max(1, derived_duration_ms)

    async def _cancel_synthesis(self, control: CancelSynthesisControl) -> None:
        target_id = control.job_id if control.scope == "job" else control.response_id
        await self._cancel_synthesis_scope(
            scope=control.scope,
            target_id=target_id,
            reason=control.reason,
            emit_empty=True,
        )

    async def _cancel_synthesis_scope(
        self,
        *,
        scope: Literal["job", "response", "all"],
        target_id: str | None,
        reason: str,
        emit_empty: bool,
    ) -> None:
        started = time.perf_counter()
        cancellations = await self._phrase_queue.cancel(scope=scope, target_id=target_id)
        cancelled_ids = {cancellation.job_id for cancellation in cancellations}
        outbound_fences = self._purge_outbound(scope="tts", target_ids=cancelled_ids)
        await self._await_outbound_fences(outbound_fences)
        events: list[ProtocolModel] = []
        for cancellation in cancellations:
            await self._ack_window.cancel_job(cancellation.job_id)
            events.append(
                CancelledEvent(
                    target="job",
                    target_id=cancellation.job_id,
                    reason=reason,
                    cancellation_latency_ms=max(0, int((time.perf_counter() - started) * 1_000)),
                )
            )
        if not cancellations and emit_empty:
            target: Literal["job", "response", "all_synthesis"]
            if scope == "all":
                target = "all_synthesis"
            elif scope == "response":
                target = "response"
            else:
                target = "job"
            events.append(
                CancelledEvent(
                    target=target,
                    target_id=None if scope == "all" else target_id,
                    reason=reason,
                    cancellation_latency_ms=0,
                )
            )
        if events:
            self._queue_event_batch(tuple(events))
        await self._send_flow_control()

    async def _acknowledge_tts(self, control: AckTtsAudioControl) -> None:
        expected_response = self._job_responses.get(control.job_id)
        if expected_response is not None and expected_response != control.response_id:
            acknowledged = False
        else:
            acknowledged = await self._ack_window.acknowledge(
                job_id=control.job_id,
                response_id=control.response_id,
                frame_sequence=control.frame_sequence,
                frame_token=control.frame_token,
                byte_length=control.byte_length,
            )
        if not acknowledged:
            await self._send_error(
                code="STALE_TTS_ACK",
                message="TTS acknowledgement does not match an outstanding local frame",
                job_id=control.job_id,
            )
            return
        await self._send_flow_control()

    async def _send_flow_control(self) -> None:
        if self._closed or not self._hello_received:
            return
        credits = await self._input_credits.snapshot()
        outstanding = await self._ack_window.outstanding_bytes()
        await self._send_event(
            FlowControlEvent(
                stt_available_frames=credits.available_frames,
                stt_available_bytes=credits.available_bytes,
                tts_window_bytes=self._ack_window.maximum_bytes,
                tts_outstanding_bytes=outstanding,
            )
        )

    async def _outbound_worker(self) -> None:
        while not self._closed:
            await self._outbound_ready.wait()
            if not self._outbound:
                self._outbound_ready.clear()
                continue
            batch = self._outbound.popleft()
            if not self._outbound:
                self._outbound_ready.clear()
            self._outbound_current = batch
            sent = False
            try:
                if batch.cancel_event.is_set():
                    raise _OutboundCancelled
                for packet_index, packet in enumerate(batch.packets):
                    if packet_index == 0:
                        await self._send_first_outbound_packet(batch, packet)
                        batch.committed = True
                    else:
                        if isinstance(packet, bytes) and batch.reservation is not None:
                            delivering = await self._ack_window.mark_delivering(
                                frame_token=batch.reservation.frame_token
                            )
                            if not delivering:
                                raise _OutboundCancelled
                        await self._send_outbound_packet(packet)
                if batch.reservation is not None:
                    sent = await self._ack_window.mark_sent(
                        frame_token=batch.reservation.frame_token
                    )
                else:
                    sent = True
            except _OutboundCancelled:
                if batch.reservation is not None:
                    await self._ack_window.cancel_job(batch.reservation.job_id)
                self._complete_outbound(batch, sent=False)
                continue
            except asyncio.CancelledError:
                if batch.reservation is not None:
                    await self._ack_window.cancel_job(batch.reservation.job_id)
                self._complete_outbound(batch, sent=False)
                raise
            except Exception as error:
                _LOGGER.warning(
                    "speech transport send failed session=%s errorType=%s",
                    self._session_id,
                    type(error).__name__,
                )
                if batch.reservation is not None:
                    await self._ack_window.cancel_job(batch.reservation.job_id)
                self._complete_outbound(batch, sent=False)
                self._fail_pending_outbound()
                try:
                    await asyncio.wait_for(
                        self._websocket.close(code=4_011, reason="speech transport stalled"),
                        timeout=_SOCKET_SEND_TIMEOUT_SECONDS,
                    )
                except Exception:
                    pass
                return
            finally:
                if self._outbound_current is batch:
                    self._outbound_current = None
            self._complete_outbound(batch, sent=sent)

    async def _send_first_outbound_packet(
        self,
        batch: _OutboundBatch,
        packet: str | bytes,
    ) -> None:
        if batch.cancel_event.is_set():
            raise _OutboundCancelled
        send_task = self._spawn_transport_send(packet)
        cancel_waiter = asyncio.create_task(
            batch.cancel_event.wait(),
            name=f"{self._session_id}:outbound-cancel-fence",
        )
        try:
            done, _ = await asyncio.wait(
                {send_task, cancel_waiter},
                timeout=_SOCKET_SEND_TIMEOUT_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if send_task in done:
                await send_task
                return
            send_task.cancel()
            stopped, _ = await asyncio.wait(
                {send_task},
                timeout=_SOCKET_SEND_TIMEOUT_SECONDS,
            )
            if send_task not in stopped:
                raise RuntimeError("cancelled WebSocket send did not terminate")
            await asyncio.gather(send_task, return_exceptions=True)
            if cancel_waiter in done:
                raise _OutboundCancelled
            raise TimeoutError("WebSocket send exceeded its local deadline")
        except asyncio.CancelledError:
            send_task.cancel()
            raise
        finally:
            cancel_waiter.cancel()
            await asyncio.gather(cancel_waiter, return_exceptions=True)

    async def _send_outbound_packet(self, packet: str | bytes) -> None:
        send_task = self._spawn_transport_send(packet)
        try:
            done, _ = await asyncio.wait(
                {send_task},
                timeout=_SOCKET_SEND_TIMEOUT_SECONDS,
            )
            if send_task not in done:
                send_task.cancel()
                raise TimeoutError("WebSocket send exceeded its local deadline")
            await send_task
        except asyncio.CancelledError:
            send_task.cancel()
            raise

    def _spawn_transport_send(self, packet: str | bytes) -> asyncio.Task[None]:
        if isinstance(packet, str):
            awaitable = self._websocket.send_text(packet)
        else:
            awaitable = self._websocket.send_bytes(packet)
        task = asyncio.create_task(
            awaitable,
            name=f"{self._session_id}:transport-send",
        )
        self._transport_tasks.add(task)
        task.add_done_callback(self._transport_task_done)
        return task

    def _transport_task_done(self, task: asyncio.Task[None]) -> None:
        self._transport_tasks.discard(task)
        if not task.cancelled():
            task.exception()

    def _enqueue_outbound(
        self,
        packets: tuple[str | bytes, ...],
        *,
        scope: Literal["utterance", "tts"] | None = None,
        target_id: str | None = None,
        reservation: AckReservation | None = None,
        completion: bool = False,
    ) -> asyncio.Future[bool] | None:
        future = asyncio.get_running_loop().create_future() if completion else None
        if self._closed or len(self._outbound) >= _MAX_OUTBOUND_BATCHES:
            if future is not None:
                future.set_result(False)
            if not self._closed:
                self._fail_pending_outbound()
                asyncio.create_task(self._close_overloaded_transport())
            return future
        self._outbound.append(
            _OutboundBatch(
                packets=packets,
                scope=scope,
                target_id=target_id,
                reservation=reservation,
                completion=future,
            )
        )
        self._outbound_ready.set()
        return future

    def _purge_outbound(
        self,
        *,
        scope: Literal["utterance", "tts"],
        target_ids: set[str],
    ) -> tuple[asyncio.Future[bool], ...]:
        fences: list[asyncio.Future[bool]] = []
        current = self._outbound_current
        if current is not None and current.scope == scope and current.target_id in target_ids:
            current.cancel_event.set()
            if current.completion is None:
                current.completion = asyncio.get_running_loop().create_future()
            fences.append(current.completion)
        retained: deque[_OutboundBatch] = deque()
        for batch in self._outbound:
            if batch.scope == scope and batch.target_id in target_ids:
                batch.cancel_event.set()
                self._complete_outbound(batch, sent=False)
            else:
                retained.append(batch)
        self._outbound = retained
        if not self._outbound:
            self._outbound_ready.clear()
        return tuple(fences)

    async def _await_outbound_fences(
        self,
        fences: tuple[asyncio.Future[bool], ...],
    ) -> None:
        if not fences:
            return
        _, pending = await asyncio.wait(
            fences,
            timeout=_SOCKET_SEND_TIMEOUT_SECONDS * 2,
        )
        if pending:
            _LOGGER.error(
                "speech cancellation could not fence outbound transport session=%s count=%s",
                self._session_id,
                len(pending),
            )
            await self._close_internal_failure()

    def _fail_pending_outbound(self) -> None:
        if self._outbound_current is not None:
            self._outbound_current.cancel_event.set()
        while self._outbound:
            batch = self._outbound.popleft()
            batch.cancel_event.set()
            self._complete_outbound(batch, sent=False)
        self._outbound_ready.clear()

    @staticmethod
    def _complete_outbound(batch: _OutboundBatch, *, sent: bool) -> None:
        if batch.completion is not None and not batch.completion.done():
            batch.completion.set_result(sent)

    async def _close_overloaded_transport(self) -> None:
        try:
            await asyncio.wait_for(
                self._websocket.close(code=4_013, reason="speech output overloaded"),
                timeout=_SOCKET_SEND_TIMEOUT_SECONDS,
            )
        except Exception:
            pass

    async def _close_internal_failure(self) -> None:
        try:
            await asyncio.wait_for(
                self._websocket.close(code=1_011, reason="speech worker failed"),
                timeout=_SOCKET_SEND_TIMEOUT_SECONDS,
            )
        except Exception:
            pass

    async def _send_event(self, event: ProtocolModel) -> None:
        self._enqueue_outbound((dump_message(event),))

    def _queue_event_batch(
        self,
        events: tuple[ProtocolModel, ...],
        *,
        scope: Literal["utterance", "tts"] | None = None,
        target_id: str | None = None,
    ) -> None:
        self._enqueue_outbound(
            tuple(dump_message(event) for event in events),
            scope=scope,
            target_id=target_id,
        )

    async def _send_audio(
        self,
        event: TtsAudioEvent,
        audio: bytes,
        reservation: AckReservation,
    ) -> None:
        completion = self._enqueue_outbound(
            (dump_message(event), audio),
            scope="tts",
            target_id=event.job_id,
            reservation=reservation,
            completion=True,
        )
        if completion is None or not await completion:
            raise asyncio.CancelledError

    async def _send_error(
        self,
        *,
        code: str,
        message: str,
        request_id: str | None = None,
        utterance_id: str | None = None,
        job_id: str | None = None,
        fatal: bool = False,
        retryable: bool | None = None,
    ) -> None:
        await self._send_event(
            ErrorEvent(
                code=code,
                message=message,
                request_id=request_id,
                utterance_id=utterance_id,
                job_id=job_id,
                retryable=not fatal if retryable is None else retryable,
                fatal=fatal,
            )
        )

    async def _fatal_protocol_error(self, code: str, message: str) -> None:
        event = ErrorEvent(
            code=code,
            message=message,
            retryable=False,
            fatal=True,
        )
        completion = self._enqueue_outbound((dump_message(event),), completion=True)
        if completion is not None:
            try:
                await asyncio.wait_for(
                    asyncio.shield(completion), timeout=_SOCKET_SEND_TIMEOUT_SECONDS
                )
            except TimeoutError:
                pass
        try:
            await asyncio.wait_for(
                self._websocket.close(code=4_400, reason="protocol error"),
                timeout=_SOCKET_SEND_TIMEOUT_SECONDS,
            )
        except Exception:
            pass

    async def _shutdown(self) -> None:
        if self._closed:
            return
        self._closed = True
        async with self._state_lock:
            active = self._active_utterance
            if active is not None:
                active.status = "cancelled"
                active.last_text = None
                self._active_utterance = None
            self._pending_audio_header = None
        idle_tasks = list(self._idle_tasks)
        for task in idle_tasks:
            task.cancel()
        active_cancel: asyncio.Task[None] | None = None
        if active is not None:
            active_cancel = self._spawn_stt_session_disposal(
                active.stt_session,
                label=f"shutdown:{active.utterance_id}",
            )
        self._purge_stt_frames()
        self._fail_pending_outbound()
        await self._phrase_queue.close()
        await self._ack_window.clear()
        await self._input_credits.clear()
        utterance_tasks = list(self._finalizer_tasks | self._idle_tasks | self._cleanup_tasks)
        if active_cancel is not None:
            utterance_tasks.append(active_cancel)
        if utterance_tasks:
            done, pending = await asyncio.wait(utterance_tasks, timeout=0.25)
            if done:
                await asyncio.gather(*done, return_exceptions=True)
            if pending:
                _LOGGER.warning(
                    "speech shutdown left cleanup active session=%s count=%s",
                    self._session_id,
                    len(pending),
                )
        tasks = [
            task
            for task in (
                self._receive_task,
                self._stt_worker_task,
                self._tts_worker_task,
                self._outbound_worker_task,
            )
            if task is not None and task is not asyncio.current_task()
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            done, pending = await asyncio.wait(tasks, timeout=0.25)
            if done:
                await asyncio.gather(*done, return_exceptions=True)
            if pending:
                for task in pending:
                    task.add_done_callback(self._consume_detached_task)
                _LOGGER.warning(
                    "speech shutdown left provider tasks quarantined session=%s count=%s",
                    self._session_id,
                    len(pending),
                )
        self._job_responses.clear()
        self._voice_by_actor.clear()

    def _remember_utterance(
        self,
        utterance_id: str,
        *,
        terminal: Literal["final", "cancelled", "failed"] | None = None,
    ) -> None:
        if utterance_id not in self._used_utterance_ids:
            self._used_utterance_ids.add(utterance_id)
            self._utterance_order.append(utterance_id)
        if terminal is not None:
            self._utterance_terminals[utterance_id] = terminal
        while len(self._utterance_order) > _UTTERANCE_TOMBSTONES:
            expired_id = self._utterance_order.popleft()
            self._used_utterance_ids.discard(expired_id)
            self._utterance_terminals.pop(expired_id, None)

    def _remember_job(self, job_id: str, response_id: str) -> None:
        self._job_responses[job_id] = response_id
        self._job_order.append(job_id)
        while len(self._job_order) > _JOB_TOMBSTONES:
            self._job_responses.pop(self._job_order.popleft(), None)

    @staticmethod
    def _is_loopback_peer(host: str) -> bool:
        try:
            return ipaddress.ip_address(host).is_loopback
        except ValueError:
            return False

    @staticmethod
    def _voice_mapping(entries: tuple[str, ...]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for entry in entries:
            actor, separator, voice = entry.partition("=")
            if not separator or not actor or not voice:
                continue
            mapping[actor] = voice
        return mapping

    def _voice_for_actor(self, actor: str) -> str:
        direct = self._voice_by_actor.get(actor)
        if direct is not None:
            return direct
        normalized = actor.lower()
        if "judge" in normalized:
            role = "judge"
        elif "counsel" in normalized or "advocate" in normalized:
            role = "opposing_counsel"
        else:
            role = "witness"
        return self._voice_by_actor.get(role, "af_heart")
