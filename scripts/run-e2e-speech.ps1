$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$speechProject = Join-Path $repositoryRoot "services\speech"

$env:SUITS_SPEECH_MODE = "fake"
$env:SUITS_FAKE_STT_SCENARIO = "leading-objection"
$env:SUITS_SPEECH_ALLOWED_ORIGINS = "http://127.0.0.1:3100"
$env:SUITS_SPEECH_HOST = "127.0.0.1"
$env:SUITS_SPEECH_PORT = "18765"

& uv run --project $speechProject --locked --extra dev suits-speech
exit $LASTEXITCODE
