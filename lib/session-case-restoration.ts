import type { CaseState } from '@/lib/api';

export type RestoredSessionCase =
  | { id: string; state: 'ready'; data: CaseState }
  | { id: string; state: 'unavailable' };

type LoadCase = (id: string, signal?: AbortSignal) => Promise<CaseState>;

export const SESSION_CASE_REQUEST_TIMEOUT_MS = 15_000;

/** Loads each saved case independently so one bad or stalled entry cannot block the chooser. */
export async function restoreSessionCases(
  ids: string[],
  activeCaseData: CaseState | null,
  loadCase: LoadCase,
  timeoutMs = SESSION_CASE_REQUEST_TIMEOUT_MS,
): Promise<RestoredSessionCase[]> {
  return Promise.all(ids.map(async (id): Promise<RestoredSessionCase> => {
    if (id === activeCaseData?.id) return { id, state: 'ready', data: activeCaseData };

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutRequest = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('The case request timed out.'));
      }, timeoutMs);
    });

    try {
      const data = await Promise.race([loadCase(id, controller.signal), timeoutRequest]);
      if (data.id !== id) return { id, state: 'unavailable' };
      return { id, state: 'ready', data };
    } catch {
      return { id, state: 'unavailable' };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }));
}
