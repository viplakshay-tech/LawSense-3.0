# Optional local Guide model (Windows)

LawSense Guide can use a local Ollama model for plain-language conversation. This is optional: the rest of the case workspace does not require Ollama.

The local model is **not** the legal-reasoning engine. It may help the user explain a situation, understand the saved case summary, and identify missing details. It must not decide whether a law applies, invent legal sources, predict an outcome, or replace the source-governed Legal Advisory.

## 1. Install and start Ollama

1. Install Ollama for Windows from its official website.
2. Open a normal Windows CMD or PowerShell window.
3. Check that the CLI is available:

   ```cmd
   ollama --version
   ```

4. Download the model configured by LawSense by default:

   ```cmd
   ollama pull qwen3.5:4b-q4_K_M
   ```

5. Confirm that it appears in the local model list:

   ```cmd
   ollama list
   ```

On Windows, Ollama may already be running in the background after installation. If it is not, start it using the normal Ollama application or `ollama serve`.

## 2. Keep the model endpoint local

LawSense defaults to:

- Base URL: `http://127.0.0.1:11434`
- Chat endpoint: `http://127.0.0.1:11434/api/chat`
- Model: `qwen3.5:4b-q4_K_M`

The backend deliberately accepts only a loopback Ollama host. Do not change it to `0.0.0.0`, a public IP, or a third-party hosted endpoint.

If you installed a different Ollama model, use its exact name from `ollama list` and set it in the same CMD window used to start the backend:

```cmd
set "OLLAMA_MODEL=your-installed-model-name"
set "OLLAMA_BASE_URL=http://127.0.0.1:11434"
```

These variables are read by the backend process. Restart the backend after changing them.

## 3. Start LawSense

Follow the repository's [local development quick start](../README.md#quick-start-local-development). Start Ollama first, then the FastAPI backend and Next.js frontend.

A quick model-only check is:

```cmd
ollama run qwen3.5:4b-q4_K_M "Reply with the word OK."
```

If you use a different model, substitute the installed model name.

## 4. Local model status check

The backend exposes `GET /guide/status`. It checks the loopback Ollama `/api/tags` endpoint with a short timeout and reports whether the configured model is installed.

- It does not send a prompt or load the model.
- It does not contact a cloud provider.
- `available` means the Ollama API responds and the configured model is installed; the first chat response may still take longer while the model loads.
- `model_missing` includes the exact `ollama pull` command for the configured model.

## 4. What happens when the model is unavailable

- The Guide reports that the local assistant is unavailable.
- It does not silently fall back to a cloud model.
- The user can continue with the normal case workspace, typed case actions, and source-backed Legal Advisory.
- A model response is conversational assistance only. It is not a verified legal source or a legal conclusion.
- Caller-supplied excerpts and conversation history remain untrusted context; the backend does not authenticate them.

## 6. Android limitation

The current Capacitor APK is a **connection shell**, not a standalone on-device AI app. It does not bundle Ollama or the model weights, and it still depends on a reachable LawSense frontend/API. A successful debug APK build does not prove cable-free offline operation.

Standalone Android work requires a separately tested on-device inference runtime, model packaging, app-private data storage, document dependencies, and real-device offline/restart tests. Do not expose the laptop's Ollama port to the phone or local network as a workaround.
