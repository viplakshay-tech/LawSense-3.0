# Local Guide voice setup (Windows)

LawSense uses separate local components for conversation and microphone transcription:

- **Guide replies:** Ollama with `qwen3.5:4b-q4_K_M` (already installed on the demo PC).
- **Microphone transcription:** optional Faster-Whisper. This is not an Ollama model.
- **Case extraction:** LawSense's existing deterministic case-intake pipeline.
- **Review:** the transcript remains a draft until the user explicitly confirms it.

The browser's built-in speech recognition can depend on browser speech services. For a local-first demo, configure Faster-Whisper so LawSense prefers the local API transcription provider.

## 1. Install the optional Python dependency

Open CMD:

```cmd
cd /d C:\LawSense\LawSense-3.0\api
.venv\Scripts\python.exe -m pip install -r requirements-voice.txt
```

## 2. Download the multilingual Whisper model once

The recommended starting point is the multilingual `Systran/faster-whisper-small` model. It supports English and Hindi. Download it to a local folder:

```cmd
.venv\Scripts\python.exe -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Systran/faster-whisper-small', local_dir=r'C:\LawSense\models\faster-whisper-small')"
```

This downloads model files from Hugging Face. Afterward, transcription runs from that local folder; the app adapter uses `local_files_only=True` and does not fetch models during a recording.

## 3. Configure the backend

In the same CMD window used to start the API, set:

```cmd
set "LAWSENSE_LOCAL_WHISPER_MODEL=C:\LawSense\models\faster-whisper-small"
set "LAWSENSE_LOCAL_WHISPER_DEVICE=cpu"
set "LAWSENSE_LOCAL_WHISPER_COMPUTE_TYPE=int8"
```

Then start/restart the backend:

```cmd
set "PYTHONPATH=C:\LawSense\LawSense-3.0\api"
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The first transcription loads the model and can take longer than later turns. CPU/int8 is the conservative Windows setup; GPU acceleration can be evaluated separately after the local CPU path is verified.

## 4. Verify the provider

Open the LawSense voice workspace while signed in. Its voice-provider status should report speech-to-text as available and processing location as local. The frontend calls the authenticated same-origin API route; do not test the backend route in a separate unauthenticated browser tab.

If the UI still reports unavailable, check that the configured folder contains `model.bin`, `config.json`, and `tokenizer.json`, and that the API was restarted after setting the environment variables.

## 5. Test the Guide

1. Open a case and enter the voice workspace.
2. Allow microphone access when the browser asks.
3. Choose English or Hindi and start recording.
4. Speak one short sentence, then stop recording.
5. Review the transcript and extracted details.
6. Confirm only after correcting any recognition mistakes.

A confirmed transcript is added to the case; an unconfirmed draft is not. The local Whisper model transcribes audio; Ollama generates the Guide's text reply. Neither model makes a legal decision.

## Resource note

Do not install another chat model just to make microphone capture work. The existing Qwen model handles Guide replies. The optional Whisper model handles speech-to-text. Additional Ollama models should be added only when a real application feature is wired to use them.
