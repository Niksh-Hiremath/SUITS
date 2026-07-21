[CmdletBinding()]
param(
  [Parameter()]
  [ValidateRange(1024, 65535)]
  [int]$Port = 8791
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$wranglerPath = Join-Path $workspacePath 'node_modules\wrangler\bin\wrangler.js'
$configPath = Join-Path $workspacePath 'wrangler.pdf-extraction.jsonc'
$emptyEnvironmentPath = Join-Path $workspacePath 'tests\workerd\no-bindings.env'
$logDirectory = Join-Path $workspacePath '.wrangler'
$stdoutPath = Join-Path $logDirectory 'pdf-extraction-smoke.stdout.log'
$stderrPath = Join-Path $logDirectory 'pdf-extraction-smoke.stderr.log'

if (-not [System.IO.File]::Exists($wranglerPath)) {
  throw "Wrangler was not found at $wranglerPath. Run npm ci first."
}
if (-not [System.IO.File]::Exists($configPath)) {
  throw "The Workerd PDF smoke-test config was not found at $configPath."
}
if (-not [System.IO.File]::Exists($emptyEnvironmentPath)) {
  throw "The empty Workerd environment file was not found at $emptyEnvironmentPath."
}
[void][System.IO.Directory]::CreateDirectory($logDirectory)

$env:CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
$env:CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'

$nodeCommand = Get-Command node -ErrorAction Stop
$workerProcess = $null
$httpClient = $null
$verificationResult = $null
$primaryFailure = $null
$teardownFailure = $null

function Test-LocalTcpPortAvailable {
  param(
    [Parameter(Mandatory)]
    [int]$CandidatePort
  )

  $listener = New-Object System.Net.Sockets.TcpListener(
    [System.Net.IPAddress]::Loopback,
    $CandidatePort
  )
  try {
    $listener.Start()
    return $true
  } catch [System.Net.Sockets.SocketException] {
    return $false
  } finally {
    $listener.Stop()
  }
}

function Stop-ExactProcessTree {
  param(
    [Parameter(Mandatory)]
    [int]$TargetProcessId
  )

  for ($scan = 0; $scan -lt 5; $scan += 1) {
    $children = @(
      Get-CimInstance Win32_Process -Filter "ParentProcessId = $TargetProcessId" -ErrorAction SilentlyContinue
    )
    if ($children.Count -eq 0) {
      break
    }
    foreach ($child in $children) {
      Stop-ExactProcessTree -TargetProcessId ([int]$child.ProcessId)
    }
    Start-Sleep -Milliseconds 25
  }
  Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
}

function Get-LogTail {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  if (-not [System.IO.File]::Exists($Path)) {
    return '<log file was not created>'
  }
  return (Get-Content -LiteralPath $Path -Tail 40 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
}

try {
  if (-not (Test-LocalTcpPortAvailable -CandidatePort $Port)) {
    throw "Port $Port is already in use; choose another port with -Port."
  }
  $arguments = @(
    $wranglerPath,
    'dev',
    '--config',
    $configPath,
    '--env-file',
    $emptyEnvironmentPath,
    '--port',
    $Port.ToString([Globalization.CultureInfo]::InvariantCulture),
    '--local',
    '--show-interactive-dev-session',
    'false'
  )
  $workerProcess = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList $arguments `
    -WorkingDirectory $workspacePath `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  $origin = "http://127.0.0.1:$Port"
  $httpClient = New-Object System.Net.Http.HttpClient
  $httpClient.Timeout = [TimeSpan]::FromSeconds(3)
  $response = $null
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    $workerProcess.Refresh()
    if ($workerProcess.HasExited) {
      throw "Wrangler exited before the smoke test was ready with code $($workerProcess.ExitCode)."
    }
    $httpResponse = $null
    try {
      $httpResponse = $httpClient.GetAsync("$origin/").GetAwaiter().GetResult()
    } catch {
      $httpResponse = $null
    }
    if ($null -ne $httpResponse) {
      try {
        $responseBody = $httpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $httpResponse.IsSuccessStatusCode) {
          throw "Workerd returned HTTP $([int]$httpResponse.StatusCode): $responseBody"
        }
        $response = $responseBody | ConvertFrom-Json
        break
      } finally {
        $httpResponse.Dispose()
      }
    }
    Start-Sleep -Milliseconds 250
  }
  if ($null -eq $response) {
    throw 'Timed out waiting for the Workerd PDF smoke test.'
  }

  if ($response.adapterId -ne 'unpdf-v1.6.2') {
    throw "Unexpected PDF adapter ID: $($response.adapterId)"
  }
  if ($response.mimeType -ne 'application/pdf') {
    throw "Unexpected extracted MIME type: $($response.mimeType)"
  }
  $bindingNames = @($response.bindingNames)
  if ($bindingNames.Count -ne 0) {
    throw "The isolated PDF Worker received unexpected bindings: $($bindingNames -join ', ')"
  }
  $blocks = @($response.blocks)
  if ($blocks.Count -ne 2) {
    throw "Expected two extracted PDF blocks; received $($blocks.Count)."
  }
  if (
    $blocks[0].pageNumber -ne 1 -or
    $blocks[0].label -ne 'Page 1' -or
    $blocks[0].text -ne 'Fictional Harbor filing page one.' -or
    $blocks[1].pageNumber -ne 2 -or
    $blocks[1].label -ne 'Page 2' -or
    $blocks[1].text -ne 'Page two records the disputed inspection.'
  ) {
    throw "Workerd returned unexpected PDF extraction output: $($response | ConvertTo-Json -Depth 5 -Compress)"
  }

  $verificationResult = [PSCustomObject]@{
    verification = 'passed'
    runtime = 'workerd'
    adapterId = $response.adapterId
    mimeType = $response.mimeType
    bindingNames = $bindingNames
    pages = @($blocks | ForEach-Object {
      [PSCustomObject]@{
        pageNumber = $_.pageNumber
        label = $_.label
        text = $_.text
      }
    })
  }
} catch {
  if ($null -eq $workerProcess) {
    $primaryFailure = $_.Exception.Message
  } else {
    $stdout = Get-LogTail -Path $stdoutPath
    $stderr = Get-LogTail -Path $stderrPath
    $primaryFailure = "$($_.Exception.Message)$([Environment]::NewLine)Wrangler stdout:$([Environment]::NewLine)$stdout$([Environment]::NewLine)Wrangler stderr:$([Environment]::NewLine)$stderr"
  }
} finally {
  if ($null -ne $httpClient) {
    $httpClient.Dispose()
  }
  if ($null -ne $workerProcess) {
    Stop-ExactProcessTree -TargetProcessId $workerProcess.Id
    $workerProcess.Dispose()
    $released = $false
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
      if (Test-LocalTcpPortAvailable -CandidatePort $Port) {
        $released = $true
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if (-not $released) {
      $teardownFailure = "The Workerd smoke test did not release port $Port."
    }
  }
}

if ($null -ne $primaryFailure) {
  if ($null -ne $teardownFailure) {
    throw "$primaryFailure$([Environment]::NewLine)Teardown failure: $teardownFailure"
  }
  throw $primaryFailure
}
if ($null -ne $teardownFailure) {
  throw $teardownFailure
}
if ($null -eq $verificationResult) {
  throw 'The Workerd PDF smoke test completed without a verification result.'
}
$verificationResult | ConvertTo-Json -Depth 5 -Compress
