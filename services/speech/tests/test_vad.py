from __future__ import annotations

from array import array

import pytest

from suits_speech.vad import EnergyVad


def _constant_pcm(amplitude: int, sample_count: int = 320) -> bytes:
    return array("h", [amplitude] * sample_count).tobytes()


def test_energy_vad_detects_start_and_end_windows() -> None:
    vad = EnergyVad(threshold_rms=500, min_speech_ms=40, end_silence_ms=60)

    first_voice = vad.process(_constant_pcm(1_000), duration_ms=20)
    second_voice = vad.process(_constant_pcm(1_000), duration_ms=20)
    first_silence = vad.process(_constant_pcm(0), duration_ms=20)
    second_silence = vad.process(_constant_pcm(0), duration_ms=20)
    third_silence = vad.process(_constant_pcm(0), duration_ms=20)

    assert first_voice.speech_started is False
    assert second_voice.speech_started is True
    assert vad.active is False
    assert first_silence.speech_ended is False
    assert second_silence.speech_ended is False
    assert third_silence.speech_ended is True


def test_energy_vad_flushes_active_speech_and_resets() -> None:
    vad = EnergyVad(threshold_rms=500, min_speech_ms=20, end_silence_ms=60)
    observation = vad.process(_constant_pcm(900), duration_ms=20)

    assert observation.speech_started is True
    assert vad.flush() is True
    assert vad.active is False
    assert vad.flush() is False


@pytest.mark.parametrize("pcm", [b"", b"\x00"])
def test_energy_vad_rejects_malformed_pcm(pcm: bytes) -> None:
    vad = EnergyVad()
    with pytest.raises(ValueError, match="whole signed 16-bit"):
        vad.process(pcm, duration_ms=20)
