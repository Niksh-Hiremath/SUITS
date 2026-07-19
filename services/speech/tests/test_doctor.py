from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path

from suits_speech.config import SpeechSettings
from suits_speech.doctor import (
    DoctorCheck,
    DoctorProbe,
    PathKind,
    PlatformSnapshot,
    PythonSnapshot,
    model_snapshot_candidates,
    run_doctor,
)
from suits_speech.protocol import CudaCapability


@dataclass
class _Probe(DoctorProbe):
    python: PythonSnapshot = PythonSnapshot(3, 12, 10, "CPython")
    platform: PlatformSnapshot = PlatformSnapshot("Windows", "11", "AMD64", 64)
    cuda: CudaCapability = CudaCapability(
        available=True,
        device_name="NVIDIA GeForce RTX 5070",
        driver_version="610.62",
        compute_capability="12.0",
        vram_mb=12_227,
        diagnostic="test fixture",
    )
    modules: set[str] = field(default_factory=set)
    executables: set[str] = field(default_factory=set)
    paths: dict[Path, PathKind] = field(default_factory=dict)
    inspected_paths: list[Path] = field(default_factory=list)

    def python_snapshot(self) -> PythonSnapshot:
        return self.python

    def platform_snapshot(self) -> PlatformSnapshot:
        return self.platform

    def cuda_capability(self, *, fake_mode: bool) -> CudaCapability:
        del fake_mode
        return self.cuda

    def module_available(self, module_name: str) -> bool:
        return module_name in self.modules

    def executable_available(self, executable_name: str) -> bool:
        return executable_name in self.executables

    def path_kind(self, path: Path) -> PathKind:
        self.inspected_paths.append(path)
        return self.paths.get(path, "missing")


def _settings(tmp_path: Path, *, mode: str = "cuda") -> SpeechSettings:
    return SpeechSettings.from_env(
        {
            "SUITS_SPEECH_MODE": mode,
            "SUITS_SPEECH_CACHE_DIR": str(tmp_path),
        }
    )


def _checks(report_checks: tuple[DoctorCheck, ...]) -> dict[str, DoctorCheck]:
    return {check.check_id: check for check in report_checks}


def _ready_probe(settings: SpeechSettings) -> _Probe:
    probe = _Probe(
        modules={
            "torch",
            "transformers",
            "huggingface_hub",
            "safetensors",
            "kokoro",
            "misaki",
            "en_core_web_sm",
            "librosa",
            "numpy",
            "espeakng_loader",
        },
    )
    probe.paths[settings.cache_dir] = "directory"
    stt_snapshot = model_snapshot_candidates(
        settings.cache_dir,
        settings.stt_model_id,
        settings.stt_model_revision,
    )[0]
    tts_snapshot = model_snapshot_candidates(
        settings.cache_dir,
        settings.tts_model_id,
        settings.tts_model_revision,
    )[0]
    probe.paths[stt_snapshot] = "directory"
    probe.paths[tts_snapshot] = "directory"
    for filename in (
        "config.json",
        "generation_config.json",
        "model.safetensors",
        "processor_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
    ):
        probe.paths[stt_snapshot / filename] = "file"
    for filename in ("config.json", "kokoro-v1_0.pth"):
        probe.paths[tts_snapshot / filename] = "file"
    for mapping in settings.tts_voices:
        voice_id = mapping.partition("=")[2]
        probe.paths[tts_snapshot / "voices" / f"{voice_id}.pt"] = "file"
    return probe


def test_ready_cuda_report_requires_exact_pinned_artifacts(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    report = run_doctor(settings, probe=_ready_probe(settings))
    checks = _checks(report.checks)

    assert report.overall_status == "ready"
    assert report.exit_code == 0
    assert checks["artifact.stt"].status == "pass"
    assert checks["artifact.tts"].status == "pass"
    assert checks["dependency.espeak-ng"].status == "pass"
    assert checks["dependency.en-core-web-sm"].status == "pass"


def test_kokoro_requires_pinned_offline_english_model(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    probe = _ready_probe(settings)
    probe.modules.remove("en_core_web_sm")

    report = run_doctor(settings, probe=probe)
    check = _checks(report.checks)["dependency.en-core-web-sm"]

    assert report.overall_status == "blocked"
    assert check.status == "error"
    assert check.action is not None
    assert "en_core_web_sm" in check.action


def test_fake_mode_skips_live_dependencies_and_artifacts(tmp_path: Path) -> None:
    settings = _settings(tmp_path, mode="fake")
    probe = _Probe(
        cuda=CudaCapability(
            available=False,
            diagnostic="unavailable test fixture",
        )
    )

    report = run_doctor(settings, probe=probe)
    checks = _checks(report.checks)

    assert report.overall_status == "ready"
    assert checks["runtime.cuda"].status == "skipped"
    assert checks["dependencies.local-providers"].status == "skipped"
    assert checks["artifacts.local-providers"].status == "skipped"
    assert probe.inspected_paths == []


def test_missing_runtime_dependencies_and_snapshots_are_actionable(
    tmp_path: Path,
) -> None:
    settings = _settings(tmp_path / "private-cache-value")
    probe = _Probe(
        python=PythonSnapshot(3, 11, 9, "CPython"),
        cuda=CudaCapability(
            available=False,
            diagnostic="secret diagnostic must not be copied",
        ),
    )

    report = run_doctor(settings, probe=probe)
    errors = [check for check in report.checks if check.status == "error"]
    rendered = json.dumps(report.to_public_dict(), sort_keys=True)

    assert report.overall_status == "blocked"
    assert report.exit_code == 2
    assert errors
    assert all(check.action for check in errors)
    assert "private-cache-value" not in rendered
    assert "secret diagnostic" not in rendered
    assert str(settings.cache_dir) not in rendered


def test_incomplete_snapshot_reports_count_without_disclosing_paths(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    probe = _ready_probe(settings)
    stt_snapshot = model_snapshot_candidates(
        settings.cache_dir,
        settings.stt_model_id,
        settings.stt_model_revision,
    )[0]
    del probe.paths[stt_snapshot / "processor_config.json"]

    report = run_doctor(settings, probe=probe)
    check = _checks(report.checks)["artifact.stt"]

    assert check.status == "error"
    assert "1 required files missing" in check.summary
    assert str(settings.cache_dir) not in json.dumps(report.to_public_dict())


def test_invalid_model_locator_never_probes_traversal(tmp_path: Path) -> None:
    settings = replace(
        _settings(tmp_path),
        stt_model_id="../../private",
        stt_model_revision="main",
    )
    probe = _ready_probe(_settings(tmp_path))
    probe.inspected_paths.clear()

    report = run_doctor(settings, probe=probe)
    check = _checks(report.checks)["artifact.stt"]

    assert check.status == "error"
    assert "immutable and safe" in check.summary
    assert all("private" not in str(path) for path in probe.inspected_paths)
