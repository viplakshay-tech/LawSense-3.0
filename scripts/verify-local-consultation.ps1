[CmdletBinding()]
param(
    [switch]$PrepareAvatar,
    [switch]$RequireVoiceModels
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check {
    param([string]$Name, [bool]$Passed, [string]$Detail, [bool]$Required = $false)
    $checks.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Required = $Required; Detail = $Detail })
}

function Resolve-Executable {
    param([string]$Configured, [string]$CommandName)
    if ($Configured -and (Test-Path -LiteralPath $Configured -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $Configured).Path
    }
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

Write-Host 'LawSense local consultation readiness' -ForegroundColor Cyan
Write-Host ('Project: ' + $projectRoot)

$node = Resolve-Executable $null 'node'
$npm = Resolve-Executable $null 'npm'
if ($node) {
    $nodeVersion = (& $node --version).Trim()
    $nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
    Add-Check 'Node.js' ($nodeMajor -ge 22) ($nodeVersion + ' (Node 22+ recommended)') $true
} else {
    Add-Check 'Node.js' $false 'Node.js is not installed or not on PATH.' $true
}
Add-Check 'npm' ([bool]$npm) $(if ($npm) { $npm } else { 'npm is not installed or not on PATH.' }) $true

$ollama = Resolve-Executable $null 'ollama'
if ($ollama) {
    $ollamaList = (& $ollama list 2>&1 | Out-String)
    $hasGuideModel = $ollamaList -match '(?m)^qwen3\.5:4b-q4_K_M\s'
    Add-Check 'Ollama Guide model' $hasGuideModel $(if ($hasGuideModel) { 'qwen3.5:4b-q4_K_M is installed.' } else { 'Expected qwen3.5:4b-q4_K_M was not found.' })
} else {
    Add-Check 'Ollama' $false 'Ollama is not installed or not on PATH.'
}

$whisperPath = $env:LAWSENSE_LOCAL_WHISPER_MODEL
$whisperFilesReady = $false
if ($whisperPath -and (Test-Path -LiteralPath $whisperPath -PathType Container)) {
    $whisperFilesReady = $true
    foreach ($file in @('model.bin', 'config.json', 'tokenizer.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $whisperPath $file) -PathType Leaf)) {
            $whisperFilesReady = $false
        }
    }
}
$python = Resolve-Executable $null 'python'
$whisperPackageReady = $false
if ($python) {
    & $python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('faster_whisper') else 1)" 2>$null
    $whisperPackageReady = ($LASTEXITCODE -eq 0)
}
$whisperReady = $whisperFilesReady -and $whisperPackageReady
$whisperDetail = if ($whisperReady) { 'Model files and faster-whisper package are present at ' + $whisperPath } else { 'Set LAWSENSE_LOCAL_WHISPER_MODEL to an existing local model folder and install api/requirements-voice-local.txt in the API Python environment.' }
Add-Check 'Local Faster-Whisper' $whisperReady $whisperDetail $RequireVoiceModels

$piperExe = Resolve-Executable $env:LAWSENSE_PIPER_EXECUTABLE 'piper'
$piperEnglish = $env:LAWSENSE_PIPER_MODEL_ENGLISH
$piperHindi = $env:LAWSENSE_PIPER_MODEL_HINDI
function Test-PiperModel {
    param([string]$Path)
    return ($Path -and (Test-Path -LiteralPath $Path -PathType Leaf) -and (Test-Path -LiteralPath ($Path + '.json') -PathType Leaf))
}
$piperReady = $piperExe -and (Test-PiperModel $piperEnglish) -and (Test-PiperModel $piperHindi)
$piperDetail = if ($piperReady) { 'Piper executable and Hindi/English ONNX + JSON pairs are present.' } else { 'Configure LAWSENSE_PIPER_EXECUTABLE and LAWSENSE_PIPER_MODEL_ENGLISH / LAWSENSE_PIPER_MODEL_HINDI with matching .onnx.json files.' }
Add-Check 'Local Piper Hindi + English' ([bool]$piperReady) $piperDetail $RequireVoiceModels

$espeak = Resolve-Executable $null 'espeak-ng'
Add-Check 'eSpeak NG fallback' ([bool]$espeak) $(if ($espeak) { $espeak } else { 'Not installed; optional synthetic-voice fallback.' })

$avatarReadyPath = Join-Path $projectRoot 'public/lawsense-human/READY.json'
if (-not (Test-Path -LiteralPath $avatarReadyPath -PathType Leaf) -and $PrepareAvatar) {
    if (-not $npm) { throw 'npm is required to prepare avatar assets.' }
    Push-Location $projectRoot
    try {
        & $npm run setup:avatar
        if ($LASTEXITCODE -ne 0) { throw 'Avatar asset setup failed.' }
    } finally {
        Pop-Location
    }
}
$avatarReady = Test-Path -LiteralPath $avatarReadyPath -PathType Leaf
$avatarDetail = 'Run .\scripts\verify-local-consultation.ps1 -PrepareAvatar to fetch the pinned CC0 assets once.'
if ($avatarReady) {
    $manifest = Get-Content -LiteralPath $avatarReadyPath -Raw | ConvertFrom-Json
    $avatarReady = ($manifest.provider -eq 'humanforge' -and $manifest.sourceCommit -eq '2226df1f50a04c5a8e1c02ea33780d28337dfbb1')
    $avatarDetail = if ($avatarReady) { 'Pinned HumanForge assets ready (' + $manifest.fileCount + ' files; ' + $manifest.totalBytes + ' bytes).' } else { 'READY.json does not match the pinned source; rerun avatar setup.' }
}
Add-Check 'Pinned local 3D avatar assets' $avatarReady $avatarDetail

Write-Host ''
Write-Host 'Readiness checks' -ForegroundColor Cyan
foreach ($check in $checks) {
    $status = if ($check.Passed) { 'PASS' } elseif ($check.Required) { 'REQUIRED' } else { 'OPTIONAL / NOT READY' }
    $color = if ($check.Passed) { 'Green' } elseif ($check.Required) { 'Red' } else { 'Yellow' }
    Write-Host ('[' + $status + '] ' + $check.Name + ': ' + $check.Detail) -ForegroundColor $color
}
$missingRequired = @($checks | Where-Object { $_.Required -and -not $_.Passed })
if ($missingRequired.Count -gt 0) {
    Write-Host 'Required checks failed.' -ForegroundColor Red
    exit 1
}
Write-Host 'Prerequisites checked. This does not replace real microphone, speaker, WebGL, or Android-device testing.' -ForegroundColor Cyan
