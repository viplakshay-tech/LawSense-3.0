# Local voice setup for LawSense 3.0

LawSense can synthesize speech without sending consultation text to a hosted speech API. The API selects a configured local Piper voice when both English and Hindi models are present; otherwise it uses the existing local eSpeak NG adapter when that executable is installed.

## Piper (preferred for more natural speech)

Piper, its voice models, and the model configuration files must already be installed on the machine running the LawSense API. LawSense does not download models automatically.

Each configured voice requires both files:

- The Piper `.onnx` model.
- Its matching `.onnx.json` configuration file in the same directory.

Use voice models whose licence permits your intended use. Do not commit model binaries or voice data to the application repository unless their licence explicitly permits redistribution.

### Windows PowerShell example

Set these values in the terminal before starting the FastAPI service. Replace the example paths with the actual local paths on the API host.

```powershell
$env:LAWSENSE_PIPER_EXECUTABLE = "C:\LawSense\voice\piper.exe"
$env:LAWSENSE_PIPER_MODEL_ENGLISH = "C:\LawSense\voice\en_IN-voice-name-medium.onnx"
$env:LAWSENSE_PIPER_MODEL_HINDI = "C:\LawSense\voice\hi_IN-voice-name-medium.onnx"
# Optional dedicated Hinglish voice. If omitted, the configured Hindi voice is used.
$env:LAWSENSE_PIPER_MODEL_HINGLISH = "C:\LawSense\voice\hinglish-voice.onnx"
```

The model paths above are examples, not bundled or endorsed voice downloads. Keep each matching `.onnx.json` file beside its model.

Restart the API after setting the variables. The voice capability endpoint should report the selected provider as local. If English and Hindi models are not both available, the service does not select Piper as its primary provider.

## eSpeak NG fallback

If the required Piper voice models are not installed, LawSense checks for the local `espeak-ng` executable. eSpeak NG is a functional offline fallback, but its voice quality is more synthetic and should not be treated as the final natural-avatar voice.

## Privacy and behavior

- Speech synthesis runs in a local process on the API host.
- The adapter writes generated audio to a temporary directory and removes it after reading the output.
- Text is passed to the local process through standard input, not a command-line argument.
- No voice model is downloaded by LawSense.
- No hosted TTS provider is contacted by this backend adapter.
- Hinglish uses a dedicated configured model when available; otherwise it uses the Hindi model.
- If no local TTS provider is available, speech output reports unavailable. The consultation transcript remains readable.

## Interruption and privacy behavior

- Starting a new voice capture interrupts any active spoken reply as soon as capture is requested.
- Sending a typed follow-up also interrupts active speech; the previous response remains readable and is marked as stopped.
- The Stop speaking control remains available while speech is pending or playing.
- Audio is temporary by default. A transcript is editable and must be explicitly reviewed and confirmed before it is added to the case.
- Browser recognition and browser speech synthesis are separate opt-ins. They may use browser-managed services and are never selected silently.
- The shared Guide action registry does not offer a direct browser-speech action that bypasses the local-first playback controls.

## Remaining validation

The local provider wiring and browser-consent behavior are covered by automated tests, but the following are still required before Milestones 8–11 can be signed off: install and exercise real multilingual Faster-Whisper and Piper models on the target Windows laptop; benchmark Hindi, English and Hinglish pronunciation, latency and memory; verify Android on-device recognition/output and local-network behavior on a physical phone; and validate viseme timing against actual audio. eSpeak NG remains a functional but synthetic local fallback, not the final natural-avatar voice.


## Windows preflight and model verification

From the LawSense repository root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\verify-local-consultation.ps1 -PrepareAvatar
```

The verifier checks the Node/npm toolchain, the configured Ollama Guide model, the on-disk Faster-Whisper model and Python package, Piper executable plus Hindi/English ONNX/config pairs, eSpeak NG fallback, and the pinned HumanForge asset manifest. `-PrepareAvatar` runs the one-time pinned CC0 avatar asset setup only when the local READY manifest is missing.

To make missing speech models a hard failure during a readiness run, use:

```powershell
.\scripts\verify-local-consultation.ps1 -RequireVoiceModels
```

Configure the API process with `LAWSENSE_LOCAL_WHISPER_MODEL`, `LAWSENSE_LOCAL_WHISPER_DEVICE` (default `cpu`), and `LAWSENSE_LOCAL_WHISPER_COMPUTE_TYPE` (default `int8`). The Faster-Whisper model directory must already contain `model.bin`, `config.json`, and `tokenizer.json`. Install the optional package into the same Python environment that starts FastAPI:

```powershell
python -m pip install -r api/requirements-voice-local.txt
```

The script performs a readiness check; it does not download speech models, transmit audio, or certify pronunciation quality. After it passes, start the local API and test English, Hindi and Hinglish with actual microphone recordings. Record first-audio latency, transcription latency, CPU/RAM use, and any pronunciation/transcription errors. Keep the models on disk and do not commit model binaries to Git.
