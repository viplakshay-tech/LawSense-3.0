import { expect, test, type Page, type Route } from '@playwright/test';

const narrative = 'Mere landlord ne ₹30,000 security deposit return nahi kiya. Agreement bhi hai.';
const agreementName = 'synthetic-rental-agreement.pdf';

test.beforeEach(async ({ page }) => {
  // Browser requests use the documented same-origin /api contract. Forward
  // them to the disposable API process without changing request or response data.
  await page.route('**/api/**', async (route) => {
    const target = new URL(route.request().url());
    target.port = '8001';
    target.pathname = target.pathname.replace(/^\/api(?=\/|$)/, '');
    console.log(`[API proxy] ${route.request().method()} ${target.pathname} forwarded to the isolated service`);
    const response = await route.fetch({ url: target.toString() });
    console.log(`[API proxy] ${target.pathname} returned HTTP ${response.status()}`);
    await route.fulfill({ response });
  });
});

test('a skipped clarification stays unknown across reload and can be answered later', async ({ page }) => {
  const queueResponsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'GET'
      && requestUrl.pathname.endsWith('/clarification')
      && requestUrl.searchParams.get('include_skipped') === 'true';
  });
  const createResponsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'POST' && requestUrl.pathname === '/api/cases';
  });
  await enterCase(page);
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const createdCase = await createResponse.json() as {
    id: string;
    unknowns: string[];
    facts: unknown[];
    evidence: unknown[];
  };
  const caseId = createdCase.id;
  const queueResponse = await queueResponsePromise;
  const queue = await queueResponse.json() as {
    questions: Array<{ id: string; question: string; category: string }>;
  };
  const question = queue.questions[0];
  expect(question).toBeTruthy();
  await expect(page.locator('#clarification').getByRole('heading', { level: 3 })).toHaveText(question.question);

  const skipResponsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'POST'
      && requestUrl.pathname === `/api/cases/${caseId}/clarification/${question.id}/skip`;
  });
  await page.locator('#clarification').getByRole('button', { name: 'Skip', exact: true }).click();
  const skipResponse = await skipResponsePromise;
  expect(skipResponse.status()).toBe(200);
  const skippedState = await skipResponse.json() as {
    skippedClarificationIds: string[];
    unknowns: string[];
    facts: unknown[];
    evidence: unknown[];
  };
  expect(skippedState.skippedClarificationIds).toContain(question.id);
  expect(skippedState.unknowns).toEqual(createdCase.unknowns);
  expect(skippedState.facts).toEqual(createdCase.facts);
  expect(skippedState.evidence).toEqual(createdCase.evidence);

  await page.reload();
  await expect(page.locator('#clarification')).toBeVisible();
  await expect(page.locator('#clarification').getByRole('button', { name: /Review skipped/ })).toBeVisible();
  await page.locator('#clarification').getByRole('button', { name: /Review skipped/ }).click();
  await expect(page.locator('#clarification').getByRole('heading', { level: 3 })).toHaveText(question.question);

  const answer = question.category === 'jurisdiction'
    ? 'Pune, Maharashtra, India'
    : 'I want to understand the options available to me.';
  const answerResponsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'POST'
      && requestUrl.pathname === `/api/cases/${caseId}/clarification/${question.id}/answer`;
  });
  await page.locator('#clarification').getByLabel('Your answer').fill(answer);
  await page.locator('#clarification').getByRole('button', { name: 'Answer', exact: true }).click();
  const answerResponse = await answerResponsePromise;
  expect(answerResponse.status()).toBe(200);
  const answeredState = await answerResponse.json() as {
    skippedClarificationIds: string[];
    facts: Array<{ value: unknown; status: string; notes?: string | null }>;
    evidence: Array<{ source: string; status: string }>;
  };
  expect(answeredState.skippedClarificationIds).not.toContain(question.id);
  expect(answeredState.facts).toContainEqual(expect.objectContaining({
    value: answer,
    status: 'user_reported',
  }));
  expect(answeredState.evidence.some((item) => item.source === 'user' && item.status === 'user_reported')).toBe(true);

  const destinations = page.getByRole('navigation', { name: 'Case workspace' });
  await destinations.getByRole('link', { name: 'Evidence' }).click();
  await expect(page).toHaveURL(`/case/${caseId}/documents`);
  await page.getByRole('link', { name: 'Case workspace', exact: true }).click();
  await expect(page).toHaveURL(`/case/${caseId}`);
  await expect(page.getByText(answer, { exact: false }).first()).toBeVisible();
});

function makeSyntheticAgreementPdf(): Buffer {
  // Known test terms: one fictional agreement, one page, INR 30,000 deposit.
  const sentence = 'SYNTHETIC TEST ONLY. Rental agreement. Security deposit INR 30000, refundable under fictional terms.';
  const escaped = sentence.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = Buffer.from(`BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`, 'ascii');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', 'ascii'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'), stream, Buffer.from('\nendstream', 'ascii')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'ascii'),
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), object, Buffer.from('\nendobj\n', 'ascii'));
  });
  const xrefOffset = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'ascii'));
  return Buffer.concat(chunks);
}

async function fillCaseForm(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('textarea').fill(narrative);
  await page.getByRole('combobox').selectOption('Hinglish');
}

async function enterCase(page: Page): Promise<void> {
  await fillCaseForm(page);
  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to guided questions' }).click();
  await expect(page).toHaveURL(/\/case\/[^/]+$/);
}

test('case workspace exposes persistent Legal Advisory and case-aware Guide chat', async ({ page }) => {
  await enterCase(page);
  const caseIdMatch = page.url().match(/\\/case\\/([^/]+)$/);
  expect(caseIdMatch).toBeTruthy();
  const advisory = page.getByRole('button', {
    name: 'Open Legal Advisory based on information recorded so far',
  });
  await expect(advisory).toBeVisible();

  const reasoningResponsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'GET'
      && requestUrl.pathname.endsWith('/legal-reasoning')
      && requestUrl.pathname.includes(`/cases/${caseIdMatch?.[1]}/`);
  });
  await advisory.click();
  const reasoningResponse = await reasoningResponsePromise;
  expect(reasoningResponse.status()).toBe(200);

  const dialog = page.getByRole('dialog', { name: 'Legal Advisory' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/This is a provisional, source-aware case review/)).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Suggested next steps' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close legal advisory' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Expand Guide control surface' }).click();
  await expect(page.getByRole('heading', { name: 'Talk to your Guide' })).toBeVisible();
  await expect(page.getByLabel('Guide reply language')).toHaveValue('english');
  await expect(page.getByLabel('Message your Guide')).toBeVisible();
  await expect(page.getByText(/This chat is not saved to the case/)).toBeVisible();
});

test('real landlord-deposit flow refreshes CaseState and the Living Twin timeline', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // Hold one real GET response so the case loading state is observable, then
  // continue the request to the real API without changing its response.
  let releaseCaseGet!: () => void;
  const caseGetRelease = new Promise<void>((resolve) => { releaseCaseGet = resolve; });
  let holdNextCaseRead = false;
  let caseReadHeld = false;
  await page.route('**/api/cases/**', async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    const isCaseRead = route.request().method() === 'GET'
      && /^\/api\/cases\/[^/]+$/.test(requestUrl.pathname);
    // Arm the hold immediately before entering the workspace, avoiding an
    // assumption about how many reads the intake review performs.
    if (isCaseRead && holdNextCaseRead) {
      holdNextCaseRead = false;
      caseReadHeld = true;
      await caseGetRelease;
    }
    await route.fallback();
  });

  await fillCaseForm(page);
  const createResponsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'POST' && requestUrl.pathname === '/api/cases';
  });
  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const createdCase = await createResponse.json() as { id: string };
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();

  holdNextCaseRead = true;
  const caseUrl = page.waitForURL(/\/case\/[^/]+$/);
  const submitClick = page.getByRole('button', { name: 'Continue to guided questions' }).click();
  try {
    await caseUrl;
    await expect.poll(() => caseReadHeld).toBe(true);
    await expect(page.getByText('Retrieving your case...', { exact: true })).toBeVisible();
  } finally {
    // Release the API request even if the loading-state assertion fails.
    releaseCaseGet();
  }
  await submitClick;

  const caseId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(caseId).toBe(createdCase.id);
  await expect(page.locator('#overview').getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Facts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Information still needed' })).toBeVisible();
  await expect(page.getByText(/jurisdiction|location/i).first()).toBeVisible();
  const destinations = page.getByRole('navigation', { name: 'Case workspace' });
  await expect(destinations.getByRole('link', { name: 'Evidence' })).toBeVisible();

  await destinations.getByRole('link', { name: 'Evidence' }).click();
  await expect(page).toHaveURL(`/case/${caseId}/documents`);
  await expect(page.getByRole('heading', { name: 'Document review' })).toBeVisible();
  await page.getByLabel('Choose a PDF or image document').setInputFiles({
    name: agreementName,
    mimeType: 'application/pdf',
    buffer: makeSyntheticAgreementPdf(),
  });
  await page.getByRole('button', { name: 'Upload and review' }).click();

  await expect(page.getByRole('heading', { name: 'Extracted findings' })).toBeVisible();
  const amountFinding = page.locator('article')
    .filter({ hasText: "Reused document_intelligence field 'amount'." })
    .getByRole('checkbox', { name: 'Select finding: Amount' });
  await expect(amountFinding).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence mapping' })).toBeVisible();
  await amountFinding.check();
  await page.getByRole('button', { name: 'Confirm 1 selected' }).click();
  await expect(page.getByRole('heading', { name: 'CaseState updated' })).toBeVisible();
  await expect(page.getByText(/from this document now have evidence-supported status and user-confirmed provenance/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Confirmed finding: Amount/i })).toBeChecked();
  await expect(page.getByText(/Page 1/).first()).toBeVisible();

  await page.getByRole('link', { name: 'Case workspace', exact: true }).click();
  await expect(page).toHaveURL(`/case/${caseId}`);
  await expect(page.locator('#overview').getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Information still needed' })).toBeVisible();
  await expect(page.getByText('Evidence Supported').first()).toBeVisible();
  await expect(page.getByText(agreementName).first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Case workspace' }).getByRole('link', { name: 'Legal Twin', exact: true }).click();
  await expect(page).toHaveURL(`/case/${caseId}/twin`);
  await expect(page.getByText('Living Legal Twin')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Move through the case timeline' })).toBeVisible();
  const graph = page.getByRole('region', { name: 'Living Legal Twin CaseState projection' });
  await expect(graph).toBeVisible();

  const playTimeline = page.getByRole('button', { name: 'Play the case timeline' });
  await expect(playTimeline).toBeDisabled();
  await expect(playTimeline).toHaveAttribute('title', /reduced-motion preference/i);

  const slider = page.getByRole('slider', { name: 'Choose the date for the CaseState projection' });
  await expect(slider).toBeVisible();
  await expect(slider).not.toBeDisabled();
  const timelineSection = page.getByRole('heading', { name: 'Move through the case timeline' })
    .locator('xpath=ancestor::section[1]');
  const timelineButtons = timelineSection.locator('button[aria-pressed]');
  const timelineButtonStates = await timelineButtons.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-pressed')),
  );
  const nextMilestoneIndex = timelineButtonStates.indexOf('false');
  expect(nextMilestoneIndex).toBeGreaterThanOrEqual(0);
  const selectedMilestone = timelineButtons.nth(nextMilestoneIndex);
  await expect(selectedMilestone).toBeVisible();

  // Hold one real snapshot response to observe timeline selection/loading,
  // then let it reach the real API unchanged.
  let releaseSnapshot!: () => void;
  const snapshotRelease = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
  let heldSnapshot = false;
  await page.route('**/api/cases/**/twin/snapshot**', async (route: Route) => {
    if (!heldSnapshot) {
      heldSnapshot = true;
      await snapshotRelease;
    }
    await route.fallback();
  });

  await expect(timelineSection.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await selectedMilestone.click();
  try {
    await expect.poll(() => heldSnapshot).toBe(true);
    await expect(selectedMilestone).toHaveAttribute('aria-pressed', 'true');
    await expect(graph).toHaveAttribute('aria-busy', 'true');
  } finally {
    releaseSnapshot();
  }
  await expect(graph).toHaveAttribute('aria-busy', 'false');

  await page.getByRole('navigation', { name: 'Case workspace' }).getByRole('link', { name: 'Understand' }).click();
  await expect(page).toHaveURL(`/case/${caseId}`);
  await expect(page.locator('#overview').getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByText('Evidence Supported').first()).toBeVisible();
  await expect(page.getByText(agreementName).first()).toBeVisible();
});

test('an unavailable case shows useful recovery actions', async ({ page }) => {
  await page.goto('/case/synthetic-case-that-does-not-exist');
  await expect(page.getByRole('heading', { name: 'This case could not be reopened' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Cases this session' }).click();
  await expect(page).toHaveURL('/');
});

test('a 200 response for another case exits loading with a retryable error', async ({ page }) => {
  let responseCount = 0;
  await page.route('**/api/cases/reopen-mismatched-case', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    responseCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'a-different-case' }),
    });
  });

  const responsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'GET'
      && requestUrl.pathname === '/api/cases/reopen-mismatched-case';
  });
  await page.goto('/case/reopen-mismatched-case');
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This case could not be reopened' })).toBeVisible();
  await expect(page.getByText('The case service returned a different case.')).toBeVisible();
  await expect(page.getByText('Retrieving your case...')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => responseCount).toBe(2);
  await expect(page.getByRole('heading', { name: 'This case could not be reopened' })).toBeVisible();
});

test('a malformed 200 case response exits loading into recovery actions', async ({ page }) => {
  await page.route('**/api/cases/reopen-malformed-case', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"id":',
    });
  });

  const responsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'GET'
      && requestUrl.pathname === '/api/cases/reopen-malformed-case';
  });
  await page.goto('/case/reopen-malformed-case');
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This case could not be reopened' })).toBeVisible();
  await expect(page.getByText('Retrieving your case...')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a failed case API request is visible and retry recovers from the real API', async ({ page }) => {
  let caseReadCount = 0;
  let failedWorkspaceRead = false;
  let failedCaseReadPath: string | null = null;
  await page.route('**/api/cases/**', async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    const isCaseRead = route.request().method() === 'GET'
      && /^\/api\/cases\/[^/]+$/.test(requestUrl.pathname);
    if (isCaseRead) caseReadCount += 1;
    if (isCaseRead && caseReadCount === 2 && !failedWorkspaceRead) {
      failedWorkspaceRead = true;
      failedCaseReadPath = requestUrl.pathname;
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });

  const createResponsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'POST' && requestUrl.pathname === '/api/cases';
  });
  await enterCase(page);
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const createdCase = await createResponse.json() as { id: string };
  await expect(page).toHaveURL(/\/case\/[^/]+$/);
  const caseId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(caseId).toBe(createdCase.id);
  expect(failedCaseReadPath).toBe(`/api/cases/${caseId}`);
  await expect(page.getByRole('heading', { name: 'This case could not be reopened' })).toBeVisible();
  await expect(page.getByText('Failed to fetch')).toBeVisible();

  const retryResponsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'GET' && requestUrl.pathname === `/api/cases/${caseId}`;
  });
  await page.getByRole('button', { name: 'Try again' }).click();
  const retryResponse = await retryResponsePromise;
  expect(retryResponse.status()).toBe(200);
  const recoveredCase = await retryResponse.json() as { id: string };
  expect(recoveredCase.id).toBe(caseId);
  await expect(page.locator('#overview').getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Information still needed' })).toBeVisible();
});
