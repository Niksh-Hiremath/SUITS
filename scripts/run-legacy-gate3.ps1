[CmdletBinding()]
param(
  [ValidateRange(1, 20)]
  [int]$Runs = 5,

  [ValidatePattern("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$")]
  [string]$PromptVersion = "jury-review.v1"
)

$ErrorActionPreference = "Stop"

$argumentsJson = @{
  runs = $Runs
  promptVersion = $PromptVersion
} | ConvertTo-Json -Compress

& npm exec -- convex run autonomous:runGate3 $argumentsJson
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
