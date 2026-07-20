[CmdletBinding()]
param(
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ClientAssetsPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$findings = [System.Collections.Generic.List[string]]::new()

function Add-Finding {
  param([Parameter(Mandatory = $true)][string]$Message)

  [void]$findings.Add($Message)
}

function Relative-Path {
  param(
    [Parameter(Mandatory = $true)][string]$BasePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  $normalizedBase = [IO.Path]::GetFullPath($BasePath).TrimEnd("\", "/")
  $normalizedTarget = [IO.Path]::GetFullPath($TargetPath)
  $prefix = "$normalizedBase\"
  if ($normalizedTarget.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    return $normalizedTarget.Substring($prefix.Length).Replace("\", "/")
  }
  return Split-Path -Leaf $normalizedTarget
}

try {
  $resolvedRepositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
} catch {
  Write-Error "Production-boundary verification could not resolve the repository root."
  exit 1
}

if ([string]::IsNullOrWhiteSpace($ClientAssetsPath)) {
  $ClientAssetsPath = Join-Path $resolvedRepositoryRoot ".next\static"
}

$gitRootOutput = @(& git -C $resolvedRepositoryRoot rev-parse --show-toplevel 2>&1)
$gitRootExitCode = $LASTEXITCODE
if ($gitRootExitCode -ne 0 -or $gitRootOutput.Count -eq 0) {
  Add-Finding "Git could not enumerate the tracked repository boundary."
} else {
  try {
    $resolvedGitRoot = (Resolve-Path -LiteralPath ([string]$gitRootOutput[-1])).Path
    if ($resolvedGitRoot -ne $resolvedRepositoryRoot) {
      Add-Finding "The supplied repository root is not the tracked Git root."
    }
  } catch {
    Add-Finding "Git returned an invalid tracked repository root."
  }
}

$trackedFiles = @()
if ($findings.Count -eq 0) {
  $trackedFiles = @(& git -C $resolvedRepositoryRoot ls-files 2>&1)
  $trackedExitCode = $LASTEXITCODE
  if ($trackedExitCode -ne 0) {
    Add-Finding "Git could not enumerate tracked files."
    $trackedFiles = @()
  }
}

$unsafeEnvironmentFiles = @(
  $trackedFiles |
    Where-Object {
      $normalized = ([string]$_).Replace("\", "/")
      $leaf = Split-Path -Leaf $normalized
      $leaf -like ".env*" -and $leaf -ne ".env.example"
    } |
    Sort-Object -Unique
)
foreach ($path in $unsafeEnvironmentFiles) {
  Add-Finding "Tracked environment file is not allowlisted: $path"
}

$trackedSecretPatterns = [ordered]@{
  "OpenAI-style API key" = "sk-[A-Za-z0-9_-]{20,}"
  "AWS access key" = "AKIA[0-9A-Z]{16}"
  "GitHub access token" = "gh[pousr]_[A-Za-z0-9]{30,}"
  "Slack access token" = "xox[baprs]-[A-Za-z0-9-]{20,}"
  "Private key block" = "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"
}

if ($trackedFiles.Count -gt 0) {
  foreach ($entry in $trackedSecretPatterns.GetEnumerator()) {
    $matchedFiles = @(
      & git -C $resolvedRepositoryRoot grep -I -l -E -- $entry.Value 2>$null
    )
    $grepExitCode = $LASTEXITCODE
    if ($grepExitCode -eq 0) {
      foreach ($path in ($matchedFiles | Sort-Object -Unique)) {
        Add-Finding "Tracked secret pattern '$($entry.Key)' matched: $path"
      }
    } elseif ($grepExitCode -ne 1) {
      Add-Finding "Git failed while scanning tracked files for '$($entry.Key)'."
    }
  }
}

$resolvedClientAssetsPath = $null
try {
  $resolvedClientAssetsPath = (Resolve-Path -LiteralPath $ClientAssetsPath).Path
} catch {
  Add-Finding "Production client assets are missing; run the production build first."
}

$clientFiles = @()
if ($null -ne $resolvedClientAssetsPath) {
  $clientFiles = @(
    Get-ChildItem -LiteralPath $resolvedClientAssetsPath -Recurse -File |
      Where-Object { $_.Extension -in @(".css", ".html", ".js", ".json", ".map", ".txt") }
  )
  if ($clientFiles.Count -eq 0) {
    Add-Finding "Production client assets contain no scannable text bundles."
  }
}

$forbiddenClientValues = [ordered]@{
  "OpenAI build sentinel" = "SUITS_VERIFY_OPENAI_SENTINEL_DO_NOT_SHIP_20260720"
  "Convex service build sentinel" = "SUITS_VERIFY_CONVEX_SENTINEL_DO_NOT_SHIP_20260720"
  "Session build sentinel" = "SUITS_VERIFY_SESSION_SENTINEL_DO_NOT_SHIP_20260720"
  "OpenAI server environment name" = "OPENAI_API_KEY"
  "Convex service environment name" = "SUITS_CONVEX_SERVICE_SECRET"
  "Session environment name" = "SUITS_SESSION_SECRET"
  "Developer typed-input environment name" = "NEXT_PUBLIC_SUITS_DEV_TYPED_INPUT"
  "Developer typed-input label" = "Developer-only typed"
  "Developer typed-input submit button" = "Submit developer transcript"
  "Developer typed-input failure message" = "developer speech fallback could not be submitted"
}

foreach ($file in $clientFiles) {
  try {
    $content = [IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8)
  } catch {
    Add-Finding "Production client asset could not be read: $(Relative-Path $resolvedRepositoryRoot $file.FullName)"
    continue
  }

  foreach ($entry in $forbiddenClientValues.GetEnumerator()) {
    if ($content.IndexOf($entry.Value, [StringComparison]::Ordinal) -ge 0) {
      Add-Finding "Forbidden client value '$($entry.Key)' matched: $(Relative-Path $resolvedRepositoryRoot $file.FullName)"
    }
  }
  foreach ($entry in $trackedSecretPatterns.GetEnumerator()) {
    if ([regex]::IsMatch($content, $entry.Value, [Text.RegularExpressions.RegexOptions]::CultureInvariant)) {
      Add-Finding "Client secret pattern '$($entry.Key)' matched: $(Relative-Path $resolvedRepositoryRoot $file.FullName)"
    }
  }
}

if ($findings.Count -gt 0) {
  Write-Output "Production boundary verification FAILED:"
  foreach ($finding in ($findings | Sort-Object -Unique)) {
    Write-Output "- $finding"
  }
  exit 1
}

Write-Output (
  "Production boundary verification PASSED: {0} tracked files and {1} client assets checked." -f
    $trackedFiles.Count,
    $clientFiles.Count
)
