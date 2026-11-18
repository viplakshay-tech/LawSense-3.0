import { expect, test, type Page, type Route } from '@playwright/test';

const initialStatement = 'My employer has not paid the agreed salary for two months.';

async function fetchFromIsolatedApi(route: Route) {
  const target = new URL(route.request().url());
  target.port = '8001';
  target.pathname = target.pathname.replace(/^\/api(?=\/|$)/, '');
  return route.fetch({ url: target.toString() });
}

async function enterCase(page: Page): Promise<string> {
  await page.goto('/');
  await page.locator('textarea').fill(initialStatement);
  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to guided questions' }).click();
  await expect(page).toHaveURL(/\/case\/[^/]+$/);
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

test('dedicated consultation is immersive, case-scoped, and microphone-silent until requested', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, getVoices() { return []; }, speak() {} },
    });
    class MockUtterance {
      lang = '';
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(readonly text: string) {}
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockUtterance });
    Object.defineProperty(window, '__micRequests', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          (window as Window & { __micRequests: number }).__micRequests += 1;
          return { getTracks: () => [{ stop() {} }] };
        },
      },
    });
  });

  const caseId = await enterCase(page);
  await page.goto(`/case/${caseId}/consultation`);

  await expect(page).toHaveURL(`/case/${caseId}/consultation`);
  await expect(page.getByRole('heading', { name: 'Talk to your AI lawyer' })).toBeVisible();
  await expect(page.getByText('PRIVATE CONSULTATION', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Guide voice and text conversation' })).toBeVisible();
  await expect(page.locator('.ls-guide-presence__presence')).toHaveAttribute('data-state', 'CLARIFYING');
  await expect(page.locator('.ls-case-rail')).toBeHidden();
  await expect(page.locator('.ls-case-topbar')).toBeHidden();
  await expect(page.locator('.ls-case-context')).toBeHidden();
  await expect(page.locator('.ls-case-mobile-dock')).toBeHidden();
  await expect(page.locator('#voice-transcript')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __micRequests: number }).__micRequests)).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Talk to your AI lawyer' })).toBeVisible();
  await expect(page.locator('#voice-transcript')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Guide voice and text conversation' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __micRequests: number }).__micRequests)).toBe(0);
});

test('consultation text turns continue in the existing case Guide session', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, getVoices() { return []; }, speak() {} },
    });
    class MockUtterance {
      lang = '';
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(readonly text: string) {}
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockUtterance });
  });

  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/guide/chat') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'I understand. When did the first missed salary payment happen?',
          status: 'ok',
          model: 'test-local-model',
        }),
      });
      return;
    }
    const response = await fetchFromIsolatedApi(route);
    await route.fulfill({ response });
  });

  const caseId = await enterCase(page);
  await page.goto(`/case/${caseId}/consultation`);
  const conversation = page.getByRole('region', { name: 'Guide voice and text conversation' });
  await conversation.getByLabel('Type a message instead').fill('I first noticed the missing salary in September.');
  await conversation.getByRole('button', { name: 'Send typed message' }).click();

  const consultationLog = page.getByRole('log', { name: 'Voice conversation transcript' });
  await expect(consultationLog).toContainText('I first noticed the missing salary in September.');
  await expect(consultationLog).toContainText('When did the first missed salary payment happen?');

  await page.goto(`/case/${caseId}/voice`);
  const existingVoiceLog = page.getByRole('log', { name: 'Voice conversation transcript' });
  await expect(existingVoiceLog).toContainText('I first noticed the missing salary in September.');
  await expect(existingVoiceLog).toContainText('When did the first missed salary payment happen?');
});
