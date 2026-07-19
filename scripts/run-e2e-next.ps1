$ErrorActionPreference = "Stop"

& npx convex dev --once
if ($LASTEXITCODE -ne 0) {
  throw "The Convex development functions could not be synchronized."
}

if ([string]::IsNullOrWhiteSpace($env:SUITS_CONVEX_SERVICE_SECRET)) {
  $configuredSecret = (& npx convex env get SUITS_CONVEX_SERVICE_SECRET 2>$null | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($configuredSecret)) {
    throw "The Convex development deployment is missing SUITS_CONVEX_SERVICE_SECRET."
  }
  $env:SUITS_CONVEX_SERVICE_SECRET = $configuredSecret.Trim()
}

if ($env:SUITS_CONVEX_SERVICE_SECRET.Length -lt 32) {
  throw "SUITS_CONVEX_SERVICE_SECRET must contain at least 32 characters."
}

if ([string]::IsNullOrWhiteSpace($env:SUITS_SESSION_SECRET)) {
  $sessionBytes = [byte[]]::new(32)
  $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $randomGenerator.GetBytes($sessionBytes)
  }
  finally {
    $randomGenerator.Dispose()
  }
  $env:SUITS_SESSION_SECRET =
    [BitConverter]::ToString($sessionBytes).Replace("-", "").ToLowerInvariant()
}

& npm run dev -- --hostname 127.0.0.1 --port 3100
exit $LASTEXITCODE
