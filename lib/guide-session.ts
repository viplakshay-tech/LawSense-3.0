'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { GuideActionName, GuideChatLanguage, GuideConversationTurn } from './api';

export interface GuideSessionTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  inputMode: 'text' | 'voice';
  status?: 'ok' | 'unavailable';
  proposedAction?: GuideActionName;
  audio?: 'queued' | 'speaking' | 'spoken' | 'unavailable' | 'failed';
}

export interface GuideSessionSnapshot {
  turns: GuideSessionTurn[];
  language: GuideChatLanguage;
  generation: number;
  requestSequence: number;
}

const EMPTY_SNAPSHOT: GuideSessionSnapshot = Object.freeze({
  turns: [],
  language: 'english',
  generation: 0,
  requestSequence: 0,
});

const MAX_VISIBLE_TURNS = 20;
const MAX_HISTORY_TURNS = 8;
const sessions = new Map<string, GuideSessionSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const turnSequences = new Map<string, number>();
const pendingTurnRequests = new Map<string, AbortController>();
let activeCaseId: string | null = null;

function storageKey(caseId: string): string {
  return `lawsense:guide-session:v1:${caseId}`;
}

function isTurn(value: unknown): value is GuideSessionTurn {
  if (!value || typeof value !== 'object') return false;
  const turn = value as Partial<GuideSessionTurn>;
  return typeof turn.id === 'string'
    && (turn.role === 'user' || turn.role === 'assistant')
    && typeof turn.content === 'string'
    && (turn.inputMode === 'text' || turn.inputMode === 'voice');
}

function readSession(caseId: string): GuideSessionSnapshot {
  if (!caseId) return EMPTY_SNAPSHOT;
  const cached = sessions.get(caseId);
  if (cached) return cached;

  let snapshot: GuideSessionSnapshot = EMPTY_SNAPSHOT;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(storageKey(caseId));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GuideSessionSnapshot>;
        const turns = Array.isArray(parsed.turns) ? parsed.turns.filter(isTurn).slice(-MAX_VISIBLE_TURNS) : [];
        const language = parsed.language === 'hindi' || parsed.language === 'hinglish' ? parsed.language : 'english';
        snapshot = {
          turns,
          language,
          generation: Number.isSafeInteger(parsed.generation) && (parsed.generation ?? 0) >= 0
            ? parsed.generation as number
            : 0,
          requestSequence: Number.isSafeInteger(parsed.requestSequence) && (parsed.requestSequence ?? 0) >= 0
            ? parsed.requestSequence as number
            : 0,
        };
      }
    } catch {
      // Storage is optional. The in-memory session remains usable if it is unavailable.
    }
  }
  sessions.set(caseId, snapshot);
  return snapshot;
}

function publish(caseId: string, next: GuideSessionSnapshot): void {
  if (!caseId) return;
  sessions.set(caseId, next);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(storageKey(caseId), JSON.stringify(next));
    } catch {
      // Quota/private-mode failures must not block the live conversation.
    }
  }
  listeners.get(caseId)?.forEach((listener) => listener());
}

function subscribe(caseId: string, listener: () => void): () => void {
  if (!caseId) return () => undefined;
  const group = listeners.get(caseId) ?? new Set<() => void>();
  group.add(listener);
  listeners.set(caseId, group);
  return () => {
    group.delete(listener);
    if (group.size === 0) listeners.delete(caseId);
  };
}

export function getGuideSessionSnapshot(caseId: string): GuideSessionSnapshot {
  return readSession(caseId);
}

/** A clear increments this token so pending work from either input mode cannot repopulate the session. */
export function getGuideSessionGeneration(caseId: string): number {
  return readSession(caseId).generation;
}

export function isGuideSessionGenerationCurrent(caseId: string, generation: number): boolean {
  return Number.isSafeInteger(generation) && getGuideSessionGeneration(caseId) === generation;
}

export interface GuideTurnToken {
  generation: number;
  sequence: number;
  signal: AbortSignal;
}

/** A newer text or voice turn supersedes and aborts every older request for this case. */
export function beginGuideTurn(caseId: string): GuideTurnToken {
  const current = readSession(caseId);
  if (!caseId) {
    return { generation: current.generation, sequence: current.requestSequence, signal: new AbortController().signal };
  }
  pendingTurnRequests.get(caseId)?.abort();
  const controller = new AbortController();
  pendingTurnRequests.set(caseId, controller);
  const previousSequence = Math.max(turnSequences.get(caseId) ?? 0, current.requestSequence);
  const wraps = previousSequence >= Number.MAX_SAFE_INTEGER;
  const generation = wraps ? current.generation + 1 : current.generation;
  const sequence = wraps ? 1 : previousSequence + 1;
  turnSequences.set(caseId, sequence);
  publish(caseId, { ...current, generation, requestSequence: sequence });
  return { generation, sequence, signal: controller.signal };
}

export function isGuideTurnCurrent(caseId: string, token: GuideTurnToken): boolean {
  const current = readSession(caseId);
  return Boolean(caseId)
    && Number.isSafeInteger(token.sequence)
    && token.sequence > 0
    && token.generation === current.generation
    && token.sequence === (turnSequences.get(caseId) ?? current.requestSequence)
    && current.requestSequence === token.sequence
    && !token.signal.aborted;
}

export function finishGuideTurn(caseId: string, token: GuideTurnToken): void {
  if (pendingTurnRequests.get(caseId)?.signal === token.signal) {
    pendingTurnRequests.delete(caseId);
  }
}

/** Invalidate pending work when the active case changes without clearing its turns. */
export function invalidateGuideTurn(caseId: string): void {
  if (!caseId) return;
  const current = readSession(caseId);
  pendingTurnRequests.get(caseId)?.abort();
  pendingTurnRequests.delete(caseId);
  const nextSequence = current.requestSequence >= Number.MAX_SAFE_INTEGER ? 0 : current.requestSequence + 1;
  turnSequences.set(caseId, nextSequence);
  publish(caseId, { ...current, requestSequence: nextSequence });
}

export function appendGuideSessionTurn(caseId: string, turn: GuideSessionTurn): void {
  const current = readSession(caseId);
  publish(caseId, { ...current, turns: [...current.turns, turn].slice(-MAX_VISIBLE_TURNS) });
}

export function updateGuideSessionTurn(
  caseId: string,
  turnId: string,
  update: Partial<Pick<GuideSessionTurn, 'audio' | 'status'>>,
): void {
  const current = readSession(caseId);
  if (!current.turns.some((turn) => turn.id === turnId)) return;
  publish(caseId, {
    ...current,
    turns: current.turns.map((turn) => turn.id === turnId ? { ...turn, ...update } : turn),
  });
}

export function setGuideSessionLanguage(caseId: string, language: GuideChatLanguage): void {
  const current = readSession(caseId);
  if (current.language === language) return;
  publish(caseId, { ...current, language });
}

export function clearGuideSession(caseId: string): void {
  const current = readSession(caseId);
  pendingTurnRequests.get(caseId)?.abort();
  pendingTurnRequests.delete(caseId);
  const nextSequence = current.requestSequence >= Number.MAX_SAFE_INTEGER ? 0 : current.requestSequence + 1;
  turnSequences.set(caseId, nextSequence);
  publish(caseId, {
    turns: [],
    language: 'english',
    generation: current.generation + 1,
    requestSequence: nextSequence,
  });
}

export function getGuideConversationHistory(caseId: string): GuideConversationTurn[] {
  return readSession(caseId).turns
    .filter((turn) => turn.role === 'user' || turn.status !== 'unavailable')
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
}

export function useGuideSession(caseId: string) {
  useEffect(() => {
    if (!caseId) return;
    const previousActiveCaseId = activeCaseId;
    if (previousActiveCaseId && previousActiveCaseId !== caseId) invalidateGuideTurn(previousActiveCaseId);
    activeCaseId = caseId;
  }, [caseId]);

  const snapshot = useSyncExternalStore(
    useCallback((listener) => subscribe(caseId, listener), [caseId]),
    useCallback(() => readSession(caseId), [caseId]),
    () => EMPTY_SNAPSHOT,
  );

  const appendTurn = useCallback((turn: GuideSessionTurn) => appendGuideSessionTurn(caseId, turn), [caseId]);
  const updateTurn = useCallback((turnId: string, update: Partial<Pick<GuideSessionTurn, 'audio' | 'status'>>) => {
    updateGuideSessionTurn(caseId, turnId, update);
  }, [caseId]);
  const setLanguage = useCallback((language: GuideChatLanguage) => setGuideSessionLanguage(caseId, language), [caseId]);
  const clear = useCallback(() => clearGuideSession(caseId), [caseId]);
  const history = getGuideConversationHistory(caseId);

  return { ...snapshot, history, appendTurn, updateTurn, setLanguage, clear };
}
