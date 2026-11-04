'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGuideModelStatus, type GuideModelStatus } from '@/lib/api';

function statusLabel(status: GuideModelStatus['status'] | null): string {
  switch (status) {
    case 'available': return 'Installed and reachable';
    case 'model_missing': return 'Model not installed';
    case 'misconfigured': return 'Local address misconfigured';
    case 'unavailable': return 'Ollama unavailable';
    default: return 'Checking local model';
  }
}

export function GuideModelStatusBanner() {
  const [status, setStatus] = useState<GuideModelStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const next = await getGuideModelStatus(controller.signal);
      if (controller.signal.aborted) return;
      setStatus(next);
      setError(null);
    } catch {
      if (controller.signal.aborted) return;
      setStatus(null);
      setError('Could not check the local model. Guide chat does not fall back to a cloud model.');
    } finally {
      if (!controller.signal.aborted && requestControllerRef.current === controller) {
        setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    void check();
    return () => requestControllerRef.current?.abort();
  }, [check]);

  const label = checking ? 'Checking local model' : error ? 'Status unavailable' : statusLabel(status?.status ?? null);
  const tone = error || status?.status === 'misconfigured'
    ? 'border-rose-200/15 bg-rose-200/[0.04] text-rose-100'
    : status?.status === 'model_missing'
      ? 'border-amber-200/15 bg-amber-200/[0.04] text-amber-100'
      : status?.status === 'available'
        ? 'border-emerald-200/15 bg-emerald-200/[0.035] text-emerald-100'
        : 'border-white/[0.08] bg-white/[0.025] text-slate-300';

  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-2.5 py-2 ${tone}`} role="status" aria-live="polite">
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] opacity-75">Local Guide model</p>
        <p className="mt-0.5 text-[10px] font-semibold">{label}{status?.model ? ` · ${status.model}` : ''}</p>
        <p className="mt-1 break-words text-[10px] leading-4 opacity-80">
          {error ?? status?.message ?? 'Checking the private Ollama service…'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setChecking(true);
          setError(null);
          void check();
        }}
        disabled={checking}
        className="min-h-8 shrink-0 rounded-md border border-current/20 px-2 text-[9px] font-semibold opacity-80 hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
        aria-label="Check local Guide model status again"
      >
        {checking ? 'Checking' : 'Check again'}
      </button>
    </div>
  );
}
