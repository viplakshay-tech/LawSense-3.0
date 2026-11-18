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

## Current limitation

The Piper adapter is a local backend capability. The consultation UI and the browser's speech APIs must still be configured and tested so that browser-managed speech is never selected silently. Actual voice naturalness, pronunciation, latency and memory use must be benchmarked on the target Windows laptop and Android device before Milestone 9 is signed off.
