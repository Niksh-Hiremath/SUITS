"""Small dependency-free energy VAD used before provider transcription."""

from __future__ import annotations

import math
import sys
from array import array
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VadObservation:
    is_speech: bool
    speech_started: bool
    speech_ended: bool
    rms: float


class EnergyVad:
    """Tracks speech/silence windows over signed 16-bit mono PCM."""

    def __init__(
        self,
        *,
        threshold_rms: float = 500,
        min_speech_ms: int = 40,
        end_silence_ms: int = 600,
    ) -> None:
        if threshold_rms <= 0:
            raise ValueError("threshold_rms must be positive")
        if min_speech_ms <= 0 or end_silence_ms <= 0:
            raise ValueError("VAD durations must be positive")
        self._threshold_rms = threshold_rms
        self._min_speech_ms = min_speech_ms
        self._end_silence_ms = end_silence_ms
        self.reset()

    @property
    def active(self) -> bool:
        return self._active

    def process(self, pcm_s16le: bytes, *, duration_ms: int) -> VadObservation:
        if duration_ms <= 0:
            raise ValueError("duration_ms must be positive")
        if not pcm_s16le or len(pcm_s16le) % 2 != 0:
            raise ValueError("PCM must contain whole signed 16-bit samples")
        samples = array("h")
        samples.frombytes(pcm_s16le)
        if sys.byteorder != "little":
            samples.byteswap()
        rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
        is_speech = rms >= self._threshold_rms
        started = False
        ended = False

        if is_speech:
            self._candidate_speech_ms += duration_ms
            self._silence_ms = 0
            if not self._active and self._candidate_speech_ms >= self._min_speech_ms:
                self._active = True
                started = True
        else:
            self._candidate_speech_ms = 0
            if self._active:
                self._silence_ms += duration_ms
                if self._silence_ms >= self._end_silence_ms:
                    self._active = False
                    self._silence_ms = 0
                    ended = True

        return VadObservation(
            is_speech=is_speech,
            speech_started=started,
            speech_ended=ended,
            rms=rms,
        )

    def flush(self) -> bool:
        was_active = self._active
        self.reset()
        return was_active

    def reset(self) -> None:
        self._active = False
        self._candidate_speech_ms = 0
        self._silence_ms = 0
