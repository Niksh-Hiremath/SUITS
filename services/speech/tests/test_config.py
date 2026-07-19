from __future__ import annotations

import pytest

from suits_speech.config import (
    DEFAULT_STT_MODEL_ID,
    DEFAULT_STT_MODEL_REVISION,
    DEFAULT_TTS_MODEL_ID,
    DEFAULT_TTS_MODEL_REVISION,
    SpeechSettings,
)


def test_defaults_are_pinned_local_providers_without_auto_download() -> None:
    settings = SpeechSettings.from_env({"LOCALAPPDATA": "C:/local"})

    assert settings.mode == "cuda"
    assert settings.host == "127.0.0.1"
    assert settings.stt_provider == "nemotron-transformers"
    assert settings.stt_model_id == DEFAULT_STT_MODEL_ID
    assert settings.stt_model_revision == DEFAULT_STT_MODEL_REVISION
    assert settings.stt_lookahead_tokens == 1
    assert settings.tts_provider == "kokoro"
    assert settings.tts_model_id == DEFAULT_TTS_MODEL_ID
    assert settings.tts_model_revision == DEFAULT_TTS_MODEL_REVISION
    assert "opposing_counsel=bm_george" in settings.tts_voices
    assert settings.stt_input_max_frames == 8
    assert settings.max_connections == 4
    assert settings.max_stt_sessions == 1
    assert settings.stt_idle_timeout_ms == 10_000
    assert settings.stt_max_utterance_ms == 120_000
    assert settings.hello_timeout_ms == 5_000
    assert settings.tts_ack_window_bytes == 5_760
    assert settings.tts_max_phrase_duration_ms == 15_000
    assert settings.auto_download_models is False


def test_fake_mode_selects_fake_providers_for_ci() -> None:
    settings = SpeechSettings.from_env(
        {
            "SUITS_SPEECH_MODE": "fake",
            "SUITS_STT_MAX_SESSIONS": "4",
            "LOCALAPPDATA": "C:/local",
        }
    )

    assert settings.stt_provider == "fake-stt"
    assert settings.tts_provider == "fake-tts"
    assert settings.max_stt_sessions == 4


def test_non_loopback_bind_is_always_rejected() -> None:
    with pytest.raises(ValueError, match="loopback"):
        SpeechSettings.from_env(
            {
                "SUITS_SPEECH_HOST": "0.0.0.0",
                "LOCALAPPDATA": "C:/local",
            }
        )


@pytest.mark.parametrize(
    "environ",
    [
        {"SUITS_SPEECH_MODE": "cloud"},
        {"SUITS_SPEECH_PORT": "0"},
        {"SUITS_STT_PROVIDER": ""},
        {"SUITS_TTS_PROVIDER": ""},
        {"SUITS_STT_LOOKAHEAD_TOKENS": "2"},
        {"SUITS_STT_LOOKAHEAD_TOKENS": "14"},
        {"SUITS_STT_SAMPLE_RATE_HZ": "8000"},
        {"SUITS_SPEECH_MAX_CONNECTIONS": "0"},
        {"SUITS_STT_MAX_SESSIONS": "0"},
        {"SUITS_STT_MAX_SESSIONS": "2"},
        {"SUITS_STT_IDLE_TIMEOUT_MS": "999"},
        {"SUITS_STT_MAX_UTTERANCE_MS": "4999"},
        {"SUITS_SPEECH_HELLO_TIMEOUT_MS": "499"},
        {"SUITS_SPEECH_ALLOWED_ORIGINS": ""},
        {"SUITS_SPEECH_ALLOWED_ORIGINS": "*"},
        {"SUITS_SPEECH_ALLOWED_ORIGINS": "null"},
        {"SUITS_SPEECH_ALLOWED_ORIGINS": "http://user:pass@localhost:3000"},
        {"SUITS_SPEECH_ALLOWED_ORIGINS": "http://localhost:3000/path"},
        {"SUITS_SPEECH_ALLOWED_ORIGINS": "http://localhost:3000?query=1"},
        {"SUITS_SPEECH_CACHE_DIR": "relative/cache"},
        {"SUITS_SPEECH_CACHE_DIR": "C:/bad\x00cache"},
        {"SUITS_TTS_VOICES": "judge=am_michael"},
        {"SUITS_TTS_VOICES": ("judge=am_michael,judge=af_heart,opposing_counsel=bm_george")},
        {"SUITS_TTS_VOICES": ("judge=../../private,opposing_counsel=bm_george,witness=af_heart")},
    ],
)
def test_invalid_configuration_fails_closed(environ: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        SpeechSettings.from_env(environ)
