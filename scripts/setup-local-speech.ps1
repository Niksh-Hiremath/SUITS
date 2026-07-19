<#
.SYNOPSIS
Installs and diagnoses one pinned SUITS local-speech runtime on Windows.

.DESCRIPTION
The selected profile is synchronized from the checked-in uv lock. Package sync may contact the
configured Python/PyTorch indexes and installs the pinned offline English language wheel. The two
large Hugging Face model snapshots are never requested unless -DownloadModels is present. Their
allowlists total about 2.9 GB before transient/cache overhead; keep at least 6 GB free on the cache
drive. The read-only speech doctor runs last and returns a failing exit when dependencies,
artifacts, or the selected CUDA runtime are not ready.

.EXAMPLE
.\scripts\setup-local-speech.ps1 -Runtime local-cuda -DownloadModels

.EXAMPLE
.\scripts\setup-local-speech.ps1 -Runtime local-cpu -PlanOnly
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('local-cpu', 'local-cuda')]
  [string]$Runtime,

  [Parameter()]
  [switch]$DownloadModels,

  [Parameter()]
  [string]$CacheDir = [System.IO.Path]::Combine(
    [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData),
    'SUITS',
    'speech'
  ),

  [Parameter()]
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$nemotronModel = [PSCustomObject]@{
  Name = 'Nemotron streaming STT'
  Repository = 'nvidia/nemotron-speech-streaming-en-0.6b'
  Revision = 'df1f0fe9dfdf05152936192b4c8c7653d53bf557'
  Files = @(
    'config.json'
    'generation_config.json'
    'model.safetensors'
    'processor_config.json'
    'tokenizer.json'
    'tokenizer_config.json'
  )
}

$kokoroModel = [PSCustomObject]@{
  Name = 'Kokoro TTS'
  Repository = 'hexgrad/Kokoro-82M'
  Revision = 'f3ff3571791e39611d31c381e3a41a3af07b4987'
  Files = @(
    'config.json'
    'kokoro-v1_0.pth'
    'voices/am_michael.pt'
    'voices/bm_george.pt'
    'voices/af_heart.pt'
  )
}

$models = @($nemotronModel, $kokoroModel)
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$speechDirectory = Join-Path $repositoryRoot 'services\speech'

if ([string]::IsNullOrWhiteSpace($CacheDir)) {
  throw 'CacheDir must be a non-empty absolute path.'
}
$cacheRoot = [System.IO.Path]::GetPathRoot($CacheDir)
if (
  -not [System.IO.Path]::IsPathRooted($CacheDir) -or
  [string]::IsNullOrWhiteSpace($cacheRoot)
) {
  throw 'CacheDir must be an absolute path.'
}
$resolvedCacheDir = [System.IO.Path]::GetFullPath($CacheDir)
$resolvedCacheRoot = [System.IO.Path]::GetFullPath($cacheRoot)
if (
  $resolvedCacheDir.TrimEnd([System.IO.Path]::DirectorySeparatorChar) -eq
  $resolvedCacheRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
) {
  throw 'CacheDir must not be a filesystem root.'
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory)]
    [string]$Executable,

    [Parameter(Mandatory)]
    [string[]]$Arguments,

    [Parameter(Mandatory)]
    [string]$Description
  )

  & $Executable @Arguments
  $commandExitCode = $LASTEXITCODE
  if ($commandExitCode -ne 0) {
    throw "$Description failed with exit code $commandExitCode."
  }
}

function Get-SnapshotCandidates {
  param(
    [Parameter(Mandatory)]
    [string]$Repository,

    [Parameter(Mandatory)]
    [string]$Revision
  )

  $repositorySlug = "models--$($Repository.Replace('/', '--'))"
  return @(
    (Join-Path $resolvedCacheDir "$repositorySlug\snapshots\$Revision")
    (Join-Path $resolvedCacheDir "hub\$repositorySlug\snapshots\$Revision")
  )
}

function Test-CompleteSnapshot {
  param(
    [Parameter(Mandatory)]
    [PSCustomObject]$Model
  )

  foreach ($candidate in Get-SnapshotCandidates `
    -Repository $Model.Repository `
    -Revision $Model.Revision) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
      continue
    }
    $missingFiles = @(
      $Model.Files | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $candidate $_) -PathType Leaf)
      }
    )
    if ($missingFiles.Count -eq 0) {
      return $true
    }
  }
  return $false
}

function Get-DownloadArguments {
  param(
    [Parameter(Mandatory)]
    [PSCustomObject]$Model
  )

  return @(
    'run'
    '--no-sync'
    '--no-python-downloads'
    'hf'
    'download'
    $Model.Repository
  ) + @($Model.Files) + @(
    '--type'
    'model'
    '--revision'
    $Model.Revision
    '--cache-dir'
    $resolvedCacheDir
    '--format'
    'agent'
  )
}

$mode = if ($Runtime -eq 'local-cuda') { 'cuda' } else { 'cpu' }
$dependencyArguments = @(
  'sync'
  '--locked'
  '--no-python-downloads'
  '--extra'
  'dev'
  '--extra'
  $Runtime
)
$doctorArguments = @(
  'run'
  '--no-sync'
  '--no-python-downloads'
  'python'
  '-m'
  'suits_speech.doctor'
)
$downloadPlans = @(
  $models | ForEach-Object {
    [PSCustomObject]@{
      repository = $_.Repository
      revision = $_.Revision
      files = @($_.Files)
      command = [PSCustomObject]@{
        executable = 'uv'
        arguments = @(Get-DownloadArguments -Model $_)
      }
    }
  }
)

if ($PlanOnly) {
  [PSCustomObject]@{
    schemaVersion = 'speech-setup-plan.v1'
    runtime = $Runtime
    speechMode = $mode
    cacheDir = $resolvedCacheDir
    dependencySync = [PSCustomObject]@{
      executable = 'uv'
      arguments = $dependencyArguments
    }
    downloadModels = [bool]$DownloadModels
    modelManifests = $downloadPlans
    doctor = [PSCustomObject]@{
      executable = 'uv'
      arguments = $doctorArguments
    }
  } | ConvertTo-Json -Depth 7
  return
}

if (-not (Test-Path -LiteralPath (Join-Path $speechDirectory 'pyproject.toml') -PathType Leaf)) {
  throw "Speech service was not found under $speechDirectory."
}

$uvCommand = Get-Command uv -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $uvCommand) {
  throw 'uv was not found on PATH. Install uv, open a new PowerShell session, and retry.'
}

Write-Host "[1/3] Syncing the pinned $Runtime speech environment."
Push-Location $speechDirectory
try {
  Invoke-CheckedCommand `
    -Executable $uvCommand.Source `
    -Arguments $dependencyArguments `
    -Description "uv dependency sync for $Runtime"

  if ($DownloadModels) {
    Write-Host '[2/3] Checking and downloading only the pinned model allowlists.'
    [void](New-Item -ItemType Directory -Force -Path $resolvedCacheDir)

    foreach ($model in $models) {
      if (Test-CompleteSnapshot -Model $model) {
        Write-Host "  $($model.Name) is already complete at its pinned revision; download skipped."
        continue
      }

      Write-Host "  Downloading $($model.Name) at revision $($model.Revision)."
      $downloadArguments = @(Get-DownloadArguments -Model $model)
      Invoke-CheckedCommand `
        -Executable $uvCommand.Source `
        -Arguments $downloadArguments `
        -Description "$($model.Name) pinned artifact download"
    }
  } else {
    Write-Host '[2/3] Model download not requested; only existing pinned cache entries will be used.'
    Write-Host '      Re-run with -DownloadModels to opt in to the two allowlisted downloads.'
  }

  Write-Host '[3/3] Running the read-only local speech doctor.'
  $environmentNames = @(
    'SUITS_SPEECH_MODE'
    'SUITS_SPEECH_CACHE_DIR'
    'SUITS_STT_PROVIDER'
    'SUITS_STT_MODEL_ID'
    'SUITS_STT_MODEL_REVISION'
    'SUITS_TTS_PROVIDER'
    'SUITS_TTS_MODEL_ID'
    'SUITS_TTS_MODEL_REVISION'
    'SUITS_TTS_VOICES'
  )
  $previousEnvironment = @{}
  foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }

  try {
    $env:SUITS_SPEECH_MODE = $mode
    $env:SUITS_SPEECH_CACHE_DIR = $resolvedCacheDir
    $env:SUITS_STT_PROVIDER = 'nemotron-transformers'
    $env:SUITS_STT_MODEL_ID = $nemotronModel.Repository
    $env:SUITS_STT_MODEL_REVISION = $nemotronModel.Revision
    $env:SUITS_TTS_PROVIDER = 'kokoro'
    $env:SUITS_TTS_MODEL_ID = $kokoroModel.Repository
    $env:SUITS_TTS_MODEL_REVISION = $kokoroModel.Revision
    $env:SUITS_TTS_VOICES = 'judge=am_michael,opposing_counsel=bm_george,witness=af_heart'

    Invoke-CheckedCommand `
      -Executable $uvCommand.Source `
      -Arguments $doctorArguments `
      -Description 'local speech doctor'
  } finally {
    foreach ($name in $environmentNames) {
      [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
  }
} finally {
  Pop-Location
}

Write-Host "Local speech setup is ready for $Runtime."
