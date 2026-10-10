'use client';

const CHANNEL = 'lawsense-native-guide-audio-v1';

export interface NativeGuideVoice {
  name: string;
  locale: string;
  quality: number;
  networkRequired: boolean;
}

export interface NativeGuideAudioCapabilities {
  recognitionAvailable: boolean;
  ttsAvailable: boolean;
  voices: NativeGuideVoice[];
  selectedVoice?: NativeGuideVoice;
}

export interface NativeGuideAudioEvent {
  type: string;
  [key: string]: unknown;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

let nextRequestId = 0;
const pendingRequests = new Map<string, PendingRequest>();
const eventListeners = new Map<string, Set<(event: NativeGuideAudioEvent) => void>>();
let bridgeListenerInstalled = false;

function installBridgeListener(): void {
  if (bridgeListenerInstalled || typeof window === 'undefined') return;
  bridgeListenerInstalled = true;
  window.addEventListener('message', (event: MessageEvent<{
    channel?: string;
    type?: string;
    requestId?: string;
    eventName?: string;
    payload?: unknown;
    error?: string;
  }>) => {
    if (event.source !== window.parent || event.data?.channel !== CHANNEL) return;
    if (event.data.type === 'response' && event.data.requestId) {
      const pending = pendingRequests.get(event.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingRequests.delete(event.data.requestId);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.payload);
      return;
    }
    if (event.data.type === 'event' && event.data.eventName) {
      const payload = event.data.payload;
      const normalized = payload && typeof payload === 'object' ? payload as NativeGuideAudioEvent : { type: event.data.eventName };
      for (const listener of eventListeners.get(event.data.eventName) ?? []) listener(normalized);
    }
  });
}

export function requestNativeGuideAudio<T>(
  method: string,
  args: Record<string, unknown> = {},
  timeoutMs = method === 'startListening' ? 120_000 : 10_000,
): Promise<T> {
  if (typeof window === 'undefined' || window.parent === window) {
    return Promise.reject(new Error('Native Guide audio is only available in the LawSense Android app.'));
  }
  installBridgeListener();
  const requestId = `native-audio-${Date.now()}-${++nextRequestId}`;
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('The Android audio bridge did not respond.'));
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timeout });
    window.parent.postMessage({ channel: CHANNEL, type: 'request', requestId, method, args }, '*');
  });
}

export function subscribeNativeGuideAudio(
  eventName: string,
  listener: (event: NativeGuideAudioEvent) => void,
): () => void {
  installBridgeListener();
  const listeners = eventListeners.get(eventName) ?? new Set();
  listeners.add(listener);
  eventListeners.set(eventName, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) eventListeners.delete(eventName);
  };
}
