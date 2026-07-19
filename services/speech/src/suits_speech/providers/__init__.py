"""Provider interfaces and built-in local adapters."""

from .base import (
    AudioChunk,
    ProviderCancelled,
    ProviderStatus,
    SynthesizedPhrase,
    TranscriptHypothesis,
)
from .fake import FakeSttProvider, FakeTtsProvider

__all__ = [
    "AudioChunk",
    "FakeSttProvider",
    "FakeTtsProvider",
    "ProviderCancelled",
    "ProviderStatus",
    "SynthesizedPhrase",
    "TranscriptHypothesis",
]
