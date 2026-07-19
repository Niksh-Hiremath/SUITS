"""Explicit, privacy-safe closed-loop smoke for the local speech providers.

The smoke has no text or audio inputs: it synthesizes one fixed educational
courtroom phrase, keeps PCM in memory, and feeds it to the configured local STT
provider at microphone cadence. It imports no OpenAI or Convex integration.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
import sys
import time
import unicodedata
from array import array
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from typing import Awaitable, Callable, Literal, Mapping, Protocol

from .config import SpeechMode, SpeechSettings
from .health import SpeechRuntime
from .providers.base import AudioChunk, StreamingSttSession

LIVE_SMOKE_ENV = "SUITS_RUN_LIVE_SPEECH_SMOKE"
SMOKE_PHRASE = "May it please the court."
SMOKE_VOICE_ROLE = "opposing_counsel"
EXPECTED_NORMALIZED_FINAL = "may it please the court"

SOURCE_SAMPLE_RATE_HZ = 24_000
TARGET_SAMPLE_RATE_HZ = 16_000
CHUNK_DURATION_MS = 20
CHUNK_SAMPLE_COUNT = TARGET_SAMPLE_RATE_HZ * CHUNK_DURATION_MS // 1_000
CHUNK_BYTE_COUNT = CHUNK_SAMPLE_COUNT * 2

EXIT_SUCCESS = 0
EXIT_FAILURE = 1
EXIT_SKIPPED = 2

SmokeStage = Literal["load", "tts", "audio", "stt", "finalize", "validation"]
Clock = Callable[[], float]


class Sleeper(Protocol):
    def __call__(self, delay: float) -> Awaitable[None]: ...


class SmokeFailure(RuntimeError):
    """A failure whose public code and stage contain no provider content."""

    def __init__(self, *, code: str, stage: SmokeStage) -> None:
        super().__init__(code)
        self.code = code
        self.stage = stage


class _DiscardProviderOutput(io.TextIOBase):
    """Drop dependency chatter so stdout remains one safe JSON document."""

    def write(self, text: str, /) -> int:
        return len(text)

    def flush(self) -> None:
        return None


@dataclass(frozen=True, slots=True)
class SmokeTimings:
    load_ms: int
    tts_ms: int
    audio_prepare_ms: int
    audio_stream_ms: int
    first_partial_ms: int
    finalize_ms: int
    total_ms: int

    def to_public_dict(self) -> dict[str, int]:
        return {
            "load": self.load_ms,
            "tts": self.tts_ms,
            "audioPrepare": self.audio_prepare_ms,
            "audioStream": self.audio_stream_ms,
            "firstPartial": self.first_partial_ms,
            "finalize": self.finalize_ms,
            "total": self.total_ms,
        }


@dataclass(frozen=True, slots=True)
class SmokeSuccess:
    mode: SpeechMode
    timings: SmokeTimings
    source_duration_ms: int
    streamed_duration_ms: int
    chunk_count: int
    partial_count: int

    def to_public_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": "speech-live-smoke.v1",
            "status": "passed",
            "exitCode": EXIT_SUCCESS,
            "mode": self.mode,
            "expectedNormalizedFinal": EXPECTED_NORMALIZED_FINAL,
            "finalMatched": True,
            "partialCount": self.partial_count,
            "audio": {
                "sourceSampleRateHz": SOURCE_SAMPLE_RATE_HZ,
                "targetSampleRateHz": TARGET_SAMPLE_RATE_HZ,
                "chunkDurationMs": CHUNK_DURATION_MS,
                "chunkCount": self.chunk_count,
                "sourceDurationMs": self.source_duration_ms,
                "streamedDurationMs": self.streamed_duration_ms,
            },
            "timingsMs": self.timings.to_public_dict(),
        }


def normalize_transcript(text: str) -> str:
    """Normalize the fixed English expectation without echoing provider text."""

    normalized = unicodedata.normalize("NFKC", text).casefold()
    return " ".join(re.findall(r"[a-z0-9]+", normalized))


def resample_pcm_s16le_24k_to_16k(pcm_s16le: bytes) -> bytes:
    """Linearly resample mono signed 16-bit PCM entirely in memory."""

    if not pcm_s16le or len(pcm_s16le) % 2:
        raise SmokeFailure(code="invalid_tts_pcm", stage="audio")

    source = array("h")
    source.frombytes(pcm_s16le)
    if sys.byteorder != "little":
        source.byteswap()

    output_count = ((len(source) - 1) * TARGET_SAMPLE_RATE_HZ) // SOURCE_SAMPLE_RATE_HZ + 1
    output = array("h")
    for output_index in range(output_count):
        source_numerator = output_index * SOURCE_SAMPLE_RATE_HZ
        left_index, remainder = divmod(source_numerator, TARGET_SAMPLE_RATE_HZ)
        right_index = min(left_index + 1, len(source) - 1)
        weighted = (
            source[left_index] * (TARGET_SAMPLE_RATE_HZ - remainder)
            + source[right_index] * remainder
        )
        if weighted >= 0:
            sample = (weighted + TARGET_SAMPLE_RATE_HZ // 2) // TARGET_SAMPLE_RATE_HZ
        else:
            sample = -((-weighted + TARGET_SAMPLE_RATE_HZ // 2) // TARGET_SAMPLE_RATE_HZ)
        output.append(sample)

    if sys.byteorder != "little":
        output.byteswap()
    return output.tobytes()


def exact_20ms_chunks(pcm_s16le: bytes) -> tuple[bytes, ...]:
    """Split PCM into exact 20 ms frames, zero-padding only the final frame."""

    if not pcm_s16le or len(pcm_s16le) % 2:
        raise SmokeFailure(code="invalid_resampled_pcm", stage="audio")
    chunks: list[bytes] = []
    for offset in range(0, len(pcm_s16le), CHUNK_BYTE_COUNT):
        chunk = pcm_s16le[offset : offset + CHUNK_BYTE_COUNT]
        if len(chunk) < CHUNK_BYTE_COUNT:
            chunk += bytes(CHUNK_BYTE_COUNT - len(chunk))
        chunks.append(chunk)
    return tuple(chunks)


def _configured_voice(settings: SpeechSettings) -> str:
    for mapping in settings.tts_voices:
        role, separator, voice_id = mapping.partition("=")
        if separator and role == SMOKE_VOICE_ROLE and voice_id:
            return voice_id
    raise SmokeFailure(code="configured_smoke_voice_missing", stage="validation")


def _elapsed_ms(started: float, finished: float) -> int:
    return max(0, round((finished - started) * 1_000))


async def _cancel_safely(session: StreamingSttSession) -> None:
    task = asyncio.create_task(session.cancel(), name="speech:live-smoke:cancel")
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            # Defer repeated caller cancellation until the provider has either
            # confirmed physical exit or raised its termination error.
            continue
        except BaseException:
            break
    await asyncio.gather(task, return_exceptions=True)


async def run_smoke(
    settings: SpeechSettings,
    runtime: SpeechRuntime,
    *,
    clock: Clock = time.perf_counter,
    sleep: Sleeper = asyncio.sleep,
) -> SmokeSuccess:
    """Run one fixed local TTS-to-STT loop and return content-free evidence."""

    if settings.mode == "fake":
        raise SmokeFailure(code="real_local_providers_required", stage="validation")
    if settings.stt_sample_rate_hz != TARGET_SAMPLE_RATE_HZ:
        raise SmokeFailure(code="unexpected_stt_sample_rate", stage="validation")

    total_started = clock()
    stage: SmokeStage = "load"
    session: StreamingSttSession | None = None
    tts_cancel = asyncio.Event()
    try:
        load_started = clock()
        await runtime.load_models()
        load_finished = clock()
        if not runtime.models_ready:
            raise SmokeFailure(code="local_providers_not_ready", stage="load")

        stage = "tts"
        tts_started = clock()
        phrase = await runtime.synthesize_phrase(
            text=SMOKE_PHRASE,
            voice_id=_configured_voice(settings),
            cancel_event=tts_cancel,
        )
        tts_finished = clock()
        if (
            phrase.sample_rate_hz != SOURCE_SAMPLE_RATE_HZ
            or phrase.channels != 1
            or phrase.duration_ms <= 0
        ):
            raise SmokeFailure(code="unexpected_tts_audio_format", stage="tts")

        stage = "audio"
        audio_prepare_started = clock()
        resampled = resample_pcm_s16le_24k_to_16k(phrase.pcm_s16le)
        chunks = exact_20ms_chunks(resampled)
        audio_prepare_finished = clock()

        stage = "stt"
        session = await runtime.create_stt_session(sample_rate_hz=TARGET_SAMPLE_RATE_HZ)
        audio_started = clock()
        first_partial_at: float | None = None
        partial_count = 0
        for sequence, pcm_chunk in enumerate(chunks):
            deadline = audio_started + sequence * CHUNK_DURATION_MS / 1_000
            delay = deadline - clock()
            if delay > 0:
                await sleep(delay)
            hypotheses = await session.push_audio(
                AudioChunk(
                    sequence=sequence,
                    pcm_s16le=pcm_chunk,
                    duration_ms=CHUNK_DURATION_MS,
                )
            )
            for hypothesis in hypotheses:
                if hypothesis.is_final:
                    raise SmokeFailure(code="premature_stt_final", stage="stt")
                if normalize_transcript(hypothesis.text):
                    partial_count += 1
                    if first_partial_at is None:
                        first_partial_at = clock()

        stream_deadline = audio_started + len(chunks) * CHUNK_DURATION_MS / 1_000
        remaining = stream_deadline - clock()
        if remaining > 0:
            await sleep(remaining)
        audio_finished = clock()

        stage = "finalize"
        finalize_started = clock()
        final = await session.finish()
        finalize_finished = clock()
        if not final.is_final:
            raise SmokeFailure(code="stt_final_flag_missing", stage="finalize")
        if first_partial_at is None or partial_count == 0:
            raise SmokeFailure(code="stt_partial_missing", stage="finalize")
        if normalize_transcript(final.text) != EXPECTED_NORMALIZED_FINAL:
            raise SmokeFailure(code="stt_final_mismatch", stage="finalize")

        total_finished = clock()
        return SmokeSuccess(
            mode=settings.mode,
            timings=SmokeTimings(
                load_ms=_elapsed_ms(load_started, load_finished),
                tts_ms=_elapsed_ms(tts_started, tts_finished),
                audio_prepare_ms=_elapsed_ms(audio_prepare_started, audio_prepare_finished),
                audio_stream_ms=_elapsed_ms(audio_started, audio_finished),
                first_partial_ms=_elapsed_ms(audio_started, first_partial_at),
                finalize_ms=_elapsed_ms(finalize_started, finalize_finished),
                total_ms=_elapsed_ms(total_started, total_finished),
            ),
            source_duration_ms=phrase.duration_ms,
            streamed_duration_ms=len(chunks) * CHUNK_DURATION_MS,
            chunk_count=len(chunks),
            partial_count=partial_count,
        )
    except SmokeFailure:
        tts_cancel.set()
        if session is not None:
            await _cancel_safely(session)
        raise
    except asyncio.CancelledError:
        tts_cancel.set()
        if session is not None:
            await _cancel_safely(session)
        raise SmokeFailure(code="smoke_cancelled", stage=stage) from None
    except BaseException:
        tts_cancel.set()
        if session is not None:
            await _cancel_safely(session)
        raise SmokeFailure(code=f"{stage}_failed", stage=stage) from None


async def _run_configured(settings: SpeechSettings) -> SmokeSuccess:
    return await run_smoke(settings, SpeechRuntime(settings=settings))


def _run_configured_silently(settings: SpeechSettings) -> SmokeSuccess:
    sink = _DiscardProviderOutput()
    previous_logging_level = logging.root.manager.disable
    try:
        logging.disable(logging.CRITICAL)
        with redirect_stdout(sink), redirect_stderr(sink):
            return asyncio.run(_run_configured(settings))
    finally:
        logging.disable(previous_logging_level)


def _failure_payload(*, code: str, stage: str) -> dict[str, object]:
    return {
        "schemaVersion": "speech-live-smoke.v1",
        "status": "failed",
        "exitCode": EXIT_FAILURE,
        "code": code,
        "stage": stage,
    }


def _skip_payload() -> dict[str, object]:
    return {
        "schemaVersion": "speech-live-smoke.v1",
        "status": "skipped",
        "exitCode": EXIT_SKIPPED,
        "code": "explicit_opt_in_required",
        "requiredEnvironment": f"{LIVE_SMOKE_ENV}=1",
    }


def main(environ: Mapping[str, str] | None = None) -> int:
    """Emit one safe JSON document with distinct pass, fail, and skip codes."""

    source = os.environ if environ is None else environ
    if source.get(LIVE_SMOKE_ENV) != "1":
        print(json.dumps(_skip_payload(), indent=2, sort_keys=True, allow_nan=False))
        return EXIT_SKIPPED

    try:
        settings = SpeechSettings.from_env(source)
    except ValueError:
        payload = _failure_payload(code="configuration_invalid", stage="configuration")
        exit_code = EXIT_FAILURE
    else:
        try:
            result = _run_configured_silently(settings)
        except SmokeFailure as error:
            payload = _failure_payload(code=error.code, stage=error.stage)
            exit_code = EXIT_FAILURE
        except BaseException:
            payload = _failure_payload(code="smoke_failed", stage="runtime")
            exit_code = EXIT_FAILURE
        else:
            payload = result.to_public_dict()
            exit_code = EXIT_SUCCESS
    print(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
