import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const narrative = 'My landlord has kept my security deposit since I moved out.';

function makeCase(id: string, statement: string) {
  return {
    id,
    title: 'Deposit return',
    initialStatement: statement,
    person: { name: null, contact: null },
    parties: [],
    facts: [{
      id: 'fact-statement',
      key: 'statement',
      value: statement,
      status: 'user_reported',
      confidence: 'high',
      sourceIds: [],
      provenance: [],
    }],
    events: [],
    evidence: [],
    documents: [],
    claims: [],
    jurisdiction: { country: null, state: null, district: null, city: null, locationText: null, basis: 'unknown' },
    legalIssues: [],
    intent: null,
    unknowns: ['Where did this happen?'],
    assumptions: [],
    conflicts: [],
    metadata: { createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z', language: 'english' },
    analysis: {
      safetyContext: {
        context: 'none', confidence: 'high', urgency: 'none', indicators: [], sourceIds: [], assessmentStatus: 'system_inferred',
      },
      legalKnowledge: { status: 'empty', records: [] },
      journey: {
        id: `journey-${id}`,
        caseId: id,
        currentSituation: statement,
        steps: [],
        unknowns: [],
        requiredEvidence: [],
        possiblePaths: [],
        requiredDocuments: [],
        nextActions: [],
        escalationPoints: [],
        jurisdictionStatus: 'unknown',
        legalKnowledgeStatus: 'empty',
      },
      decisionScenario: null,
    },
  };
}

async function mockApi(page: Page, caseReadDelayMs = 0) {
  const createdRequests: Array<{ initialStatement: string; inputMethod?: string; language: string | null }> = [];
  const createdCaseIds: string[] = [];
  const uploadedDocuments: string[] = [];
  let caseId = randomUUID();
  let caseState = makeCase(caseId, narrative);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/api/cases/voice/status') {
      await route.fulfill({ json: { speechToTextAvailable: true, languageDetectorAvailable: true } });
      return;
    }

    if (pathname === '/api/cases/voice/preview' && request.method() === 'POST') {
      const { transcript } = request.postDataJSON() as { transcript: string };
      await route.fulfill({ json: { status: 'success', transcript, language: 'english', caseState: makeCase('voice-preview', transcript) } });
      return;
    }

    if (pathname === '/api/cases' && request.method() === 'POST') {
      const body = request.postDataJSON() as { initialStatement: string; inputMethod?: string; language: string | null };
      createdRequests.push(body);
      caseId = randomUUID();
      createdCaseIds.push(caseId);
      caseState = makeCase(caseId, body.initialStatement);
      caseState.metadata.language = body.language ?? 'english';
      await route.fulfill({ status: 201, json: caseState });
      return;
    }

    if (pathname === `/api/cases/${caseId}/documents` && request.method() === 'POST') {
      uploadedDocuments.push(pathname);
      await route.fulfill({ status: 201, json: { caseId, documentId: 'document-1', processingStatus: 'extracted' } });
      return;
    }

    if (pathname === `/api/cases/${caseId}/clarification`) {
      await route.fulfill({ json: {
        case_id: caseId,
        questions: [{
          id: 'question-location',
          case_id: caseId,
          category: 'jurisdiction',
          target: 'location',
          question: 'Where did this happen?',
          language: 'english',
          priority: 1,
          sources: [{
            source_id: 'case-unknown-location',
            source_type: 'case_state',
            source_path: 'unknowns[0]',
            text: 'Where did this happen?',
            priority: 'high',
          }],
        }],
      } });
      return;
    }

    if (pathname === `/api/cases/${caseId}` && request.method() === 'GET') {
      if (caseReadDelayMs) await new Promise((resolve) => setTimeout(resolve, caseReadDelayMs));
      await route.fulfill({ json: caseState });
      return;
    }

    await route.fulfill({ json: {} });
  });

  return { createdRequests, createdCaseIds, uploadedDocuments };
}

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tell me what happened.' })).toBeVisible();
}

test('homepage has three clear entry points, including case-free safety and official women’s law resources', async ({ page }) => {
  await page.goto('/');
  const startCase = page.getByRole('link', { name: 'Start / Continue My Case', exact: true });
  const safety = page.getByRole('link', { name: /Women & Safety/ });
  const womenLaws = page.getByRole('link', { name: /Women & Laws/ });
  await expect(startCase).toHaveAttribute('href', '#your-story');
  await expect(safety).toHaveAttribute('href', '/women-safety');
  await expect(womenLaws).toHaveAttribute('href', '/women-laws');

  await startCase.click();
  await expect(page.getByRole('heading', { name: 'Your cases this session' })).toBeVisible();

  await safety.click();
  await expect(page).toHaveURL('/women-safety');
  await expect(page.getByRole('heading', { name: 'Women & Safety' })).toBeVisible();
  await expect(page.getByText(/No case needed/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Call emergency response at 112/ })).toBeVisible();

  await page.goto('/women-laws');
  await expect(page.getByRole('heading', { name: /Women's rights, with sources and open questions in view/ })).toBeVisible();
  const officialLaw = page.getByRole('link', { name: 'Open official source', exact: true }).first();
  await expect(officialLaw).toHaveAttribute('href', 'https://indiacode.gov.in/handle/123456789/496007');
  await expect(officialLaw).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: 'Legal aid information' })).toHaveAttribute('href', 'https://nalsa.gov.in/promoting-inclusive-legal-system/');
});

test('home links keep URL history and examples accept typing on the first click', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page);
  await openHome(page);

  await page.getByRole('link', { name: 'How it works' }).click();
  await expect(page).toHaveURL(/#pathway$/);
  await expect(page.getByRole('heading', { name: 'From a story to a next step.' })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/#pathway$/);
  await page.goForward();
  await expect(page).toHaveURL(/#pathway$/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');

  await page.getByRole('link', { name: 'Examples' }).click();
  await page.locator('details.examplesDisclosure > summary').click();
  await page.getByRole('button', { name: 'Begin with this' }).first().click();
  const statement = page.locator('#case-statement');
  await expect(statement).toBeFocused();
  await page.keyboard.type(' Addendum.');
  await expect(statement).toHaveValue(/Addendum\.$/);
  expect(await page.locator('.revealFour').first().evaluate((element) => getComputedStyle(element).animationDelay)).toBe('0s');
});

test('text input creates the case, shows loading, derives Guide state, and survives refresh', async ({ page }) => {
  const { createdRequests, createdCaseIds } = await mockApi(page, 1200);
  await openHome(page);

  const statement = page.locator('#case-statement');
  await statement.fill(narrative);
  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  const working = page.getByRole('button', { name: 'Working on your case…' });
  await expect(working).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();
  const intakeGuidePresence = page.locator('.intakeGuidePresence');
  await expect(intakeGuidePresence).toHaveAttribute('data-state', 'CLARIFYING');
  await expect(intakeGuidePresence).toHaveAttribute('aria-label', 'Clarifying a detail. clarification required');
  await expect(page.getByRole('heading', { name: 'Unknown', exact: true })).toBeVisible();
  await expect(page.getByText('Where did this happen?', { exact: true })).toBeVisible();
  const continueToQuestions = page.getByRole('button', { name: 'Continue to guided questions' });
  await expect(continueToQuestions).toBeEnabled();
  expect(createdRequests).toHaveLength(1);
  expect(createdRequests[0]).toMatchObject({ initialStatement: narrative, inputMethod: 'text' });
  const caseId = createdCaseIds[0];
  expect(caseId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  await continueToQuestions.click();
  await expect(page).toHaveURL(`/case/${caseId}`);
  await expect(page.getByRole('heading', { name: 'Let’s fill in one detail at a time.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where did this happen?' })).toBeVisible();
  const clarificationAnswer = page.getByLabel('Your answer');
  await clarificationAnswer.fill('Uttarakhand');
  await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeEnabled();

  await page.goto('/');
  await page.reload();
  const caseLink = page.getByRole('link', { name: /Deposit return/ });
  await expect(caseLink).toBeVisible();
  await caseLink.click();
  await expect(page).toHaveURL(`/case/${caseId}`);
  await expect(page.locator('#overview').getByText(narrative, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#overview').getByText(narrative, { exact: true })).toBeVisible();
});

test('speak mode reviews an editable transcript before creating a voice case', async ({ page }) => {
  const { createdRequests } = await mockApi(page);
  await openHome(page);

  await page.getByRole('radio', { name: /Speak/ }).click();
  const statement = page.locator('#case-statement');
  await statement.fill('I spoke this statement and reviewed the transcript.');
  await page.getByRole('button', { name: 'Review spoken statement' }).click();
  await expect(page.getByText('Transcript reviewed')).toBeVisible();
  await page.getByRole('button', { name: 'Create my case' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();
  expect(createdRequests).toHaveLength(1);
  expect(createdRequests[0]).toMatchObject({ initialStatement: 'I spoke this statement and reviewed the transcript.', inputMethod: 'voice' });
});

test('upload mode accepts a supported document with context and rejects empty or malformed input', async ({ page }) => {
  const { createdRequests, createdCaseIds, uploadedDocuments } = await mockApi(page);
  await openHome(page);

  await page.getByRole('radio', { name: /Upload/ }).click();
  const fileInput = page.getByLabel('Choose a PDF, JPG, or PNG document');
  await fileInput.setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await expect(page.locator('p[role="alert"]')).toContainText('This file is empty');
  expect(createdRequests).toHaveLength(0);

  await fileInput.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('unsupported') });
  await expect(page.locator('p[role="alert"]')).toContainText('Unsupported file type');
  expect(createdRequests).toHaveLength(0);

  await page.locator('#case-statement').fill('I received a notice and want to understand it.');
  await fileInput.setInputFiles({ name: 'notice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();
  const caseId = createdCaseIds[0];
  expect(createdRequests).toHaveLength(1);
  expect(createdRequests[0].inputMethod).toBe('text');
  expect(uploadedDocuments).toEqual([`/api/cases/${caseId}/documents`]);
});

test('empty statements do not create a case and mobile review fits the viewport', async ({ page }) => {
  const { createdRequests, createdCaseIds } = await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);

  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Please describe your situation');
  expect(createdRequests).toHaveLength(0);
  await page.locator('#case-statement').fill(narrative);
  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();

  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await expect(page.locator('.intakeGuidePresence')).toBeVisible();
  const caseId = createdCaseIds[0];
  await page.getByRole('button', { name: 'Continue to guided questions' }).click();
  await expect(page).toHaveURL(`/case/${caseId}`);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(`/case/${caseId}`);
  await expect(page.locator('#overview').getByText(narrative, { exact: true })).toBeVisible();
});
