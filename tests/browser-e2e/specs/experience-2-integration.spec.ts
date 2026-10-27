import { expect, test, type Page, type Route } from '@playwright/test';

const initialStatement = 'My employer has not paid the agreed salary for two months.';

function caseApiUrl(page: Page, caseId: string): string {
  return new URL(`/api/cases/${caseId}`, page.url()).toString();
}

async function fetchFromIsolatedApi(route: Route) {
  const target = new URL(route.request().url());
  target.port = '8001';
  target.pathname = target.pathname.replace(/^\/api(?=\/|$)/, '');
  return route.fetch({ url: target.toString() });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const response = await fetchFromIsolatedApi(route);
    await route.fulfill({ response });
  });
});

async function enterCase(page: Page, statement = initialStatement): Promise<string> {
  await page.goto('/');
  await page.locator('textarea').fill(statement);
  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to guided questions' }).click();
  await expect(page).toHaveURL(/\/case\/[^/]+$/);
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

test('case and Legal Twin show source-linked law candidates without a score cutoff or invented filing route', async ({ page }) => {
  const caseId = await enterCase(page, 'I bought a defective phone, asked the seller for a refund, and the seller refused.');
  const lawPanel = page.getByRole('region', { name: 'Law guidance from recorded facts and sources' });

  await expect(lawPanel).toContainText('Consumer Protection Act, 2019');
  await expect(lawPanel).toContainText('Section 2(10)');
  await expect(lawPanel).toContainText('No numeric score or cutoff is used.');
  await expect(lawPanel).toContainText('user reported');
  await expect(lawPanel).toContainText('No verified deadline was found in linked procedure records.');
  await expect(lawPanel).toContainText('No verified procedure or filing link was found in the linked records.');
  await expect(lawPanel).toContainText('Official legal publications');

  await page.goto(`/case/${caseId}/twin`);
  const twinLawPanel = page.getByRole('region', { name: 'Legal grounding' });
  await expect(twinLawPanel).toContainText('Consumer Protection Act, 2019');
  await expect(twinLawPanel).toContainText('Section 2(10)');
});

test('Guide actions follow the shared runtime and intake provenance stays explicit in the Evidence Map', async ({ page }) => {
  const caseId = await enterCase(page);
  const navigation = page.getByRole('navigation', { name: 'Case workspace' });

  await navigation.getByRole('link', { name: 'Law', exact: true }).click();
  await expect(page).toHaveURL(`/case/${caseId}/guide`);
  const clarificationAction = page.getByRole('button', { name: 'Answer an open case question' });
  await expect(clarificationAction).toBeVisible();
  await clarificationAction.click();
  await expect(page).toHaveURL(`/case/${caseId}#clarification`);

  await navigation.getByRole('link', { name: 'Evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evidence Map', exact: true })).toBeVisible();
  const intakeSource = page.getByText('CASE_INTAKE · USER_REPORTED').first();
  await intakeSource.scrollIntoViewIfNeeded();
  await expect(intakeSource).toBeVisible();
  await expect(page.getByText('Initial statement source')).toHaveCount(0);
  await expect(page.getByText('Source record', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Evidence-supported', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conflicting', exact: true })).toBeVisible();
});

test('the case journey keeps Monitor & Update together and leaves the journey overview unselected', async ({ page }) => {
  const caseId = await enterCase(page);
  const navigation = page.getByRole('navigation', { name: 'Case workspace' });

  const updateStage = navigation.getByRole('link', { name: 'Monitor & Update', exact: true });
  await expect(updateStage).toHaveAttribute('href', `/case/${caseId}/action#update`);
  await expect(updateStage).toContainText('Available');
  await updateStage.click();

  await expect(page).toHaveURL(`/case/${caseId}/action#update`);
  await expect(page.getByRole('heading', { name: 'Add information when something changes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a new statement' })).toHaveAttribute('href', `/case/${caseId}/voice`);
  await expect(navigation.getByRole('link', { name: 'Monitor & Update', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('link', { name: 'Return to case journey', exact: true }).click();
  await expect(page).toHaveURL(`/case/${caseId}#journey`);
  await expect(page.getByText('Your case journey', { exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Monitor & Update', exact: true })).not.toHaveAttribute('aria-current', 'page');
});

test('a synthetic workplace-harassment case can revisit every stage without page visits completing work', async ({ page }) => {
  const scenario = 'SYNTHETIC TEST ONLY: At a fictional workplace in Pune, a coworker sent repeated unwanted sexual messages after I asked them to stop on 8 October 2026. I saved screenshots and asked the workplace contact for help. I want to understand safety options and what information is still unknown.';
  const caseId = await enterCase(page, scenario);
  const navigation = page.getByRole('navigation', { name: 'Case workspace' }).first();
  const stageLinks = navigation.locator('a[data-stage-status]');
  await expect(stageLinks).toHaveCount(9);
  await expect(page.locator('#overview').getByText(scenario, { exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Understand', exact: true })).toHaveAttribute('aria-current', 'page');
  const statusesBefore = await stageLinks.evaluateAll((links) => links.map((link) => link.getAttribute('data-stage-status')));

  const stages = [
    { name: 'Clarify', href: `/case/${caseId}#clarification` },
    { name: 'Protect', href: `/case/${caseId}/safety` },
    { name: 'Evidence', href: `/case/${caseId}/documents` },
    { name: 'Law', href: `/case/${caseId}/guide` },
    { name: 'Legal Twin', href: `/case/${caseId}/twin` },
    { name: 'Prepare', href: `/case/${caseId}/draft` },
    { name: 'Act', href: `/case/${caseId}/action` },
    { name: 'Monitor & Update', href: `/case/${caseId}/action#update` },
  ];

  for (const stage of stages) {
    const link = navigation.getByRole('link', { name: stage.name, exact: true });
    await link.click();
    await expect(page).toHaveURL(stage.href);
    await expect(link).toHaveAttribute('aria-current', 'page');
  }

  await navigation.getByRole('link', { name: 'Understand', exact: true }).click();
  await expect(page).toHaveURL(`/case/${caseId}`);
  await expect(page.locator('#overview').getByText(scenario, { exact: true })).toBeVisible();
  const statusesAfter = await stageLinks.evaluateAll((links) => links.map((link) => link.getAttribute('data-stage-status')));
  expect(statusesAfter).toEqual(statusesBefore);
  await expect(page.locator('.ls-case-context-meta')).toContainText('of 9 stages complete');
});

test('user confirmation of a document reading stays separate from Evidence-supported status', async ({ page }) => {
  const caseId = await enterCase(page);
  await page.route(caseApiUrl(page, caseId), async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }

    const response = await fetchFromIsolatedApi(route);
    expect(response.ok()).toBe(true);

    const caseState = await response.json() as {
      facts: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
      documents: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(caseState.facts)).toBe(true);
    expect(Array.isArray(caseState.evidence)).toBe(true);
    expect(Array.isArray(caseState.documents)).toBe(true);
    caseState.documents.push({
      id: 'document-review-confirmed',
      filename: 'notice.png',
      mimeType: 'image/png',
      extension: '.png',
      fileSize: 128,
      sha256: 'fixture-hash',
      pageCount: 1,
      processingTimestamp: '2026-10-08T00:00:00Z',
      processingStatus: 'extracted',
      classification: 'unknown',
      classificationConfidence: 0,
      classificationSignals: [],
      pages: [{ pageNumber: 1, extractionMethod: 'OCR', processingStatus: 'extracted', textLength: 18 }],
      errors: [],
      reviewStatus: 'confirmed',
      confirmationHistory: [],
    });
    caseState.evidence.push({
      id: 'evidence-review-confirmed',
      type: 'document',
      title: 'Notice reading',
      source: 'document',
      status: 'evidence_supported',
      documentId: 'document-review-confirmed',
      extractedFacts: ['notice date'],
      supportsClaimIds: [],
      conflictsWithClaimIds: [],
      processingStatus: 'extracted',
    });
    caseState.facts.push({
      id: 'fact-review-confirmed',
      key: 'notice_date',
      value: '8 October 2026',
      status: 'evidence_supported',
      confidence: 'high',
      sourceIds: ['evidence-review-confirmed'],
      provenance: [{
        documentId: 'document-review-confirmed',
        pageNumber: 1,
        confidence: 0.95,
        status: 'evidence_supported',
        extractionMethod: 'OCR',
        source: 'document',
        confirmedByUser: true,
        confirmedAt: '2026-10-08T00:00:00Z',
      }],
    });
    await route.fulfill({ response, json: caseState });
  });

  await page.goto(`/case/${caseId}/documents`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Evidence Map', exact: true })).toBeVisible();
  await page.getByRole('button', {
    name: 'Confirmation status: Reading confirmed by user. Status: Review-confirmed. Select relationship details.',
  }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Review-confirmed', exact: true }).click();
  await expect(page.getByRole('button', {
    name: 'Confirmation status: Reading confirmed by user. Status: Review-confirmed. Select relationship details.',
  })).toBeVisible();
});

test('the Guide restores keyboard focus and the real Twin graph remains usable at 390 by 844', async ({ page }) => {
  const caseId = await enterCase(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNavigation = page.locator('.ls-case-mobile-dock nav');
  const widths = await mobileNavigation.evaluate((element) => ({
    visible: element.clientWidth,
    content: element.scrollWidth,
  }));
  expect(widths.content).toBeGreaterThan(widths.visible);
  await expect(mobileNavigation.getByRole('link', { name: 'Understand' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: 'Evidence' })).toHaveAttribute('aria-label', 'Evidence');
  const horizontalOverflow = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth) return [];
    const clippingOverflow = new Set(['auto', 'scroll', 'hidden', 'clip']);
    const elements = Array.from(document.querySelectorAll<HTMLElement>('body *'));
    return elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          element,
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          className: typeof element.className === 'string' ? element.className.slice(0, 180) : null,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          overflowX: style.overflowX,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      })
      .filter((item) => {
        if (item.width <= 0 || (item.left >= -1 && item.right <= window.innerWidth + 1)) return false;
        // Exclude descendants intentionally scrolled/clipped by an ancestor.
        // Keep the overflowing ancestor itself as a candidate.
        let parent = item.element.parentElement;
        while (parent && parent !== document.documentElement) {
          if (clippingOverflow.has(window.getComputedStyle(parent).overflowX)) return false;
          parent = parent.parentElement;
        }
        return true;
      })
      .sort((a, b) => Math.max(b.right - window.innerWidth, -b.left) - Math.max(a.right - window.innerWidth, -a.left))
      .slice(0, 12)
      .map(({ element: _element, ...item }) => item);
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    \`Unexpected horizontal page overflow at 390px: \${JSON.stringify(horizontalOverflow)}\`,
  ).toBe(true);

  const expandGuide = page.getByRole('button', { name: 'Expand Guide control surface' });
  await expandGuide.click();
  await page.keyboard.press('Escape');
  await expect(expandGuide).toHaveAttribute('aria-expanded', 'false');
  await expect(expandGuide).toBeFocused();

  await expandGuide.click();
  await mobileNavigation.getByRole('link', { name: 'Law', exact: true }).click();
  await expect(page).toHaveURL(`/case/${caseId}/guide`);
  await expect(expandGuide).toHaveAttribute('aria-expanded', 'false');
  await expect(expandGuide).toBeFocused();

  await mobileNavigation.getByRole('link', { name: 'Legal Twin' }).click();
  await expect(page).toHaveURL(`/case/${caseId}/twin`);
  const graph = page.getByRole('region', { name: 'Living Legal Twin CaseState projection' });
  await expect(graph).toBeVisible();
  await expect(graph.locator('svg').first()).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});

test('a case update marks a saved draft stale and blocks old fact reuse until source refresh', async ({ page }) => {
  const caseId = await enterCase(page);
  let mutateCaseRead = false;
  await page.route(caseApiUrl(page, caseId), async (route) => {
    if (mutateCaseRead && route.request().method() === 'GET') {
      const response = await fetchFromIsolatedApi(route);
      const changedCase = await response.json() as { initialStatement: string };
      changedCase.initialStatement = `${changedCase.initialStatement} This was added after the draft was reviewed.`;
      await route.fulfill({ response, json: changedCase });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/case/${caseId}/draft`);
  await expect(page.getByRole('heading', { name: 'Shape a clear first draft' })).toBeVisible();
  await page.getByPlaceholder('Recipient name or organization').fill('Human Resources');
  await page.getByPlaceholder('Your name').fill('Case user');
  await page.getByPlaceholder('Enter the date to use').fill('8 October 2026');
  await page.getByPlaceholder('A short description of this letter').fill('Unpaid salary');
  await page.getByPlaceholder('Briefly describe the purpose of this document').fill('Request a review of the unpaid salary.');
  await page.getByPlaceholder('Describe what you are asking for').fill('Please confirm when the salary will be paid.');
  await page.getByPlaceholder('Name to sign with').fill('Case user');
  await page.getByPlaceholder('Optional · add context that is not already listed above').fill('I would like a written response.');
  await page.getByRole('button', { name: 'I reviewed this draft' }).click();
  await expect(page.getByRole('button', { name: 'Download .txt' })).toBeEnabled();

  mutateCaseRead = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The case changed after this draft was prepared' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download .txt' })).toBeDisabled();
  await expect(page.getByLabel('Live document preview').locator('pre')).not.toContainText(initialStatement);

  await page.getByRole('button', { name: 'Review changes and refresh sources' }).click();
  await expect(page.getByRole('heading', { name: 'The case changed after this draft was prepared' })).toHaveCount(0);
  await expect(page.getByText('0 selected · unchecked details stay out of the draft')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download .txt' })).toBeDisabled();
});
