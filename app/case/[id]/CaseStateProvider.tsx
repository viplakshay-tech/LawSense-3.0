'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getCase, type CaseState } from '@/lib/api';

type CaseStateContextValue = {
  caseState: CaseState | null;
  loading: boolean;
  error: string | null;
  revision: number;
  replaceCaseState: (nextCase: CaseState) => boolean;
  refreshCaseState: () => Promise<CaseState>;
};

const CaseStateContext = createContext<CaseStateContextValue | null>(null);

function getCaseResponseError(value: unknown, caseId: string): string | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string'
  ) {
    return 'The case service returned an invalid case.';
  }
  if (value.id !== caseId) return 'The case service returned a different case.';
  return null;
}

function isOlderState(next: CaseState, current: CaseState): boolean {
  const nextTime = Date.parse(next.metadata.updatedAt);
  const currentTime = Date.parse(current.metadata.updatedAt);
  return Number.isFinite(nextTime) && Number.isFinite(currentTime) && nextTime < currentTime;
}

export function CaseStateProvider({
  caseId,
  children,
}: {
  caseId: string;
  children: ReactNode;
}) {
  const [caseState, setCaseState] = useState<CaseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const currentCaseRef = useRef<CaseState | null>(null);
  const requestSequenceRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  const acceptCaseState = useCallback((nextCase: CaseState): boolean => {
    if (nextCase.id !== caseId) return false;

    const current = currentCaseRef.current;
    if (current && isOlderState(nextCase, current)) return false;

    const changed = !current || JSON.stringify(current) !== JSON.stringify(nextCase);
    if (!changed) {
      setError(null);
      setLoading(false);
      return true;
    }
    currentCaseRef.current = nextCase;
    setCaseState(nextCase);
    setError(null);
    setLoading(false);
    setRevision((value) => value + 1);
    return true;
  }, [caseId]);

  const replaceCaseState = useCallback((nextCase: CaseState) => {
    if (nextCase.id !== caseId) return false;
    const current = currentCaseRef.current;
    if (current && isOlderState(nextCase, current)) return false;

    mutationSequenceRef.current += 1;
    requestSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    return acceptCaseState(nextCase);
  }, [acceptCaseState, caseId]);

  const refreshCaseState = useCallback(async (): Promise<CaseState> => {
    const sequence = ++requestSequenceRef.current;
    const mutationSequence = mutationSequenceRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const nextCase = await getCase(caseId, controller.signal);
      const responseError = getCaseResponseError(nextCase, caseId);
      if (responseError) throw new Error(responseError);
      if (
        sequence !== requestSequenceRef.current ||
        mutationSequence !== mutationSequenceRef.current ||
        controller.signal.aborted
      ) {
        if (currentCaseRef.current) return currentCaseRef.current;
        throw new Error('The case refresh was superseded.');
      }
      acceptCaseState(nextCase);
      const accepted = currentCaseRef.current;
      if (!accepted) throw new Error('The case service returned a different case.');
      return accepted;
    } catch (cause) {
      if (sequence === requestSequenceRef.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'The case could not be refreshed.');
        setLoading(false);
      }
      throw cause;
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [acceptCaseState, caseId]);

  useEffect(() => {
    const sequence = ++requestSequenceRef.current;
    const mutationSequence = mutationSequenceRef.current;
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    void getCase(caseId, controller.signal)
      .then((nextCase) => {
        if (
          sequence !== requestSequenceRef.current ||
          mutationSequence !== mutationSequenceRef.current ||
          controller.signal.aborted
        ) return;
        const responseError = getCaseResponseError(nextCase, caseId);
        if (responseError) throw new Error(responseError);
        acceptCaseState(nextCase);
      })
      .catch((cause: unknown) => {
        if (sequence !== requestSequenceRef.current || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'The case could not be loaded.');
        setLoading(false);
      })
      .finally(() => {
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
      });
    return () => {
      requestSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [acceptCaseState, caseId]);

  const value = useMemo<CaseStateContextValue>(() => ({
    caseState,
    loading,
    error,
    revision,
    replaceCaseState,
    refreshCaseState,
  }), [caseState, error, loading, refreshCaseState, replaceCaseState, revision]);

  return <CaseStateContext.Provider value={value}>{children}</CaseStateContext.Provider>;
}

export function useCaseState(): CaseStateContextValue {
  const value = useContext(CaseStateContext);
  if (!value) throw new Error('useCaseState must be used inside the case route provider.');
  return value;
}
