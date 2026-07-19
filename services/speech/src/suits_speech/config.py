"""Environment-backed configuration with safe, pinned local defaults."""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, cast

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

SpeechMode = Literal["fake", "cpu", "cuda"]


def _parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"invalid boolean value: {value!r}")


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


def _validate_bind_host(host: str, *, allow_remote: bool) -> str:
    normalized = host.strip().lower()
    if normalized == "localhost":
        return normalized
    try:
        is_loopback = ipaddress.ip_address(normalized).is_loopback
    except ValueError as error:
        raise ValueError("SUITS_SPEECH_HOST must be an IP address or localhost") from error
    if not is_loopback and not allow_remote:
        raise ValueError("refusing a non-loopback speech bind without SUITS_SPEECH_ALLOW_REMOTE=1")
    return normalized


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

        allow_remote = _parse_bool(
            source.get("SUITS_SPEECH_ALLOW_REMOTE"),
            default=False,
        )
        host = _validate_bind_host(
            source.get("SUITS_SPEECH_HOST", "127.0.0.1"),
            allow_remote=allow_remote,
        )
        default_stt = "fake-stt" if mode == "fake" else DEFAULT_STT_PROVIDER
        default_tts = "fake-tts" if mode == "fake" else DEFAULT_TTS_PROVIDER
        cache_value = source.get("SUITS_SPEECH_CACHE_DIR")
        origins = tuple(
            origin.strip()
            for origin in source.get(
                "SUITS_SPEECH_ALLOWED_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000",
            ).split(",")
            if origin.strip()
        )
        if not origins:
            raise ValueError("at least one speech-service origin is required")
        voices = tuple(
            value.strip()
            for value in source.get(
                "SUITS_TTS_VOICES",
                ",".join(DEFAULT_VOICES),
            ).split(",")
            if value.strip()
        )
        if not voices:
            raise ValueError("at least one TTS voice mapping is required")

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
            cache_dir=(
                Path(cache_value).expanduser() if cache_value else _default_cache_dir(source)
            ),
            stt_provider=source.get("SUITS_STT_PROVIDER", default_stt),
            stt_model_id=source.get("SUITS_STT_MODEL_ID", DEFAULT_STT_MODEL_ID),
            stt_model_revision=source.get(
                "SUITS_STT_MODEL_REVISION",
                DEFAULT_STT_MODEL_REVISION,
            ),
            stt_lookahead_tokens=_parse_int(
                source.get("SUITS_STT_LOOKAHEAD_TOKENS"),
                default=1,
                minimum=0,
                maximum=13,
                name="SUITS_STT_LOOKAHEAD_TOKENS",
            ),
            stt_sample_rate_hz=_parse_int(
                source.get("SUITS_STT_SAMPLE_RATE_HZ"),
                default=16_000,
                minimum=8_000,
                maximum=48_000,
                name="SUITS_STT_SAMPLE_RATE_HZ",
            ),
            tts_provider=source.get("SUITS_TTS_PROVIDER", default_tts),
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
        )
