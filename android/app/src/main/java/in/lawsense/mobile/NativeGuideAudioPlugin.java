package in.lawsense.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(name = "NativeGuideAudio", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class NativeGuideAudioPlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private TextToSpeech textToSpeech;
    private boolean ttsReady = false;
    private String utteranceId;
    private final HashMap<String, String> responseByUtterance = new HashMap<>();
    private final List<PluginCall> pendingCapabilityCalls = new ArrayList<>();
    private PluginCall pendingPermissionCall;

    @Override
    public void load() {
        textToSpeech = new TextToSpeech(getContext(), status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { notifyAudio("speechStarted", speechEvent(id)); }
                    @Override public void onDone(String id) { notifyAudio("speechFinished", speechEvent(id)); responseByUtterance.remove(id); }
                    @Override public void onError(String id) { notifyAudio("speechError", speechEvent(id, "detail", "Android text-to-speech could not play this response.")); responseByUtterance.remove(id); }
                    @Override public void onError(String id, int errorCode) { onError(id); }
                    @Override public void onStop(String id, boolean interrupted) { notifyAudio("speechStopped", speechEvent(id)); responseByUtterance.remove(id); }
                });
            }
            resolvePendingCapabilityCalls();
        });
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (textToSpeech != null && !ttsReady) {
                call.setKeepAlive(true);
                pendingCapabilityCalls.add(call);
            } else {
                resolveCapabilities(call);
            }
        });
    }

    private void resolvePendingCapabilityCalls() {
        List<PluginCall> waiting = new ArrayList<>(pendingCapabilityCalls);
        pendingCapabilityCalls.clear();
        for (PluginCall call : waiting) resolveCapabilities(call);
    }

    private void resolveCapabilities(PluginCall call) {
        boolean recognitionAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
        JSArray voices = new JSArray();
        Voice selectedVoice = chooseLocalVoice(call.getString("language", "en-IN"));
        Set<Voice> installed = ttsReady && textToSpeech != null ? textToSpeech.getVoices() : null;
        if (installed != null) {
            for (Voice voice : installed) {
                try {
                    JSObject item = new JSObject();
                    item.put("name", voice.getName());
                    item.put("locale", voice.getLocale().toLanguageTag());
                    item.put("quality", voice.getQuality());
                    item.put("networkRequired", voice.isNetworkConnectionRequired());
                    voices.put(item);
                } catch (Exception ignored) { }
            }
        }
        JSObject result = new JSObject();
        try {
            call.setKeepAlive(false);
            result.put("recognitionAvailable", recognitionAvailable);
            result.put("ttsAvailable", selectedVoice != null);
            result.put("voices", voices);
            if (selectedVoice != null) result.put("selectedVoice", voiceObject(selectedVoice));
        } catch (Exception ignored) { }
        call.resolve(result);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        getActivity().runOnUiThread(() -> startListeningOnMain(call));
    }

    private void startListeningOnMain(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
            call.reject("On-device speech recognition is unavailable. Text input remains available.", "SPEECH_UNAVAILABLE");
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startRecognizer(call);
        } else {
            pendingPermissionCall = call;
            requestPermissionForAlias("microphone", call, "microphonePermissionResult");
        }
    }

    @PermissionCallback
    private void microphonePermissionResult(PluginCall call) {
        getActivity().runOnUiThread(() -> resumeAfterPermission(call));
    }

    private void resumeAfterPermission(PluginCall call) {
        if (pendingPermissionCall != call) return;
        pendingPermissionCall = null;
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Microphone permission was denied. You can continue by typing.", "PERMISSION_DENIED");
            return;
        }
        startRecognizer(call);
    }

    private void startRecognizer(PluginCall call) {
        try {
            destroyRecognizer();
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { notifyAudio("recognitionStarted", event("language", call.getString("language", "en-IN"))); }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float rmsdB) { }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() { }
                @Override public void onError(int error) {
                    notifyAudio("recognitionError", event("code", errorName(error), "detail", recognitionError(error)));
                    notifyAudio("recognitionStopped", event("reason", "error"));
                    destroyRecognizer();
                }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String transcript = matches == null || matches.isEmpty() ? "" : matches.get(0).trim();
                    if (!transcript.isEmpty()) notifyAudio("transcript", event("transcript", transcript));
                    else notifyAudio("recognitionError", event("code", "no_match", "detail", "No speech was recognized. Nothing was sent to the Guide."));
                    notifyAudio("recognitionStopped", event("reason", "results"));
                    destroyRecognizer();
                }
                @Override public void onPartialResults(Bundle partialResults) {
                    ArrayList<String> matches = partialResults == null ? null : partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) notifyAudio("partialTranscript", event("transcript", matches.get(0)));
                }
                @Override public void onEvent(int eventType, Bundle params) { }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            String language = call.getString("language", "en-IN");
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            recognizer.startListening(intent);
            call.resolve();
        } catch (Exception error) {
            destroyRecognizer();
            call.reject("On-device speech recognition could not start: " + error.getMessage(), "SPEECH_START_FAILED");
        }
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> stopListeningOnMain(call));
    }

    private void stopListeningOnMain(PluginCall call) {
        PluginCall permissionCall = pendingPermissionCall;
        pendingPermissionCall = null;
        if (permissionCall != null) permissionCall.reject("Microphone request cancelled because the call ended or was muted.", "CANCELLED");
        destroyRecognizer();
        notifyAudio("recognitionStopped", event("reason", "muted"));
        call.resolve();
    }

    @PluginMethod
    public void speak(PluginCall call) {
        getActivity().runOnUiThread(() -> speakOnMain(call));
    }

    private void speakOnMain(PluginCall call) {
        String text = call.getString("text", "").trim();
        String language = call.getString("language", "en-IN");
        Voice voice = chooseLocalVoice(language);
        if (text.isEmpty()) { call.reject("There is no Guide response to speak."); return; }
        if (!ttsReady || textToSpeech == null || voice == null) {
            call.reject("No installed offline text-to-speech voice is available. The response remains readable.", "TTS_UNAVAILABLE");
            return;
        }
        try {
            textToSpeech.setVoice(voice);
            utteranceId = UUID.randomUUID().toString();
            responseByUtterance.put(utteranceId, call.getString("responseId", ""));
            Bundle parameters = new Bundle();
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, parameters, utteranceId);
            call.resolve(event("utteranceId", utteranceId, "voice", voiceObject(voice)));
        } catch (Exception error) {
            call.reject("Android text-to-speech failed: " + error.getMessage(), "TTS_FAILED");
        }
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (textToSpeech != null) textToSpeech.stop();
            call.resolve();
        });
    }

    private Voice chooseLocalVoice(String requestedLanguage) {
        if (!ttsReady || textToSpeech == null || textToSpeech.getVoices() == null) return null;
        String language = requestedLanguage == null ? "en" : requestedLanguage.toLowerCase(Locale.ROOT).split("-")[0];
        List<Voice> localVoices = new ArrayList<>();
        for (Voice voice : textToSpeech.getVoices()) if (!voice.isNetworkConnectionRequired()) localVoices.add(voice);
        localVoices.sort(Comparator
            .comparingInt((Voice voice) -> voice.getLocale().getLanguage().equals(language) ? 0 : 1)
            .thenComparingInt(voice -> voice.getName().matches("(?i).*\\b(female|feminine|woman)\\b.*") ? 0 : 1)
            .thenComparing((Voice voice) -> -voice.getQuality()));
        return localVoices.isEmpty() ? null : localVoices.get(0);
    }

    private JSObject voiceObject(Voice voice) {
        JSObject result = new JSObject();
        try {
            result.put("name", voice.getName());
            result.put("locale", voice.getLocale().toLanguageTag());
            result.put("quality", voice.getQuality());
            result.put("networkRequired", voice.isNetworkConnectionRequired());
        } catch (Exception ignored) { }
        return result;
    }

    private JSObject speechEvent(String id, Object... extra) {
        JSObject result = event("utteranceId", id, "responseId", responseByUtterance.get(id));
        try { for (int index = 0; index + 1 < extra.length; index += 2) result.put((String) extra[index], extra[index + 1]); }
        catch (Exception ignored) { }
        return result;
    }

    private JSObject event(Object... values) {
        JSObject result = new JSObject();
        try { for (int index = 0; index + 1 < values.length; index += 2) result.put((String) values[index], values[index + 1]); }
        catch (Exception ignored) { }
        return result;
    }

    private void notifyAudio(String eventName, JSObject payload) { notifyListeners(eventName, payload); }

    private String errorName(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "audio";
            case SpeechRecognizer.ERROR_CLIENT: return "client";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "permission";
            case SpeechRecognizer.ERROR_NETWORK: return "network";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network_timeout";
            case SpeechRecognizer.ERROR_NO_MATCH: return "no_match";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";
            case SpeechRecognizer.ERROR_SERVER: return "server";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "speech_timeout";
            default: return "unknown";
        }
    }

    private String recognitionError(int error) {
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) return "Microphone permission is required. You can continue by typing.";
        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) return "No speech was recognized. Nothing was sent to the Guide.";
        return "On-device speech recognition stopped. You can retry or continue by typing.";
    }

    private void destroyRecognizer() {
        if (recognizer == null) return;
        try { recognizer.cancel(); } catch (Exception ignored) { }
        try { recognizer.destroy(); } catch (Exception ignored) { }
        recognizer = null;
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizer();
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        super.handleOnDestroy();
    }
}
