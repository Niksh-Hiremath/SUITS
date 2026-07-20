[CmdletBinding()]
param(
  [switch]$LiveOpenAI,
  [switch]$LiveCudaSmoke
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$speechProject = Join-Path $repositoryRoot "services\speech"
$productionBoundaryScript = Join-Path $PSScriptRoot "verify-production-boundary.ps1"

$passed = [System.Collections.Generic.List[string]]::new()
$failed = [System.Collections.Generic.List[string]]::new()
$skippedOpenAI = [System.Collections.Generic.List[string]]::new()
$skippedGpu = [System.Collections.Generic.List[string]]::new()

function Add-Passed {
  param([Parameter(Mandatory = $true)][string]$Label)
  [void]$passed.Add($Label)
}

function Add-Failed {
  param([Parameter(Mandatory = $true)][string]$Label)
  [void]$failed.Add($Label)
}

function Invoke-RequiredCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$WorkingDirectory = $repositoryRoot
  )

  Write-Output "RUNNING: $Label"
  $exitCode = 1
  $locationPushed = $false
  try {
    Push-Location -LiteralPath $WorkingDirectory
    $locationPushed = $true
    & $Executable @Arguments
    $exitCode = $LASTEXITCODE
  } catch {
    Write-Warning "$Label could not run: $($_.Exception.Message)"
    $exitCode = 1
  } finally {
    if ($locationPushed) {
      Pop-Location
    }
  }

  if ($exitCode -eq 0) {
    Add-Passed $Label
  } else {
    Add-Failed "$Label (exit $exitCode)"
  }
}

function Invoke-WithEnvironment {
  param(
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  $previousValues = @{}
  $previouslyPresent = @{}
  foreach ($name in $Values.Keys) {
    $environmentPath = "Env:$name"
    $existing = Get-Item -LiteralPath $environmentPath -ErrorAction SilentlyContinue
    $previouslyPresent[$name] = $null -ne $existing
    if ($null -ne $existing) {
      $previousValues[$name] = $existing.Value
    }
    Set-Item -LiteralPath $environmentPath -Value ([string]$Values[$name])
  }

  try {
    & $Action
  } finally {
    foreach ($name in $Values.Keys) {
      $environmentPath = "Env:$name"
      if ($previouslyPresent[$name]) {
        Set-Item -LiteralPath $environmentPath -Value $previousValues[$name]
      } else {
        Remove-Item -LiteralPath $environmentPath -ErrorAction SilentlyContinue
      }
    }
  }
}

function Invoke-LiveVitestCheck {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$TestFile
  )

  Write-Output "RUNNING: $Label"
  $reportPath = Join-Path ([IO.Path]::GetTempPath()) (
    "suits-live-vitest-{0}.json" -f [Guid]::NewGuid().ToString("N")
  )
  $exitCode = 1
  $locationPushed = $false
  try {
    Push-Location -LiteralPath $repositoryRoot
    $locationPushed = $true
    $vitestArguments = @(
      "--env-file-if-exists=.env.local",
      "--env-file-if-exists=.env",
      ".\node_modules\vitest\vitest.mjs",
      "run",
      $TestFile,
      "--reporter=json",
      "--outputFile=$reportPath"
    )
    & node @vitestArguments
    $exitCode = $LASTEXITCODE
  } catch {
    Write-Warning "$Label could not run: $($_.Exception.Message)"
    $exitCode = 1
  } finally {
    if ($locationPushed) {
      Pop-Location
    }
  }

  $report = $null
  if (Test-Path -LiteralPath $reportPath) {
    try {
      $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    } catch {
      Write-Warning "$Label did not emit a valid Vitest JSON report."
    }
  }

  $reportIsComplete = $false
  if ($null -ne $report) {
    $requiredProperties = @(
      "numFailedTestSuites",
      "numFailedTests",
      "numPassedTestSuites",
      "numPassedTests",
      "numPendingTestSuites",
      "numPendingTests",
      "numTotalTestSuites",
      "numTotalTests",
      "success"
    )
    $availableProperties = @($report.PSObject.Properties.Name)
    $missingProperties = @(
      $requiredProperties | Where-Object { $_ -notin $availableProperties }
    )
    if ($missingProperties.Count -eq 0) {
      $reportIsComplete =
        [bool]$report.success -and
        [int]$report.numTotalTestSuites -gt 0 -and
        [int]$report.numTotalTests -gt 0 -and
        [int]$report.numFailedTestSuites -eq 0 -and
        [int]$report.numFailedTests -eq 0 -and
        [int]$report.numPendingTestSuites -eq 0 -and
        [int]$report.numPendingTests -eq 0 -and
        [int]$report.numPassedTestSuites -eq [int]$report.numTotalTestSuites -and
        [int]$report.numPassedTests -eq [int]$report.numTotalTests
    }
  }

  if ($exitCode -eq 0 -and $reportIsComplete) {
    Add-Passed $Label
  } else {
    Add-Failed "$Label (failed, invalid, empty, or skipped Vitest report)"
  }

  Remove-Item -LiteralPath $reportPath -Force -ErrorAction SilentlyContinue
}

function Resolve-LiveCourtroomConvexServiceSecret {
  if (-not [string]::IsNullOrWhiteSpace($env:SUITS_CONVEX_SERVICE_SECRET)) {
    return $env:SUITS_CONVEX_SERVICE_SECRET
  }

  $captured = @()
  $exitCode = 1
  $locationPushed = $false
  try {
    Push-Location -LiteralPath $repositoryRoot
    $locationPushed = $true
    $captured = @(& npx convex env get SUITS_CONVEX_SERVICE_SECRET 2>$null)
    $exitCode = $LASTEXITCODE
  } catch {
    $exitCode = 1
  } finally {
    if ($locationPushed) {
      Pop-Location
    }
  }

  if ($exitCode -ne 0) {
    return $null
  }
  $candidates = @(
    $captured |
      ForEach-Object { ([string]$_).Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
  if ($candidates.Count -eq 0) {
    return $null
  }
  $candidate = [string]$candidates[-1]
  if ($candidate -notmatch '^[A-Za-z0-9._~+/=-]{32,512}$') {
    return $null
  }
  return $candidate
}

function Invoke-LiveCudaCheck {
  Write-Output "RUNNING: Live CUDA Kokoro-to-Nemotron smoke"
  $output = @()
  $exitCode = 1
  $locationPushed = $false
  try {
    Push-Location -LiteralPath $speechProject
    $locationPushed = $true
    $output = @(
      & uv run --quiet --locked --no-sync --no-python-downloads python -m suits_speech.smoke 2>&1
    )
    $exitCode = $LASTEXITCODE
  } catch {
    Write-Warning "Live CUDA smoke could not run: $($_.Exception.Message)"
    $exitCode = 1
  } finally {
    if ($locationPushed) {
      Pop-Location
    }
  }

  $payload = $null
  try {
    $payload = ($output | Out-String) | ConvertFrom-Json
  } catch {
    Write-Warning "Live CUDA smoke did not emit its strict JSON result."
  }

  if (
    $exitCode -eq 0 -and
    $null -ne $payload -and
    $payload.schemaVersion -eq "speech-live-smoke.v1" -and
    $payload.status -eq "passed" -and
    [int]$payload.exitCode -eq 0
  ) {
    Add-Passed "Live CUDA Kokoro-to-Nemotron smoke"
  } else {
    Add-Failed "Live CUDA Kokoro-to-Nemotron smoke (failed, invalid, or skipped result)"
  }
}

function Write-ResultSection {
  param(
    [Parameter(Mandatory = $true)][string]$Heading,
    [Parameter(Mandatory = $true)][System.Collections.IEnumerable]$Items
  )

  Write-Output ""
  Write-Output "=== $Heading ==="
  $materialized = @($Items)
  if ($materialized.Count -eq 0) {
    Write-Output "- (none)"
    return
  }
  foreach ($item in $materialized) {
    Write-Output "- $item"
  }
}

Invoke-RequiredCommand "Root ESLint" "npm" @("run", "lint")
Invoke-RequiredCommand "Root TypeScript" "npm" @("run", "typecheck")
Invoke-RequiredCommand "Convex TypeScript" "npm" @(
  "exec", "--", "tsc", "-p", "convex/tsconfig.json", "--noEmit", "--pretty", "false"
)
Invoke-RequiredCommand "Root unit and integration tests" "npm" @(
  "test", "--", "--reporter=dot"
)
Invoke-RequiredCommand "Deterministic evaluations" "npm" @("run", "eval")
Invoke-RequiredCommand "Exact deployed Convex public surface" "npm" @(
  "run", "verify:convex-surface"
)

$speechSyncArguments = [System.Collections.Generic.List[string]]::new()
foreach ($argument in @(
  "sync", "--project", $speechProject, "--locked", "--no-python-downloads", "--extra", "dev"
)) {
  [void]$speechSyncArguments.Add($argument)
}
if ($LiveCudaSmoke) {
  [void]$speechSyncArguments.Add("--extra")
  [void]$speechSyncArguments.Add("local-cuda")
}
Invoke-RequiredCommand "Locked speech dependency sync" "uv" $speechSyncArguments.ToArray()
Invoke-RequiredCommand "Speech Ruff format" "uv" @(
  "run", "--locked", "--no-sync", "--no-python-downloads", "ruff", "format", "--check", "src", "tests"
) $speechProject
Invoke-RequiredCommand "Speech Ruff lint" "uv" @(
  "run", "--locked", "--no-sync", "--no-python-downloads", "ruff", "check", "src", "tests"
) $speechProject
Invoke-RequiredCommand "Speech strict mypy" "uv" @(
  "run", "--locked", "--no-sync", "--no-python-downloads", "mypy", "--strict", "src/suits_speech"
) $speechProject
Invoke-RequiredCommand "Speech pytest" "uv" @(
  "run", "--locked", "--no-sync", "--no-python-downloads", "python", "-m", "pytest", "-q"
) $speechProject

$buildEnvironment = [ordered]@{
  OPENAI_API_KEY = "SUITS_VERIFY_OPENAI_SENTINEL_DO_NOT_SHIP_20260720"
  SUITS_CONVEX_SERVICE_SECRET = "SUITS_VERIFY_CONVEX_SENTINEL_DO_NOT_SHIP_20260720"
  SUITS_SESSION_SECRET = "SUITS_VERIFY_SESSION_SENTINEL_DO_NOT_SHIP_20260720"
  NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT = "0"
}
Invoke-WithEnvironment $buildEnvironment {
  Invoke-RequiredCommand "Production build" "npm" @("run", "build")
}
Invoke-RequiredCommand "Tracked-secret and production client boundary" "powershell.exe" @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $productionBoundaryScript,
  "-RepositoryRoot", $repositoryRoot,
  "-ClientAssetsPath", (Join-Path $repositoryRoot ".next\static")
)
Invoke-RequiredCommand "Chromium end-to-end tests" "npm" @("run", "test:e2e")

if ($LiveOpenAI) {
  Invoke-WithEnvironment ([ordered]@{
    RUN_OPENAI_LIVE = "1"
    RUN_OPENAI_LIVE_INJECTION = "1"
    RUN_OPENAI_LIVE_COURTROOM = "1"
  }) {
    Invoke-LiveVitestCheck "Live Terra case compilation" "src/server/case-compiler/case-compiler.live.test.ts"
    Invoke-LiveVitestCheck "Live Terra prompt-injection boundary" "src/server/case-compiler/case-compiler.injection.live.test.ts"

    $convexServiceSecret = Resolve-LiveCourtroomConvexServiceSecret
    if ([string]::IsNullOrWhiteSpace($convexServiceSecret)) {
      Add-Failed "Live Luna courtroom witness runtime (linked Convex service secret unavailable)"
    } else {
      Invoke-WithEnvironment ([ordered]@{
        SUITS_CONVEX_SERVICE_SECRET = $convexServiceSecret
      }) {
        Invoke-LiveVitestCheck "Live Luna courtroom witness runtime" "src/server/courtroom-ai/witness-runtime.live.test.ts"
      }
      $convexServiceSecret = $null
    }
  }
} else {
  [void]$skippedOpenAI.Add("Live Terra case compilation (-LiveOpenAI not supplied)")
  [void]$skippedOpenAI.Add("Live Terra prompt-injection boundary (-LiveOpenAI not supplied)")
  [void]$skippedOpenAI.Add("Live Luna courtroom witness runtime (-LiveOpenAI not supplied)")
}

if ($LiveCudaSmoke) {
  Invoke-WithEnvironment ([ordered]@{
    SUITS_RUN_LIVE_SPEECH_SMOKE = "1"
    SUITS_SPEECH_MODE = "cuda"
  }) {
    Invoke-LiveCudaCheck
  }
} else {
  [void]$skippedGpu.Add("Live Kokoro-to-Nemotron CUDA smoke (-LiveCudaSmoke not supplied)")
}

Write-ResultSection "PASSED" $passed
Write-ResultSection "FAILED" $failed
Write-ResultSection "SKIPPED-OPENAI" $skippedOpenAI
Write-ResultSection "SKIPPED-GPU" $skippedGpu

if ($failed.Count -gt 0) {
  exit 1
}
exit 0
