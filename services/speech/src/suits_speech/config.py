"""Environment-backed configuration with safe, pinned local defaults."""

from __future__ import annotations

import ipaddress
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, cast
from urllib.parse import urlsplit

DEFAULT_STT_PROVIDER = "nemotron-transformers"
DEFAULT_STT_MODEL_ID = "nvidia/nemotron-speech-streaming-en-0.6b"
DEFAULT_STT_MODEL_REVISION = "df1f0fe9dfdf05152936192b4c8c7653d53bf557"
DEFAULT_TTS_PROVIDER = "kokoro"
DEFAULT_TTS_MODEL_ID = "hexgrad/Kokoro-82M"
DEFAULT_TTS_MODEL_REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
DEFAULT_VOICES = (
    "judge=am_michael",
    "opposing_counsel=bm_george",
    "witness=af_heart",
)
SUPPORTED_STT_LOOKAHEAD_TOKENS = frozenset({0, 1, 6, 13})

_VOICE_ROLE = re.compile(r"[a-z][a-z0-9_]{0,63}")
_SAFE_VOICE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")
_KOKORO_VOICE_ID = re.compile(r"[abefhijpz][fm]_[a-z0-9]+(?:_[a-z0-9]+)*")
_FIXED_CLIP_VOICE_ROLES = frozenset({"judge", "opposing_counsel"})

SpeechMode = Literal["fake", "cpu", "cuda"]


def _parse_int(
    value: str | None,
    *,
    default: int,
    minimum: int,
    maximum: int,
    name: str,
) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return parsed


def _default_cache_dir(environ: Mapping[str, str]) -> Path:
    local_app_data = environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "SUITS" / "speech"
    return Path.home() / ".cache" / "suits" / "speech"


def _validate_bind_host(host: str) -> str:
    normalized = host.strip().lower()
    if normalized == "localhost":
        return normalized
    try:
        is_loopback = ipaddress.ip_address(normalized).is_loopback
    except ValueError as error:
        raise ValueError("SUITS_SPEECH_HOST must be an IP address or localhost") from error
    if not is_loopback:
        raise ValueError("the local speech service must bind to a loopback address")
    return normalized


def _parse_origins(value: str) -> tuple[str, ...]:
    normalized: list[str] = []
    for raw_origin in value.split(","):
        origin = raw_origin.strip()
        if not origin:
            continue
        if origin in {"*", "null"} or any(
            ord(character) < 32 or ord(character) == 127 for character in origin
        ):
            raise ValueError("speech origins must be exact HTTP(S) origins")
        parsed = urlsplit(origin)
        try:
            parsed_port = parsed.port
        except ValueError as error:
            raise ValueError("speech origin has an invalid port") from error
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname is None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("speech origins must be exact HTTP(S) origins")
        host = parsed.hostname.lower()
        if ":" in host:
            host = f"[{host}]"
        canonical = f"{parsed.scheme.lower()}://{host}"
        if parsed_port is not None:
            canonical += f":{parsed_port}"
        if canonical not in normalized:
            normalized.append(canonical)
    if not normalized:
        raise ValueError("at least one speech-service origin is required")
    return tuple(normalized)


def _parse_cache_dir(value: str | None, environ: Mapping[str, str]) -> Path:
    if value is None:
        return _default_cache_dir(environ)
    if "\x00" in value:
        raise ValueError("SUITS_SPEECH_CACHE_DIR contains a null character")
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError("SUITS_SPEECH_CACHE_DIR must be absolute")
    return path


def _parse_voice_mappings(value: str, *, kokoro: bool) -> tuple[str, ...]:
    mappings = tuple(entry.strip() for entry in value.split(",") if entry.strip())
    if not mappings:
        raise ValueError("at least one TTS voice mapping is required")

    actors: set[str] = set()
    for mapping in mappings:
        actor, separator, voice_id = mapping.partition("=")
        voice_pattern = _KOKORO_VOICE_ID if kokoro else _SAFE_VOICE_ID
        if (
            separator != "="
            or _VOICE_ROLE.fullmatch(actor) is None
            or voice_pattern.fullmatch(voice_id) is None
            or actor in actors
        ):
            raise ValueError("TTS voice mappings must use unique safe actor=voice identifiers")
        actors.add(actor)
    if not _FIXED_CLIP_VOICE_ROLES.issubset(actors):
        raise ValueError("TTS voice mappings must configure judge and opposing_counsel")
    return mappings


@dataclass(frozen=True, slots=True)
class SpeechSettings:
    """Settings are explicit and never initiate model downloads."""

    mode: SpeechMode
    host: str
    port: int
    allowed_origins: tuple[str, ...]
    cache_dir: Path
    stt_provider: str
    stt_model_id: str
    stt_model_revision: str
    stt_lookahead_tokens: int
    stt_sample_rate_hz: int
    tts_provider: str
    tts_model_id: str
    tts_model_revision: str
    tts_voices: tuple[str, ...]
    max_tts_queue_depth: int
    max_connections: int
    max_stt_sessions: int
    stt_input_max_frames: int
    stt_input_max_bytes: int
    stt_idle_timeout_ms: int
    stt_max_utterance_ms: int
    hello_timeout_ms: int
    tts_ack_window_bytes: int
    tts_audio_frame_ms: int
    tts_max_phrase_duration_ms: int
    auto_download_models: Literal[False] = False

    @classmethod
    def from_env(
        cls,
        environ: Mapping[str, str] | None = None,
    ) -> SpeechSettings:
        source = os.environ if environ is None else environ
        mode_value = source.get("SUITS_SPEECH_MODE", "cuda").strip().lower()
        if mode_value not in {"fake", "cpu", "cuda"}:
            raise ValueError("SUITS_SPEECH_MODE must be fake, cpu, or cuda")
        mode = cast(SpeechMode, mode_value)

        host = _validate_bind_host(source.get("SUITS_SPEECH_HOST", "127.0.0.1"))
        default_stt = "fake-stt" if mode == "fake" else DEFAULT_STT_PROVIDER
        default_tts = "fake-tts" if mode == "fake" else DEFAULT_TTS_PROVIDER
        stt_provider = source.get("SUITS_STT_PROVIDER", default_stt).strip()
        tts_provider = source.get("SUITS_TTS_PROVIDER", default_tts).strip()
        if not stt_provider or not tts_provider:
            raise ValueError("speech provider identifiers must not be empty")
        cache_value = source.get("SUITS_SPEECH_CACHE_DIR")
        origins = _parse_origins(
            source.get(
                "SUITS_SPEECH_ALLOWED_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000",
            )
        )
        voices = _parse_voice_mappings(
            source.get(
                "SUITS_TTS_VOICES",
                ",".join(DEFAULT_VOICES),
            ),
            kokoro=tts_provider == DEFAULT_TTS_PROVIDER,
        )
        stt_lookahead_tokens = _parse_int(
            source.get("SUITS_STT_LOOKAHEAD_TOKENS"),
            default=1,
            minimum=0,
            maximum=13,
            name="SUITS_STT_LOOKAHEAD_TOKENS",
        )
        if (
            stt_provider == DEFAULT_STT_PROVIDER
            and stt_lookahead_tokens not in SUPPORTED_STT_LOOKAHEAD_TOKENS
        ):
            raise ValueError("Nemotron lookahead tokens must be one of 0, 1, 6, or 13")
        stt_sample_rate_hz = _parse_int(
            source.get("SUITS_STT_SAMPLE_RATE_HZ"),
            default=16_000,
            minimum=8_000,
            maximum=48_000,
            name="SUITS_STT_SAMPLE_RATE_HZ",
        )
        if stt_provider in {DEFAULT_STT_PROVIDER, "fake-stt"} and stt_sample_rate_hz != 16_000:
            raise ValueError("the configured STT provider requires 16000 Hz mono PCM")
        max_stt_sessions = _parse_int(
            source.get("SUITS_STT_MAX_SESSIONS"),
            default=1,
            minimum=1,
            maximum=8,
            name="SUITS_STT_MAX_SESSIONS",
        )
        if stt_provider == DEFAULT_STT_PROVIDER and max_stt_sessions != 1:
            raise ValueError("Nemotron requires exactly one active streaming session")

        return cls(
            mode=mode,
            host=host,
            port=_parse_int(
                source.get("SUITS_SPEECH_PORT"),
                default=8765,
                minimum=1,
                maximum=65_535,
                name="SUITS_SPEECH_PORT",
            ),
            allowed_origins=origins,
            cache_dir=_parse_cache_dir(cache_value, source),
            stt_provider=stt_provider,
            stt_model_id=source.get("SUITS_STT_MODEL_ID", DEFAULT_STT_MODEL_ID),
            stt_model_revision=source.get(
                "SUITS_STT_MODEL_REVISION",
                DEFAULT_STT_MODEL_REVISION,
            ),
            stt_lookahead_tokens=stt_lookahead_tokens,
            stt_sample_rate_hz=stt_sample_rate_hz,
            tts_provider=tts_provider,
            tts_model_id=source.get("SUITS_TTS_MODEL_ID", DEFAULT_TTS_MODEL_ID),
            tts_model_revision=source.get(
                "SUITS_TTS_MODEL_REVISION",
                DEFAULT_TTS_MODEL_REVISION,
            ),
            tts_voices=voices,
            max_tts_queue_depth=_parse_int(
                source.get("SUITS_TTS_MAX_QUEUE_DEPTH"),
                default=8,
                minimum=1,
                maximum=256,
                name="SUITS_TTS_MAX_QUEUE_DEPTH",
            ),
            max_connections=_parse_int(
                source.get("SUITS_SPEECH_MAX_CONNECTIONS"),
                default=4,
                minimum=1,
                maximum=32,
                name="SUITS_SPEECH_MAX_CONNECTIONS",
            ),
            max_stt_sessions=max_stt_sessions,
            stt_input_max_frames=_parse_int(
                source.get("SUITS_STT_INPUT_MAX_FRAMES"),
                default=8,
                minimum=1,
                maximum=128,
                name="SUITS_STT_INPUT_MAX_FRAMES",
            ),
            stt_input_max_bytes=_parse_int(
                source.get("SUITS_STT_INPUT_MAX_BYTES"),
                default=524_288,
                minimum=640,
                maximum=16_777_216,
                name="SUITS_STT_INPUT_MAX_BYTES",
            ),
            stt_idle_timeout_ms=_parse_int(
                source.get("SUITS_STT_IDLE_TIMEOUT_MS"),
                default=10_000,
                minimum=1_000,
                maximum=60_000,
                name="SUITS_STT_IDLE_TIMEOUT_MS",
            ),
            stt_max_utterance_ms=_parse_int(
                source.get("SUITS_STT_MAX_UTTERANCE_MS"),
                default=120_000,
                minimum=5_000,
                maximum=600_000,
                name="SUITS_STT_MAX_UTTERANCE_MS",
            ),
            hello_timeout_ms=_parse_int(
                source.get("SUITS_SPEECH_HELLO_TIMEOUT_MS"),
                default=5_000,
                minimum=500,
                maximum=30_000,
                name="SUITS_SPEECH_HELLO_TIMEOUT_MS",
            ),
            tts_ack_window_bytes=_parse_int(
                source.get("SUITS_TTS_ACK_WINDOW_BYTES"),
                default=5_760,
                minimum=640,
                maximum=16_777_216,
                name="SUITS_TTS_ACK_WINDOW_BYTES",
            ),
            tts_audio_frame_ms=_parse_int(
                source.get("SUITS_TTS_AUDIO_FRAME_MS"),
                default=40,
                minimum=20,
                maximum=200,
                name="SUITS_TTS_AUDIO_FRAME_MS",
            ),
            tts_max_phrase_duration_ms=_parse_int(
                source.get("SUITS_TTS_MAX_PHRASE_DURATION_MS"),
                default=15_000,
                minimum=1_000,
                maximum=30_000,
                name="SUITS_TTS_MAX_PHRASE_DURATION_MS",
            ),
        )
