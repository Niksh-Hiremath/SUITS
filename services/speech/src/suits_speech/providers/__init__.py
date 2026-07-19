"""Provider interfaces and built-in local adapters."""

from .base import (
    AudioChunk,
    ProviderCancelled,
    ProviderStatus,
    SynthesizedPhrase,
    TranscriptHypothesis,
)
from .fake import FakeSttProvider, FakeTtsProvider
from .unavailable import UnavailableSttProvider, UnavailableTtsProvider

__all__ = [
    "AudioChunk",
    "FakeSttProvider",
    "FakeTtsProvider",
    "ProviderCancelled",
    "ProviderStatus",
    "SynthesizedPhrase",
    "TranscriptHypothesis",
    "UnavailableSttProvider",
    "UnavailableTtsProvider",
]
