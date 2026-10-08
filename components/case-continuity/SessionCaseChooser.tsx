'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Clock3, FileText, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { getCase, type CaseState } from '@/lib/api';
import { clearSessionCases, getSessionCaseIds } from '@/lib/case-continuity';

type SessionCase =
  | { id: string; state: 'ready'; data: CaseState }
  | { id: string; state: 'unavailable' };

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return 'Update time not supplied';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Update time not supplied';
  return `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
}

export function SessionCaseChooser({
  activeCaseId = null,
  activeCaseData = null,
}: {
  activeCaseId?: string | null;
  activeCaseData?: CaseState | null;
}) {
  const [cases, setCases] = useState<SessionCase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedForActiveCaseId, setLoadedForActiveCaseId] = useState(activeCaseId);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const ids = getSessionCaseIds();

    void Promise.all(ids.map(async (id): Promise<SessionCase> => {
      if (id === activeCaseData?.id) return { id, state: 'ready', data: activeCaseData };
      try {
        const data = await getCase(id);
        return { id, state: 'ready', data };
      } catch {
        return { id, state: 'unavailable' };
      }
    })).then((results) => {
      if (active) {
        setCases(results);
        setLoadedForActiveCaseId(activeCaseId);
        setIsLoading(false);
      }
    });

    return () => { active = false; };
  }, [activeCaseData, activeCaseId, refreshKey]);

  function clearList() {
    clearSessionCases();
    setCases([]);
    setIsLoading(false);
    setRefreshKey((value) => value + 1);
  }

  const showLoading = isLoading || activeCaseId !== loadedForActiveCaseId;
  const compactEmptyChooser = !showLoading && cases.length === 0;

  return (
    <section aria-labelledby="session-cases-heading" className={`overflow-hidden border border-[#d8d9d1] bg-[#f6f5f0] ${compactEmptyChooser ? 'mb-3 rounded-xl shadow-none' : 'mb-6 rounded-2xl shadow-[0_16px_44px_rgba(13,18,15,0.08)]'}`}>
      <div className={`flex flex-wrap items-start justify-between gap-4 border-b border-[#deded6] px-5 py-4 sm:px-6 ${compactEmptyChooser ? 'border-b-0 px-4 py-2.5 sm:px-4' : ''}`}>
        <div>
          <p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#788078]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6f978a]" /> This browser session
          </p>
          <h2 id="session-cases-heading" className={`mt-1.5 font-semibold tracking-tight text-[#222823] ${compactEmptyChooser ? 'text-sm' : 'text-lg'}`}>Your cases this session</h2>
          <p className={`mt-1 max-w-2xl text-xs leading-5 text-[#737a73] ${compactEmptyChooser ? 'hidden' : ''}`}>
            Reopen a case you have visited here. Case details are loaded from LawSense; only case IDs are kept in this session list.
          </p>
        </div>
        {cases.length > 0 && !showLoading && (
          <div className="flex items-center gap-3">
          <button type="button" onClick={() => { setIsLoading(true); setRefreshKey((value) => value + 1); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold text-[#667068] transition hover:bg-black/[0.04] hover:text-[#252c27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#758d7e]">
              <RotateCw aria-hidden="true" className="h-3 w-3" /> Refresh
            </button>
            <button type="button" onClick={clearList} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold text-[#7c7770] transition hover:bg-black/[0.04] hover:text-[#423f3a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9b8f7a]">
              <Trash2 aria-hidden="true" className="h-3 w-3" /> Clear list
            </button>
          </div>
        )}
      </div>

      <div className={compactEmptyChooser ? 'px-4 pb-3' : 'p-4 sm:p-5'}>
        {showLoading ? (
          <div role="status" className="flex min-h-20 items-center gap-3 rounded-xl border border-[#e1e2dc] bg-white/70 px-4 text-xs text-[#69726b]">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-[#6f978a]" /> Reopening cases from this session…
          </div>
        ) : cases.length === 0 ? (
          <div className={`flex items-center gap-3 rounded-xl border border-dashed border-[#d9dbd3] bg-white/45 px-4 ${compactEmptyChooser ? 'min-h-11 py-2' : 'min-h-20 py-4'}`}>
            <span className={`flex shrink-0 items-center justify-center rounded-xl border border-[#e1e2dc] bg-white text-[#768078] ${compactEmptyChooser ? 'h-7 w-7' : 'h-9 w-9'}`}><FileText aria-hidden="true" className="h-4 w-4" /></span>
            <div>
              <p className="text-xs font-semibold text-[#384039]">{compactEmptyChooser ? 'No cases in this session yet' : 'No cases opened in this session yet'}</p>
              {!compactEmptyChooser && <p className="mt-1 text-[11px] leading-5 text-[#7d837c]">Cases you visit will appear here so you can return to the active task.</p>}
            </div>
          </div>
        ) : (
          <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {cases.map((item) => (
              <li key={item.id}>
                {item.state === 'ready' ? (
                  <Link href={`/case/${encodeURIComponent(item.id)}`} className="group flex h-full min-h-28 flex-col rounded-xl border border-[#dedfd8] bg-white/75 p-4 transition hover:-translate-y-0.5 hover:border-[#aab9aa] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#758d7e] motion-reduce:transform-none motion-reduce:transition-none">
                    <span className="flex items-start justify-between gap-3">
                      <span className="line-clamp-2 text-sm font-semibold text-[#28312a]">{item.data.title?.trim() || 'Untitled case'}{item.id === activeCaseId && <span className="ml-2 inline-flex rounded-full bg-[#e7efe9] px-2 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide text-[#3e6754]">Current</span>}</span>
                      <ArrowRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#859087] transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-[10px] text-[#778078]">
                      <span>{item.data.documents.length} document{item.data.documents.length === 1 ? '' : 's'}</span>
                      <span>{new Set([
                        ...item.data.unknowns,
                        ...(item.data.analysis?.journey?.unknowns ?? []).map((question) => question.question),
                      ].filter(Boolean)).size} open questions</span>
                      <span className="inline-flex items-center gap-1"><Clock3 aria-hidden="true" className="h-3 w-3" />{formatUpdatedAt(item.data.metadata.updatedAt)}</span>
                    </span>
                  </Link>
                ) : (
                  <div className="flex h-full min-h-28 flex-col rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                    <p className="text-sm font-semibold text-[#4d4638]">Case could not be refreshed</p>
                    <p className="mt-1 text-[11px] leading-5 text-[#7c715e]">Its ID is still in this session list. Retry the case service or open the case to try again.</p>
                    <Link href={`/case/${encodeURIComponent(item.id)}`} className="mt-auto inline-flex min-h-8 items-center gap-1.5 self-start pt-3 text-[10px] font-semibold text-[#61543e] hover:text-[#362d20] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#958364]">
                      Open case <ArrowRight aria-hidden="true" className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
