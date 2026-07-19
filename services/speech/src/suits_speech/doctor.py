"""Read-only setup diagnostics for local speech providers.

The doctor deliberately does not import optional provider packages, contact a
model hub, create directories, or download artifacts. All environment-backed
configuration is supplied as :class:`SpeechSettings`; public results contain
only fixed labels and sanitized hardware/runtime facts, never configured paths
or arbitrary environment values.
"""

from __future__ import annotations

import importlib.util
import json
import platform as platform_module
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol, TypeAlias

from .config import SpeechSettings
from .health import detect_cuda
from .protocol import CudaCapability

CheckStatus: TypeAlias = Literal["pass", "warning", "error", "skipped"]
OverallStatus: TypeAlias = Literal["ready", "attention", "blocked"]
PathKind: TypeAlias = Literal["missing", "file", "directory", "unreadable"]

_REPO_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[A-Za-z0-9][A-Za-z0-9._-]{0,191}$")
_REVISION = re.compile(r"^[0-9a-f]{40}$")
_VOICE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_SAFE_FACT = re.compile(r"[^A-Za-z0-9 ._()+:/-]")

_NEMOTRON_FILES = (
    "config.json",
    "generation_config.json",
    "model.safetensors",
    "processor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
)
_KOKORO_FILES = (
    "config.json",
    "kokoro-v1_0.pth",
)


@dataclass(frozen=True, slots=True)
class PythonSnapshot:
    major: int
    minor: int
    micro: int
    implementation: str


@dataclass(frozen=True, slots=True)
class PlatformSnapshot:
    system: str
    release: str
    machine: str
    bits: int


@dataclass(frozen=True, slots=True)
class DoctorCheck:
    check_id: str
    status: CheckStatus
    summary: str
    action: str | None = None

    def to_public_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "id": self.check_id,
            "status": self.status,
            "summary": self.summary,
        }
        if self.action is not None:
            payload["action"] = self.action
        return payload


@dataclass(frozen=True, slots=True)
class DoctorReport:
    checks: tuple[DoctorCheck, ...]
    schema_version: Literal["speech-doctor.v1"] = "speech-doctor.v1"

    @property
    def overall_status(self) -> OverallStatus:
        if any(check.status == "error" for check in self.checks):
            return "blocked"
        if any(check.status == "warning" for check in self.checks):
            return "attention"
        return "ready"

    @property
    def exit_code(self) -> int:
        if self.overall_status == "blocked":
            return 2
        if self.overall_status == "attention":
            return 1
        return 0

    def to_public_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": self.schema_version,
            "overallStatus": self.overall_status,
            "checks": [check.to_public_dict() for check in self.checks],
        }


class DoctorProbe(Protocol):
    """Injectable, read-only operating-system boundary."""

    def python_snapshot(self) -> PythonSnapshot: ...

    def platform_snapshot(self) -> PlatformSnapshot: ...

    def cuda_capability(self, *, fake_mode: bool) -> CudaCapability: ...

    def module_available(self, module_name: str) -> bool: ...

    def executable_available(self, executable_name: str) -> bool: ...

    def path_kind(self, path: Path) -> PathKind: ...


class SystemDoctorProbe:
    """Standard-library probes with no writes, imports, or network access."""

    def python_snapshot(self) -> PythonSnapshot:
        version = sys.version_info
        return PythonSnapshot(
            major=version.major,
            minor=version.minor,
            micro=version.micro,
            implementation=platform_module.python_implementation(),
        )

    def platform_snapshot(self) -> PlatformSnapshot:
        return PlatformSnapshot(
            system=platform_module.system(),
            release=platform_module.release(),
            machine=platform_module.machine(),
            bits=64 if sys.maxsize > 2**32 else 32,
        )

    def cuda_capability(self, *, fake_mode: bool) -> CudaCapability:
        return detect_cuda(fake_mode=fake_mode)

    def module_available(self, module_name: str) -> bool:
        try:
            return importlib.util.find_spec(module_name) is not None
        except (AttributeError, ImportError, ModuleNotFoundError, ValueError):
            return False

    def executable_available(self, executable_name: str) -> bool:
        return shutil.which(executable_name) is not None

    def path_kind(self, path: Path) -> PathKind:
        try:
            if path.is_file():
                return "file"
            if path.is_dir():
                return "directory"
            if path.exists():
                return "unreadable"
            return "missing"
        except OSError:
            return "unreadable"


@dataclass(frozen=True, slots=True)
class _Dependency:
    check_id: str
    module_name: str
    action: str
    needed_for_stt: bool = False
    needed_for_tts: bool = False


_DEPENDENCIES = (
    _Dependency(
        "dependency.torch",
        "torch",
        "Install the pinned local-provider PyTorch build, then rerun the doctor.",
        needed_for_stt=True,
        needed_for_tts=True,
    ),
    _Dependency(
        "dependency.transformers",
        "transformers",
        "Install the pinned Nemotron Transformers dependencies, then rerun the doctor.",
        needed_for_stt=True,
    ),
    _Dependency(
        "dependency.huggingface-hub",
        "huggingface_hub",
        "Install the pinned local artifact-loading dependencies, then rerun the doctor.",
        needed_for_stt=True,
        needed_for_tts=True,
    ),
    _Dependency(
        "dependency.safetensors",
        "safetensors",
        "Install safetensors support for the pinned Nemotron weights.",
        needed_for_stt=True,
    ),
    _Dependency(
        "dependency.kokoro",
        "kokoro",
        "Install the pinned Kokoro Python package, then rerun the doctor.",
        needed_for_tts=True,
    ),
    _Dependency(
        "dependency.misaki",
        "misaki",
        "Install the Kokoro English text-processing dependency, then rerun the doctor.",
        needed_for_tts=True,
    ),
    _Dependency(
        "dependency.numpy",
        "numpy",
        "Install the pinned numerical runtime required by local synthesis.",
        needed_for_tts=True,
    ),
)


def _safe_fact(value: str, *, fallback: str = "unavailable") -> str:
    normalized = _SAFE_FACT.sub("", value.strip())[:80]
    return normalized or fallback


def model_snapshot_candidates(
    cache_dir: Path,
    model_id: str,
    revision: str,
) -> tuple[Path, ...]:
    """Return supported HF cache layouts without touching the filesystem."""

    if _REPO_ID.fullmatch(model_id) is None or _REVISION.fullmatch(revision) is None:
        return ()
    repository_slug = f"models--{model_id.replace('/', '--')}"
    return (
        cache_dir / "hub" / repository_slug / "snapshots" / revision,
        cache_dir / repository_slug / "snapshots" / revision,
    )


def _runtime_checks(settings: SpeechSettings, probe: DoctorProbe) -> list[DoctorCheck]:
    checks: list[DoctorCheck] = []
    python = probe.python_snapshot()
    python_ok = (python.major, python.minor) == (3, 12)
    implementation = _safe_fact(python.implementation)
    checks.append(
        DoctorCheck(
            check_id="runtime.python",
            status="pass" if python_ok and implementation == "CPython" else "error",
            summary=(
                f"Python {python.major}.{python.minor}.{python.micro} ({implementation}) detected."
            ),
            action=(
                None
                if python_ok and implementation == "CPython"
                else "Install CPython 3.12 and recreate the speech-service environment with uv."
            ),
        )
    )

    platform = probe.platform_snapshot()
    supported_platform = platform.system in {"Windows", "Linux", "Darwin"} and platform.bits == 64
    checks.append(
        DoctorCheck(
            check_id="runtime.platform",
            status="pass" if supported_platform else "warning",
            summary=(
                f"{_safe_fact(platform.system)} {_safe_fact(platform.release)} on "
                f"{_safe_fact(platform.machine)} ({platform.bits}-bit) detected."
            ),
            action=(
                None
                if supported_platform
                else "Use a supported 64-bit Windows, Linux, or macOS Python environment."
            ),
        )
    )

    cuda = probe.cuda_capability(fake_mode=settings.mode == "fake")
    if cuda.available:
        device = _safe_fact(cuda.device_name or "NVIDIA GPU")
        memory = f", {cuda.vram_mb} MiB" if cuda.vram_mb is not None else ""
        checks.append(
            DoctorCheck(
                check_id="runtime.cuda",
                status="pass",
                summary=f"CUDA-visible device detected: {device}{memory}.",
            )
        )
    elif settings.mode == "cuda":
        checks.append(
            DoctorCheck(
                check_id="runtime.cuda",
                status="error",
                summary="CUDA mode is configured but no CUDA-visible NVIDIA device was detected.",
                action="Repair the NVIDIA driver until nvidia-smi succeeds, then rerun the doctor.",
            )
        )
    else:
        checks.append(
            DoctorCheck(
                check_id="runtime.cuda",
                status="skipped",
                summary="CUDA visibility is not required by the configured speech mode.",
            )
        )
    return checks


def _provider_shape(settings: SpeechSettings) -> tuple[bool, bool, list[DoctorCheck]]:
    checks: list[DoctorCheck] = []
    stt_real = settings.stt_provider == "nemotron-transformers"
    tts_real = settings.tts_provider == "kokoro"
    valid_stt = stt_real or settings.stt_provider == "fake-stt"
    valid_tts = tts_real or settings.tts_provider == "fake-tts"
    if valid_stt and valid_tts:
        checks.append(
            DoctorCheck(
                check_id="config.providers",
                status="pass",
                summary="Configured speech providers have known local doctor manifests.",
            )
        )
    else:
        checks.append(
            DoctorCheck(
                check_id="config.providers",
                status="error",
                summary="One or more configured providers have no local doctor manifest.",
                action="Select the supported Nemotron/Kokoro providers or deterministic fake providers.",
            )
        )
    return stt_real, tts_real, checks


def _dependency_checks(
    *,
    stt_real: bool,
    tts_real: bool,
    probe: DoctorProbe,
) -> list[DoctorCheck]:
    if not stt_real and not tts_real:
        return [
            DoctorCheck(
                check_id="dependencies.local-providers",
                status="skipped",
                summary="Optional local-provider dependencies are not required in fake mode.",
            )
        ]
    checks: list[DoctorCheck] = []
    for dependency in _DEPENDENCIES:
        needed = (stt_real and dependency.needed_for_stt) or (
            tts_real and dependency.needed_for_tts
        )
        if not needed:
            continue
        available = probe.module_available(dependency.module_name)
        checks.append(
            DoctorCheck(
                check_id=dependency.check_id,
                status="pass" if available else "error",
                summary=(
                    f"Optional module {dependency.module_name} is discoverable without importing it."
                    if available
                    else f"Optional module {dependency.module_name} is not discoverable."
                ),
                action=None if available else dependency.action,
            )
        )
    if tts_real:
        espeak_loader_available = probe.module_available("espeakng_loader")
        espeak_executable_available = probe.executable_available("espeak-ng")
        espeak_available = espeak_loader_available or espeak_executable_available
        checks.append(
            DoctorCheck(
                check_id="dependency.espeak-ng",
                status="pass" if espeak_available else "error",
                summary=(
                    "An eSpeak NG runtime is discoverable."
                    if espeak_available
                    else "No eSpeak NG runtime is discoverable."
                ),
                action=(
                    None
                    if espeak_available
                    else (
                        "Install the pinned espeakng-loader dependency or make espeak-ng "
                        "available on PATH."
                    )
                ),
            )
        )
    return checks


def _resolve_snapshot(
    *,
    cache_dir: Path,
    model_id: str,
    revision: str,
    probe: DoctorProbe,
) -> tuple[Literal["found", "invalid", "missing"], Path | None]:
    candidates = model_snapshot_candidates(cache_dir, model_id, revision)
    if not candidates:
        return "invalid", None
    for candidate in candidates:
        if probe.path_kind(candidate) == "directory":
            return "found", candidate
    return "missing", None


def _artifact_check(
    *,
    role: Literal["stt", "tts"],
    cache_dir: Path,
    model_id: str,
    revision: str,
    required_files: tuple[str, ...],
    probe: DoctorProbe,
    voice_ids: tuple[str, ...] = (),
) -> DoctorCheck:
    resolution, snapshot = _resolve_snapshot(
        cache_dir=cache_dir,
        model_id=model_id,
        revision=revision,
        probe=probe,
    )
    label = "Nemotron STT" if role == "stt" else "Kokoro TTS"
    size = "2.5 GB" if role == "stt" else "329 MB"
    if resolution == "invalid":
        return DoctorCheck(
            check_id=f"artifact.{role}",
            status="error",
            summary=f"The configured {label} model identifier or revision is not immutable and safe.",
            action="Configure a valid repository identifier and exact 40-character commit revision.",
        )
    if resolution == "missing" or snapshot is None:
        return DoctorCheck(
            check_id=f"artifact.{role}",
            status="error",
            summary=f"The configured pinned {label} snapshot is absent from the speech cache.",
            action=(
                f"Run the explicit local artifact setup with at least {size} available; "
                "the doctor never downloads models."
            ),
        )

    expected = [snapshot / filename for filename in required_files]
    if role == "tts":
        expected.extend(snapshot / "voices" / f"{voice_id}.pt" for voice_id in voice_ids)
    missing = sum(probe.path_kind(path) != "file" for path in expected)
    if missing:
        return DoctorCheck(
            check_id=f"artifact.{role}",
            status="error",
            summary=f"The pinned {label} snapshot is incomplete ({missing} required files missing).",
            action="Re-run the explicit pinned artifact setup, then rerun the doctor.",
        )
    return DoctorCheck(
        check_id=f"artifact.{role}",
        status="pass",
        summary=f"The pinned {label} snapshot contains all required local artifacts.",
    )


def _voice_ids(settings: SpeechSettings) -> tuple[str, ...] | None:
    voices: list[str] = []
    for mapping in settings.tts_voices:
        actor, separator, voice_id = mapping.partition("=")
        if (
            not separator
            or _VOICE_ID.fullmatch(actor) is None
            or _VOICE_ID.fullmatch(voice_id) is None
        ):
            return None
        if voice_id not in voices:
            voices.append(voice_id)
    return tuple(voices)


def _artifact_checks(
    settings: SpeechSettings,
    *,
    stt_real: bool,
    tts_real: bool,
    probe: DoctorProbe,
) -> list[DoctorCheck]:
    if not stt_real and not tts_real:
        return [
            DoctorCheck(
                check_id="artifacts.local-providers",
                status="skipped",
                summary="Pinned local model artifacts are not required by fake providers.",
            )
        ]

    cache_kind = probe.path_kind(settings.cache_dir)
    checks = [
        DoctorCheck(
            check_id="artifact.cache",
            status="pass" if cache_kind == "directory" else "error",
            summary=(
                "The configured speech cache is a readable local directory."
                if cache_kind == "directory"
                else "The configured speech cache is missing, unreadable, or not a directory."
            ),
            action=(
                None
                if cache_kind == "directory"
                else "Create the cache through the explicit setup workflow, then rerun the doctor."
            ),
        )
    ]
    if stt_real:
        checks.append(
            _artifact_check(
                role="stt",
                cache_dir=settings.cache_dir,
                model_id=settings.stt_model_id,
                revision=settings.stt_model_revision,
                required_files=_NEMOTRON_FILES,
                probe=probe,
            )
        )
    if tts_real:
        voice_ids = _voice_ids(settings)
        if voice_ids is None:
            checks.append(
                DoctorCheck(
                    check_id="artifact.tts",
                    status="error",
                    summary="The configured Kokoro voice mappings are invalid.",
                    action="Configure bounded actor-to-voice identifiers, then rerun the doctor.",
                )
            )
        else:
            checks.append(
                _artifact_check(
                    role="tts",
                    cache_dir=settings.cache_dir,
                    model_id=settings.tts_model_id,
                    revision=settings.tts_model_revision,
                    required_files=_KOKORO_FILES,
                    voice_ids=voice_ids,
                    probe=probe,
                )
            )
    return checks


def run_doctor(
    settings: SpeechSettings,
    *,
    probe: DoctorProbe | None = None,
) -> DoctorReport:
    """Run deterministic, read-only local setup diagnostics."""

    resolved_probe = probe or SystemDoctorProbe()
    checks = _runtime_checks(settings, resolved_probe)
    stt_real, tts_real, provider_checks = _provider_shape(settings)
    checks.extend(provider_checks)
    checks.extend(_dependency_checks(stt_real=stt_real, tts_real=tts_real, probe=resolved_probe))
    checks.extend(
        _artifact_checks(
            settings,
            stt_real=stt_real,
            tts_real=tts_real,
            probe=resolved_probe,
        )
    )
    return DoctorReport(checks=tuple(checks))


def main() -> int:
    """Print a privacy-safe JSON report for ``python -m suits_speech.doctor``."""

    try:
        settings = SpeechSettings.from_env()
    except ValueError:
        report = DoctorReport(
            checks=(
                DoctorCheck(
                    check_id="config.settings",
                    status="error",
                    summary="Speech settings failed strict validation.",
                    action="Correct the named speech configuration fields, then rerun the doctor.",
                ),
            )
        )
    else:
        report = run_doctor(settings)
    print(json.dumps(report.to_public_dict(), indent=2, sort_keys=True))
    return report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
