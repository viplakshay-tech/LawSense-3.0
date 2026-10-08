const SESSION_CASES_KEY = 'lawsense:case-continuity:v1';
const MAX_SESSION_CASES = 8;

function readStoredCaseIds(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(SESSION_CASES_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];

    return value.filter((item): item is string =>
      typeof item === 'string' && item.trim().length > 0 && item.length <= 200,
    ).slice(0, MAX_SESSION_CASES);
  } catch {
    return [];
  }
}

/** Remembers only case identifiers for this browser session; case content stays on the case API. */
export function rememberSessionCase(caseId: string): void {
  if (typeof window === 'undefined' || !caseId.trim() || caseId.length > 200) return;

  const caseIds = [caseId, ...readStoredCaseIds().filter((id) => id !== caseId)].slice(0, MAX_SESSION_CASES);
  try {
    window.sessionStorage.setItem(SESSION_CASES_KEY, JSON.stringify(caseIds));
  } catch {
    // The chooser remains available for the current route even when browser storage is disabled.
  }
}

export function getSessionCaseIds(): string[] {
  return readStoredCaseIds();
}

export function clearSessionCases(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_CASES_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}
