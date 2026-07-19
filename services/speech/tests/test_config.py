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
    assert settings.auto_download_models is False


def test_fake_mode_selects_fake_providers_for_ci() -> None:
    settings = SpeechSettings.from_env({"SUITS_SPEECH_MODE": "fake", "LOCALAPPDATA": "C:/local"})

    assert settings.stt_provider == "fake-stt"
    assert settings.tts_provider == "fake-tts"


def test_non_loopback_bind_requires_explicit_opt_in() -> None:
    with pytest.raises(ValueError, match="non-loopback"):
        SpeechSettings.from_env(
            {
                "SUITS_SPEECH_HOST": "0.0.0.0",
                "LOCALAPPDATA": "C:/local",
            }
        )

    settings = SpeechSettings.from_env(
        {
            "SUITS_SPEECH_HOST": "0.0.0.0",
            "SUITS_SPEECH_ALLOW_REMOTE": "1",
            "LOCALAPPDATA": "C:/local",
        }
    )
    assert settings.host == "0.0.0.0"


@pytest.mark.parametrize(
    "environ",
    [
        {"SUITS_SPEECH_MODE": "cloud"},
        {"SUITS_SPEECH_PORT": "0"},
        {"SUITS_STT_LOOKAHEAD_TOKENS": "14"},
        {"SUITS_SPEECH_ALLOWED_ORIGINS": ""},
    ],
)
def test_invalid_configuration_fails_closed(environ: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        SpeechSettings.from_env(environ)
