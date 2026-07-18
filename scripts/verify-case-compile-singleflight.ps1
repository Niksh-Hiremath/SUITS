[CmdletBinding()]
param(
  [Parameter()]
  [ValidatePattern('^https?://')]
  [string]$BaseUrl = 'http://127.0.0.1:3000',

  [Parameter()]
  [string]$PacketPath = (Join-Path $PSScriptRoot '..\tests\fixtures\case-packets\beacon-row-market.md')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$resolvedPacketPath = [System.IO.Path]::GetFullPath($PacketPath)
if (-not [System.IO.File]::Exists($resolvedPacketPath)) {
  throw "Case packet fixture was not found: $resolvedPacketPath"
}

$origin = $BaseUrl.TrimEnd('/')
$packetBytes = [System.IO.File]::ReadAllBytes($resolvedPacketPath)
$requestId = [guid]::NewGuid().ToString()
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.UseCookies = $true
$handler.CookieContainer = New-Object System.Net.CookieContainer
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromMinutes(5)
[void]$client.DefaultRequestHeaders.TryAddWithoutValidation('Origin', $origin)

function New-CompileForm {
  param(
    [Parameter(Mandatory)]
    [string]$CompileRequestId,

    [Parameter(Mandatory)]
    [byte[]]$Bytes
  )

  $form = New-Object System.Net.Http.MultipartFormDataContent
  $requestContent = New-Object System.Net.Http.StringContent(
    $CompileRequestId,
    [System.Text.Encoding]::UTF8
  )
  $packetContent = New-Object System.Net.Http.ByteArrayContent -ArgumentList (, $Bytes)
  $packetContent.Headers.ContentType =
    [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('text/markdown')
  $form.Add($requestContent, 'requestId')
  $form.Add($packetContent, 'packet', 'beacon-row-market.md')
  return ,$form
}

function Get-OptionalHeader {
  param(
    [Parameter(Mandatory)]
    [System.Net.Http.HttpResponseMessage]$Response,

    [Parameter(Mandatory)]
    [string]$Name
  )

  if (-not $Response.Headers.Contains($Name)) {
    return $null
  }
  return $Response.Headers.GetValues($Name) -join ','
}

function Read-CompileResponse {
  param(
    [Parameter(Mandatory)]
    [string]$Label,

    [Parameter(Mandatory)]
    [System.Net.Http.HttpResponseMessage]$Response,

    [Parameter(Mandatory)]
    [int64]$ElapsedMs
  )

  $rawBody = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $body = $rawBody | ConvertFrom-Json
  return [PSCustomObject]@{
    label = $Label
    status = [int]$Response.StatusCode
    elapsedMs = $ElapsedMs
    retryAfter = if ($Response.Headers.RetryAfter) {
      $Response.Headers.RetryAfter.Delta.TotalSeconds
    } else {
      $null
    }
    replayed = Get-OptionalHeader -Response $Response -Name 'X-SUITS-Replayed'
    errorCode = $body.error.code
    uploadId = $body.upload.uploadId
    caseId = $body.caseGraph.caseId
    title = $body.caseGraph.title
  }
}

$sessionResponse = $null
$formA = $null
$formB = $null
$retryForm = $null
$sessionContent = $null
$raceResponses = @()
$raceResults = @()
$retryResponse = $null

try {
  $sessionContent = New-Object System.Net.Http.StringContent('')
  $sessionResponse = $client.PostAsync(
    "$origin/api/cases/session",
    $sessionContent
  ).GetAwaiter().GetResult()
  if ([int]$sessionResponse.StatusCode -ne 200) {
    throw "Session endpoint returned $([int]$sessionResponse.StatusCode)"
  }

  $formA = New-CompileForm -CompileRequestId $requestId -Bytes $packetBytes
  $formB = New-CompileForm -CompileRequestId $requestId -Bytes $packetBytes
  $raceWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $pending = @(
    [PSCustomObject]@{
      label = 'A'
      task = $client.PostAsync("$origin/api/cases/compile", $formA)
    },
    [PSCustomObject]@{
      label = 'B'
      task = $client.PostAsync("$origin/api/cases/compile", $formB)
    }
  )

  while ($pending.Count -gt 0) {
    $completedIndex = [System.Threading.Tasks.Task]::WaitAny(
      [System.Threading.Tasks.Task[]]$pending.task
    )
    $completed = $pending[$completedIndex]
    $response = $completed.task.GetAwaiter().GetResult()
    $raceResponses += $response
    $raceResults += Read-CompileResponse -Label $completed.label -Response $response `
      -ElapsedMs $raceWatch.ElapsedMilliseconds
    $pending = @($pending | Where-Object { $_.label -ne $completed.label })
  }
  $raceWatch.Stop()

  $statuses = @($raceResults.status | Sort-Object)
  if (($statuses -join ',') -ne '200,409') {
    throw "Expected one 200 and one 409 response; received $($statuses -join ',')"
  }
  $winner = @($raceResults | Where-Object { $_.status -eq 200 })
  $busy = @($raceResults | Where-Object { $_.status -eq 409 })
  if ($winner.Count -ne 1 -or $busy.Count -ne 1) {
    throw 'The race did not produce exactly one winner and one busy response'
  }
  if ($busy[0].errorCode -ne 'CASE_COMPILATION_IN_PROGRESS') {
    throw "Unexpected busy error: $($busy[0].errorCode)"
  }
  if (-not $busy[0].retryAfter -or $busy[0].retryAfter -lt 1) {
    throw 'The busy response did not include a positive Retry-After value'
  }

  $retryForm = New-CompileForm -CompileRequestId $requestId -Bytes $packetBytes
  $retryWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $retryResponse = $client.PostAsync(
    "$origin/api/cases/compile",
    $retryForm
  ).GetAwaiter().GetResult()
  $retryWatch.Stop()
  $retryResult = Read-CompileResponse -Label 'retry' -Response $retryResponse `
    -ElapsedMs $retryWatch.ElapsedMilliseconds

  if ($retryResult.status -ne 200 -or $retryResult.replayed -ne 'true') {
    throw 'The identical retry did not return a replayed 200 response'
  }
  if (
    $retryResult.uploadId -ne $winner[0].uploadId -or
    $retryResult.caseId -ne $winner[0].caseId
  ) {
    throw 'The replay response did not preserve the winning upload/case identity'
  }

  [PSCustomObject]@{
    verification = 'passed'
    requestId = $requestId
    packetBytes = $packetBytes.Length
    sessionStatus = [int]$sessionResponse.StatusCode
    race = @($raceResults | ForEach-Object {
      [PSCustomObject]@{
        label = $_.label
        status = $_.status
        elapsedMs = $_.elapsedMs
        retryAfter = $_.retryAfter
        errorCode = $_.errorCode
      }
    })
    winnerTitle = $winner[0].title
    retry = [PSCustomObject]@{
      status = $retryResult.status
      elapsedMs = $retryResult.elapsedMs
      replayed = $retryResult.replayed
      sameIdentity = $true
    }
  } | ConvertTo-Json -Depth 6 -Compress
} finally {
  foreach ($response in $raceResponses) {
    if ($response) {
      $response.Dispose()
    }
  }
  if ($retryResponse) {
    $retryResponse.Dispose()
  }
  if ($sessionResponse) {
    $sessionResponse.Dispose()
  }
  if ($sessionContent) {
    $sessionContent.Dispose()
  }
  if ($formA) {
    $formA.Dispose()
  }
  if ($formB) {
    $formB.Dispose()
  }
  if ($retryForm) {
    $retryForm.Dispose()
  }
  $client.Dispose()
  $handler.Dispose()
}
