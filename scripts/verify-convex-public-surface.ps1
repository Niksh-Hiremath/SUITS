[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$expectedPublicFunctions = @(
  "caseUploads.js:generateUploadUrl"
  "caseUploads.js:getDownloadUrl"
  "caseUploads.js:getLatest"
  "caseUploads.js:listMine"
  "caseUploads.js:listSourceSegments"
  "caseUploads.js:registerStoredUpload"
) | Sort-Object

$rawSpec = @(& npm exec -- convex function-spec 2>&1)
if ($LASTEXITCODE -ne 0) {
  $rawSpec | Select-Object -Last 80 | Write-Error
  exit $LASTEXITCODE
}

try {
  $spec = $rawSpec | Out-String | ConvertFrom-Json
} catch {
  throw "Convex function-spec did not return valid JSON"
}

$actualPublicFunctions = @(
  $spec.functions |
    Where-Object {
      $_.functionType -ne "HttpAction" -and
      $_.visibility.kind -eq "public"
    } |
    ForEach-Object { $_.identifier }
) | Sort-Object

$unexpected = @($actualPublicFunctions | Where-Object {
  $_ -notin $expectedPublicFunctions
})
$missing = @($expectedPublicFunctions | Where-Object {
  $_ -notin $actualPublicFunctions
})

if ($unexpected.Count -gt 0 -or $missing.Count -gt 0) {
  if ($unexpected.Count -gt 0) {
    Write-Error (
      "Unexpected public Convex functions: " + ($unexpected -join ", ")
    )
  }
  if ($missing.Count -gt 0) {
    Write-Error (
      "Expected authenticated public functions are missing: " +
      ($missing -join ", ")
    )
  }
  exit 1
}

Write-Output (
  "Convex public function surface verified: {0} authenticated functions." -f
  $actualPublicFunctions.Count
)
