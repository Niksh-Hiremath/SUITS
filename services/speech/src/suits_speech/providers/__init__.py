"""Provider interfaces and built-in local adapters."""

from .base import (
    AudioChunk,
    ProviderCancelled,
    ProviderStatus,
    SynthesizedPhrase,
    TranscriptHypothesis,
)
from .fake import FakeSttProvider, FakeTtsProvider
from .kokoro import KokoroTtsProvider
from .nemotron import NemotronSttProvider
from .unavailable import UnavailableSttProvider, UnavailableTtsProvider

__all__ = [
    "AudioChunk",
    "FakeSttProvider",
    "FakeTtsProvider",
    "KokoroTtsProvider",
    "NemotronSttProvider",
    "ProviderCancelled",
    "ProviderStatus",
    "SynthesizedPhrase",
    "TranscriptHypothesis",
    "UnavailableSttProvider",
    "UnavailableTtsProvider",
]
