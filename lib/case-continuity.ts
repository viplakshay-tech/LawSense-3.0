const SESSION_CASES_KEY = 'lawsense:case-continuity:v1';
const MAX_SESSION_CASES = 8;
const CASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionCaseId(caseId: unknown): caseId is string {
  return typeof caseId === 'string' && CASE_ID_PATTERN.test(caseId);
}

function readStoredCaseIds(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(SESSION_CASES_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];

    const caseIds = value.filter(isValidSessionCaseId).slice(0, MAX_SESSION_CASES);
    if (caseIds.length !== value.length) {
      try {
        window.sessionStorage.setItem(SESSION_CASES_KEY, JSON.stringify(caseIds));
      } catch {
        // Keep the sanitized in-memory list when browser storage cannot be updated.
      }
    }
    return caseIds;
  } catch {
    return [];
  }
}

/** Remembers only case identifiers for this browser session; case content stays on the case API. */
export function rememberSessionCase(caseId: string): void {
  if (typeof window === 'undefined' || !isValidSessionCaseId(caseId)) return;

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

/** Forget one deleted case ID without clearing the user's other session cases. */
export function forgetSessionCase(caseId: string): void {
  if (typeof window === 'undefined' || !isValidSessionCaseId(caseId)) return;
  try {
    const remaining = readStoredCaseIds().filter((id) => id !== caseId);
    if (remaining.length === 0) {
      window.sessionStorage.removeItem(SESSION_CASES_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_CASES_KEY, JSON.stringify(remaining));
    }
  } catch {
    // This only cleans a convenience index; canonical case data is deleted server-side.
  }
}

export function clearSessionCases(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_CASES_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}
