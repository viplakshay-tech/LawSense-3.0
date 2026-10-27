'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, ArrowLeft, ChevronDown, ChevronUp, CircleHelp, Mic2, Radio, ShieldAlert, Volume2, VolumeX } from 'lucide-react';
import { guidePresenceStateFromSnapshot, useGuideRuntime } from '@/components/guide-runtime';
import type { GuideAction } from '@/components/guide-runtime/types';
import { GuidePresence } from './GuidePresence';
import { GUIDE_PRESENCE_LABELS } from './types';
import { buildGuideCaseContext, sendGuideMessage, type GuideChatLanguage } from '@/lib/api';

function actionLabel(action: GuideAction): string {
  switch (action.type) {
    case 'ASK_CLARIFICATION': return 'Open clarification';
    case 'SHOW_EVIDENCE': return 'Open Evidence Map';
    case 'SHOW_LEGAL_GROUNDING': return 'Legal grounding';
    case 'OPEN_JOURNEY': return 'Open journey';
    case 'SHOW_TWIN': return 'Open Living Twin';
    case 'OPEN_SAFETY': return 'Review safety';
    case 'START_VOICE': return 'Open voice capture';
    case 'SPEAK_RESPONSE': return 'Speak status';
    case 'NAVIGATE': return action.payload.target === 'case'
      ? 'Case overview'
      : `Open ${action.payload.target}`;
    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

export function GuideControlSurface() {
  const pathname = usePathname();
  const router = useRouter();
  const { snapshot, presentation: model, contextualMessage, messages, actionRunning, runAction, interruptSpeech, dismissError } = useGuideRuntime();
  const [expanded, setExpanded] = useState(false);
  const [chatLanguage, setChatLanguage] = useState<GuideChatLanguage>('hinglish');
  const [chatText, setChatText] = useState('');
  const [chatTurns, setChatTurns] = useState<Array<{ id: string; role: 'you' | 'guide'; text: string }>>([]);
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatSequenceRef = useRef(0);
  const chatRequestRef = useRef(0);
  const expandedRef = useRef(expanded);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const previousPathnameRef = useRef(pathname);
  const caseId = snapshot.caseState?.id ?? null;

  useEffect(() => {
    chatRequestRef.current += 1;
    setChatTurns([]);
    setChatText('');
    setChatError(null);
    setChatPending(false);
  }, [caseId]);

  useEffect(() => () => {
    chatRequestRef.current += 1;
  }, []);

  async function submitGuideChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const statement = chatText.trim();
    const currentCase = snapshot.caseState;
    if (!statement || !currentCase || chatPending) return;

    const requestId = ++chatRequestRef.current;
    const turnId = () => `guide-chat-${++chatSequenceRef.current}`;
    setChatTurns((current) => [...current.slice(-9), { id: turnId(), role: 'you', text: statement }]);
    setChatText('');
    setChatError(null);
    setChatPending(true);
    try {
      const response = await sendGuideMessage(statement, chatLanguage, buildGuideCaseContext(currentCase));
      if (requestId !== chatRequestRef.current || currentCase.id !== caseId) return;
      const answer = response.status === 'unavailable'
        ? `Local assistant unavailable · ${response.reply}`
        : response.reply;
      setChatTurns((current) => [...current.slice(-9), { id: turnId(), role: 'guide', text: answer }]);
    } catch {
      if (requestId !== chatRequestRef.current || currentCase.id !== caseId) return;
      setChatError('The configured local assistant could not be reached. Your message was not added to the saved case. Try again or open the voice/review workspace.');
    } finally {
      if (requestId === chatRequestRef.current) setChatPending(false);
    }
  }

  function updateExpanded(next: boolean) {
    expandedRef.current = next;
    setExpanded(next);
  }

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    const restoreFocus = expandedRef.current;
    expandedRef.current = false;
    setExpanded(false);
    if (!restoreFocus) return;
    const frame = window.requestAnimationFrame(() => {
      if (toggleRef.current) {
        toggleRef.current.focus({ preventScroll: true });
        return;
      }
      const heading = document.querySelector<HTMLElement>('main h1, main h2');
      if (!heading) return;
      if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);
  const primaryAction = model.nextAction
    ? snapshot.availableActions.find((action) => action.type === model.nextAction?.actionType)
    : undefined;
  const otherActions = snapshot.availableActions.filter((action) => action !== primaryAction);
  const presenceState = guidePresenceStateFromSnapshot(snapshot);
  const stateText = GUIDE_PRESENCE_LABELS[presenceState];
  const voiceMode = pathname.split('/').filter(Boolean).at(-1) === 'voice';
  const safetyMode = pathname.split('/').filter(Boolean).at(-1) === 'safety';

  function handleSurfaceKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault();
    updateExpanded(false);
    window.requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true }));
  }

  if (safetyMode) {
    const caseId = snapshot.caseState?.id;
    return (
      <aside
        aria-label="LawSense Guide control surface"
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-[60] w-[min(25rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.35rem] border border-[#9daec3]/20 bg-[#0b1119]/[0.97] text-slate-100 shadow-[0_28px_90px_rgba(4,9,16,0.42)] ring-1 ring-white/[0.035] backdrop-blur-2xl sm:right-5 lg:bottom-5"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.075] p-3.5">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">LawSense · Guide</p>
            <p className="mt-1 text-xs font-semibold text-slate-100">Safety mode</p>
          </div>
          <span className="rounded-full border border-teal-100/20 bg-teal-100/[0.06] px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-teal-50">{presenceState}</span>
        </div>
        <div className="space-y-3 p-3.5">
          <p className="text-xs leading-5 text-slate-300">Use the safety options on this page at your pace. The Guide does not contact anyone on your behalf.</p>
          <button
            type="button"
            disabled={!caseId}
            onClick={() => {
              if (caseId) router.push(`/case/${encodeURIComponent(caseId)}`);
            }}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-[10px] font-semibold text-slate-200 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Return to case
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="LawSense Guide control surface"
      onKeyDown={handleSurfaceKeyDown}
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-[60] w-[min(25rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.35rem] border border-[#9daec3]/20 bg-[#0b1119]/[0.97] text-slate-100 shadow-[0_28px_90px_rgba(4,9,16,0.42)] ring-1 ring-white/[0.035] backdrop-blur-2xl sm:right-5 lg:bottom-5"
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" aria-relevant="text">
        Guide status: {stateText}. {snapshot.state.reason.replaceAll('_', ' ')}.
        {actionRunning ? ' A Guide action is running.' : messages.at(-1) ? ` ${messages.at(-1)?.text}` : ''}
      </p>
      <div className="relative border-b border-white/[0.075] bg-[radial-gradient(ellipse_at_78%_0%,rgba(185,155,105,0.16),transparent_44%),linear-gradient(125deg,rgba(29,42,56,0.62),rgba(11,17,25,0.2)_64%)] p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-[#e9bd7b]/20 bg-[#e9bd7b]/[0.08] text-[#f0cf98]">
              <Activity aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">LawSense · Guide</p>
              <p className="truncate text-xs font-semibold text-slate-100">Case control surface</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {snapshot.speechState === 'speaking' && !voiceMode && (
              <button
                type="button"
                onClick={interruptSpeech}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#e9bd7b]/25 bg-[#e9bd7b]/[0.08] px-2.5 text-[10px] font-semibold text-[#f2d7aa] hover:bg-[#e9bd7b]/[0.14] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none"
                aria-label="Stop Guide speech"
              >
                <VolumeX aria-hidden="true" className="h-3.5 w-3.5" />
                Stop
              </button>
            )}
            <span className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${presenceState === 'SAFETY' || presenceState === 'IMMEDIATE_DANGER' || presenceState === 'CONFLICT' ? 'border-amber-200/20 bg-amber-200/[0.07] text-amber-100' : 'border-white/[0.09] bg-white/[0.035] text-slate-200'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${presenceState === 'THINKING' || presenceState === 'LISTENING' || snapshot.speechState === 'speaking' ? 'animate-pulse bg-[#e9bd7b]' : presenceState === 'ACTION_REQUIRED' ? 'bg-rose-300' : 'bg-emerald-300'}`} />
              {stateText}
            </span>
            <button
              ref={toggleRef}
              type="button"
              aria-expanded={expanded}
              aria-controls="guide-control-content"
              aria-label={expanded ? 'Collapse Guide control surface' : 'Expand Guide control surface'}
              onClick={() => updateExpanded(!expanded)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none"
            >
              {expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronUp aria-hidden="true" className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      <div
        id="guide-control-content"
        hidden={!expanded}
        className="max-h-[min(72dvh,38rem)] space-y-3 overflow-y-auto p-3.5 [scrollbar-color:rgba(148,163,184,0.25)_transparent] [scrollbar-width:thin]"
      >
          <GuidePresence
            state={presenceState}
            speechState={snapshot.speechState}
            size="compact"
            detail={contextualMessage.text}
            accessibleLabel={`Guide state: ${stateText}`}
          />

          <section aria-labelledby="guide-chat-heading" className="rounded-xl border border-[#e9bd7b]/20 bg-[linear-gradient(145deg,rgba(233,189,123,0.07),rgba(255,255,255,0.02))] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="guide-chat-heading" className="text-sm font-semibold text-slate-100">Talk to your Guide</h2>
                <p className="mt-1 text-xs leading-5 text-slate-400">Ask a question or explain a detail. The Guide receives a compact snapshot of this case and its uncertainty labels.</p>
              </div>
              <label className="shrink-0 text-xs text-slate-400">
                <span className="sr-only">Reply language</span>
                <select
                  aria-label="Guide reply language"
                  value={chatLanguage}
                  onChange={(event) => setChatLanguage(event.target.value as GuideChatLanguage)}
                  disabled={chatPending}
                  className="min-h-10 max-w-28 rounded-lg border border-white/10 bg-[#101722] px-2 text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b] disabled:opacity-50"
                >
                  <option value="hinglish">Hinglish</option>
                  <option value="hindi">Hindi</option>
                  <option value="english">English</option>
                </select>
              </label>
            </div>

            <div role="log" aria-label="Guide conversation" aria-live="polite" aria-relevant="additions" className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {chatTurns.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 p-3 text-sm leading-5 text-slate-400">
                  Try: “What information is still missing?” or “Explain what the case record says in simple words.”
                </p>
              ) : chatTurns.map((turn) => (
                <article key={turn.id} className={`rounded-lg border p-3 ${turn.role === 'you' ? 'border-white/[0.07] bg-white/[0.025]' : 'border-[#e9bd7b]/15 bg-[#e9bd7b]/[0.045]'}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{turn.role === 'you' ? 'You' : 'Guide'}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{turn.text}</p>
                </article>
              ))}
              {chatPending && <p role="status" className="text-sm text-[#f2d7aa]">Guide is preparing a reply…</p>}
            </div>

            {chatError && <p role="alert" className="mt-2 rounded-lg border border-rose-200/15 bg-rose-200/[0.05] p-3 text-xs leading-5 text-rose-100">{chatError}</p>}

            <form onSubmit={submitGuideChat} className="mt-3 space-y-2">
              <label htmlFor="guide-chat-message" className="block text-xs font-medium text-slate-300">Your message</label>
              <textarea
                id="guide-chat-message"
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                maxLength={4000}
                rows={3}
                disabled={!snapshot.caseState || chatPending}
                placeholder="Tell me what you want to understand…"
                className="w-full resize-y rounded-lg border border-white/10 bg-[#090f17] px-3 py-2.5 text-sm leading-6 text-slate-100 placeholder:text-slate-500 focus:border-[#e9bd7b]/50 focus:outline-none focus:ring-1 focus:ring-[#e9bd7b]/25 disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] leading-4 text-slate-500">Local assistant · no cloud fallback. Chat does not edit or save case facts.</p>
                <button type="submit" disabled={!snapshot.caseState || chatPending || !chatText.trim()} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-[#d9bd8c] px-3 text-xs font-semibold text-[#171a1e] transition hover:bg-[#ead5ac] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9bd7b] disabled:cursor-not-allowed disabled:opacity-45">
                  {chatPending ? 'Replying…' : 'Send'}
                </button>
              </div>
            </form>
          </section>

          <section aria-labelledby="guide-understanding-heading" className="rounded-xl border border-white/[0.065] bg-white/[0.025] p-3">
            <h2 id="guide-understanding-heading" className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              What I understand
            </h2>
            <div className="mt-2 space-y-2 text-[11px] leading-[1.55] text-slate-300">
              {model.understanding.initialAccount ? (
                <p className="line-clamp-3 border-l border-[#e9bd7b]/35 pl-2.5 text-slate-200">
                  <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-[#e9bd7b]/75">Initial account</span>
                  {model.understanding.initialAccount}
                </p>
              ) : (
                <p className="text-slate-400">No initial account is recorded in this CaseState.</p>
              )}
              <p className="text-[10px] text-slate-500">
                {model.understanding.factCount} recorded facts · {model.understanding.evidenceCount} evidence items · {model.understanding.documentCount} documents
              </p>
              {model.understanding.facts.length > 0 && (
                <ul className="space-y-1.5 border-t border-white/[0.06] pt-2">
                  {model.understanding.facts.map((fact) => (
                    <li key={fact.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2">
                      <span className="min-w-0 truncate text-slate-300" title={`${fact.label}: ${fact.value}`}>
                        <span className="text-slate-500">{fact.label} · </span>{fact.value}
                      </span>
                      <span className="whitespace-nowrap text-[9px] capitalize text-slate-500">{statusLabel(fact.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2">
            <section aria-labelledby="guide-unknown-heading" className="rounded-xl border border-white/[0.065] bg-white/[0.025] p-3">
              <h2 id="guide-unknown-heading" className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                <CircleHelp aria-hidden="true" className="h-3 w-3" /> Still unknown
              </h2>
              {model.unknowns.length > 0 ? (
                <ul className="mt-2 space-y-1.5 text-[10px] leading-[1.45] text-amber-100/85">
                  {model.unknowns.slice(0, 3).map((question) => <li key={question} className="line-clamp-2">{question}</li>)}
                  {model.unknowns.length > 3 && <li className="text-slate-500">+{model.unknowns.length - 3} more recorded</li>}
                </ul>
              ) : (
                <p className="mt-2 text-[10px] leading-[1.45] text-slate-400">No open question is recorded. That is not a completeness assessment.</p>
              )}
              {model.assumptions.length > 0 && (
                <div className="mt-2 border-t border-white/[0.06] pt-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-100/60">Assumptions recorded</p>
                  <ul className="mt-1 space-y-1 text-[9px] leading-[1.4] text-slate-400">
                    {model.assumptions.slice(0, 2).map((assumption) => <li key={assumption} className="line-clamp-2">{assumption}</li>)}
                    {model.assumptions.length > 2 && <li>+{model.assumptions.length - 2} more recorded</li>}
                  </ul>
                </div>
              )}
            </section>

            <section aria-labelledby="guide-why-heading" className="rounded-xl border border-white/[0.065] bg-white/[0.025] p-3">
              <h2 id="guide-why-heading" className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Why it matters</h2>
              <p className="mt-2 text-[10px] leading-[1.5] text-slate-300">{model.whyItMatters}</p>
              {model.safetySummary && <p className="mt-1 text-[9px] leading-4 text-amber-100/75">{model.safetySummary}</p>}
              {model.conflicts.length > 0 && (
                <ul className="mt-1 space-y-1 text-[9px] leading-4 text-amber-100/75">
                  {model.conflicts.slice(0, 2).map((conflict) => <li key={conflict} className="line-clamp-2">{conflict}</li>)}
                </ul>
              )}
            </section>
          </div>

          {model.uncertainty.relevant && (
            <section aria-label="Uncertainty indicator" className="flex items-start gap-2 rounded-xl border border-amber-200/15 bg-amber-200/[0.045] px-3 py-2.5">
              <ShieldAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
              <div>
                <p className="text-[10px] font-semibold text-amber-100">{model.uncertainty.label}</p>
                <p className="mt-0.5 text-[9px] leading-4 text-amber-100/70">{model.uncertainty.detail}</p>
              </div>
            </section>
          )}

          <section aria-labelledby="guide-next-heading" className="rounded-xl border border-[#e9bd7b]/15 bg-[linear-gradient(125deg,rgba(233,189,123,0.075),rgba(255,255,255,0.018)_68%)] p-3">
            <div className="flex items-center gap-1.5 text-[#e9bd7b]">
              {snapshot.state.name === 'listening' ? <Mic2 aria-hidden="true" className="h-3.5 w-3.5" /> : <Radio aria-hidden="true" className="h-3.5 w-3.5" />}
              <h2 id="guide-next-heading" className="text-[9px] font-semibold uppercase tracking-[0.15em]">What you can do next</h2>
            </div>
            {model.nextAction && primaryAction ? (
              <>
                <p className="mt-2 text-xs font-medium leading-5 text-slate-100">{model.nextAction.label}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-400">{model.nextAction.detail}</p>
                <button
                  type="button"
                  disabled={actionRunning}
                  onClick={() => void runAction(primaryAction)}
                  className="mt-2.5 inline-flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-[#e9bd7b]/25 bg-[#e9bd7b]/[0.085] px-3 text-[10px] font-semibold text-[#f2d7aa] transition hover:bg-[#e9bd7b]/[0.14] disabled:cursor-wait disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none"
                >
                  <span>{actionLabel(primaryAction)}</span>
                  <span aria-hidden="true">↗</span>
                </button>
              </>
            ) : (
              <p className="mt-2 text-[10px] leading-4 text-slate-400">
                {model.nextAction
                  ? 'The recorded next step has no connected workspace action yet.'
                  : 'No case-specific next step is recorded. The Guide will stay with the information above.'}
              </p>
            )}
          </section>

          <section aria-labelledby="guide-actions-heading">
            <div className="mb-1.5 flex items-center justify-between">
              <h2 id="guide-actions-heading" className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Available actions</h2>
              <span className="text-[9px] text-slate-600">{snapshot.availableActions.length} available</span>
            </div>
            {otherActions.length > 0 ? (
              <div className="grid grid-cols-2 gap-1.5">
                {otherActions.map((action) => (
                  <button
                    key={`${action.type}-${JSON.stringify(action.payload)}`}
                    type="button"
                    disabled={actionRunning}
                    onClick={() => void runAction(action)}
                    className="inline-flex min-h-11 items-center justify-between gap-1 rounded-lg border border-white/[0.075] bg-white/[0.025] px-2.5 text-left text-[9px] font-medium text-slate-300 transition hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9bd7b] motion-reduce:transition-none"
                  >
                    <span className="truncate">{actionLabel(action)}</span>
                    {action.type === 'SPEAK_RESPONSE' && <Volume2 aria-hidden="true" className="h-3 w-3 shrink-0 text-slate-500" />}
                  </button>
                ))}
              </div>
            ) : snapshot.availableActions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/[0.08] px-2.5 py-2 text-[10px] leading-4 text-slate-500">
                No action is available until a case record is loaded.
              </p>
            ) : (
              <p className="rounded-lg border border-dashed border-white/[0.08] px-2.5 py-2 text-[10px] leading-4 text-slate-500">
                The recommended action above is the only case-specific action available right now.
              </p>
            )}
          </section>

          <section aria-labelledby="guide-activity-heading" className="border-t border-white/[0.065] pt-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <h2 id="guide-activity-heading" className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">System response</h2>
              {snapshot.state.name === 'error' && <button type="button" onClick={dismissError} className="text-[9px] font-medium text-rose-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e9bd7b]">Clear error</button>}
            </div>
            {snapshot.state.error && <p role="alert" className="mb-2 rounded-lg border border-rose-200/15 bg-rose-200/[0.05] px-2.5 py-2 text-[10px] text-rose-100">{snapshot.state.error}</p>}
            <div role="log" aria-label="Guide activity transcript" aria-live="polite" aria-relevant="additions" className="max-h-20 space-y-1.5 overflow-y-auto">
              {messages.length > 0 ? messages.slice(-3).map((message) => (
                <p key={message.id} className={`border-l pl-2 text-[9px] leading-4 ${message.kind === 'error' ? 'border-rose-300/40 text-rose-100/80' : message.kind === 'action' ? 'border-emerald-300/35 text-emerald-100/80' : 'border-[#e9bd7b]/25 text-slate-400'}`}>
                  {message.text}
                </p>
              )) : (
                <p className="text-[9px] leading-4 text-slate-500">Guide activity will appear here as the case changes or an action runs.</p>
              )}
            </div>
          </section>
      </div>
    </aside>
  );
}

export default GuideControlSurface;
