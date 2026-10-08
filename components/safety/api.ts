import type { SafetySupportRequest, SafetySupportResponse } from './types';

const SAFETY_API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

export async function getSafetySupport(
  caseId: string,
  request: SafetySupportRequest = {},
): Promise<SafetySupportResponse> {
  const response = await fetch(
    `${SAFETY_API_BASE}/cases/${encodeURIComponent(caseId)}/safety-support`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error('Safety support is temporarily unavailable.');
  }

  const result = (await response.json()) as SafetySupportResponse;
  if (
    result.contacted_anyone !== false ||
    result.assessment?.contacted_anyone !== false ||
    result.status !== 'available'
  ) {
    throw new Error('The safety response could not be verified.');
  }

  return result;
}
