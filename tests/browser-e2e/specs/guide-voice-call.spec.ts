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

test('Guide voice input is turn-based, editable, and explicitly confirmed before the response', async ({ page }) => {
  let guideChatRequests = 0;
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/guide/chat') {
      guideChatRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'I heard your statement. When did the unpaid salary first become due? This remains a draft until you review and confirm it.',
          status: 'ok',
          model: 'test-local-model',
        }),
      });
      return;
    }
    const response = await fetchFromIsolatedApi(route);
    await route.fulfill({ response });
  });
  await page.addInitScript(() => {
    let recognitionCount = 0;
    class MockRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        this.onstart?.();
        if (recognitionCount++ !== 0) return;
        setTimeout(() => {
          const result = {
            0: { transcript: 'My employer is withholding two months of salary.' },
            isFinal: true,
            length: 1,
          };
          this.onresult?.({ results: [result] });
          this.onend?.();
        }, 25);
      }

      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }

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

    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: MockRecognition });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        getVoices() { return []; },
        speak(utterance: MockUtterance) {
          setTimeout(() => utterance.onstart?.(), 0);
          setTimeout(() => utterance.onend?.(), 20);
        },
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockUtterance });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
  });

  const caseId = await enterCase(page);
  await page.goto(`/case/${caseId}/voice`);
  const conversation = page.locator('[aria-label="Guide voice and text conversation"]');
  await expect(conversation.getByRole('button', { name: 'Tap to speak', exact: true })).toBeVisible();
  await expect(conversation).toContainText('Desktop browser speech may use that browser’s configured provider.');

  await conversation.getByRole('button', { name: 'Tap to speak', exact: true }).click();
  const transcriptReview = conversation.getByLabel('Recognized words · review before sending');
  await expect(transcriptReview).toHaveValue('My employer is withholding two months of salary.');
  await expect(conversation.locator('.ls-guide-call__conversationState')).toContainText('Transcript ready for review');
  expect(guideChatRequests).toBe(0);
  await expect(conversation.getByRole('button', { name: 'Confirm transcript and send to Guide' })).toBeVisible();
  await expect(conversation).toContainText('This transcript has not been sent to the Guide or added as a case statement.');
  await transcriptReview.fill('My employer is withholding two months of salary since August.');
  await conversation.getByRole('button', { name: 'Confirm transcript and send to Guide' }).click();
  await expect.poll(() => guideChatRequests).toBe(1);
  await expect(conversation).toContainText('You · recognized speech');
  await expect(conversation).toContainText('My employer is withholding two months of salary since August.');
  await expect(conversation.locator('[data-speaker="guide"]').last()).toContainText('When did the unpaid salary first become due?');
  await expect(conversation.locator('[data-speaker="guide"]').last()).toContainText(/draft|ड्राफ़्ट/i);
  await expect(conversation).toContainText(/Speaking now|Spoken aloud/);
  await expect(page.locator('#voice-transcript')).toHaveValue(/My employer is withholding two months of salary since August/);
  await expect(conversation.locator('.ls-guide-call__conversationState')).toContainText('Ready for another turn');
  await expect(conversation.getByRole('button', { name: 'Speak to Guide', exact: true })).toBeVisible();
  await expect(conversation.getByRole('button', { name: 'Stop listening', exact: true })).toHaveCount(0);

  await conversation.getByRole('button', { name: 'End voice mode', exact: true }).click();
  await expect(conversation.locator('.ls-guide-call__conversationState')).toContainText('Voice mode ended');
  await expect(page.locator('#voice-transcript')).toHaveValue(/My employer is withholding two months of salary since August/);
});

test('the Guide presents an unavailable-model response and keeps typed text unconfirmed', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/guide/chat') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'The local assistant model is not available. Please check the installed Ollama model and try again.',
          status: 'unavailable',
          model: 'test-local-model',
        }),
      });
      return;
    }
    const response = await fetchFromIsolatedApi(route);
    await route.fulfill({ response });
  });

  const caseId = await enterCase(page);
  await page.goto(`/case/${caseId}/voice`);
  const conversation = page.locator('[aria-label="Guide voice and text conversation"]');
  await conversation.getByLabel('Type a message instead').fill('Please ask me one factual follow-up.');
  await conversation.getByRole('button', { name: 'Send typed message' }).click();

  await expect(conversation.locator('[data-speaker="guide"]').last()).toContainText('local assistant model is not available');
  await expect(page.locator('#voice-transcript')).toHaveValue('Please ask me one factual follow-up.');
  await expect(page.getByRole('button', { name: 'Review transcript' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Confirm and add statement' })).toHaveCount(0);
});

test('Guide text remains available when the browser has no speech output service', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {} } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined });
  });
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/guide/chat') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'I heard you. What happened first? This remains a draft for your review.',
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
  await page.goto(`/case/${caseId}/voice`);
  const conversation = page.locator('[aria-label="Guide voice and text conversation"]');
  await conversation.getByLabel('Type a message instead').fill('Please ask me what happened first.');
  await conversation.getByRole('button', { name: 'Send typed message' }).click();

  await expect(conversation.locator('[data-speaker="guide"]').last()).toContainText('What happened first?');
  await expect(conversation).toContainText('Speech output unavailable · text remains available');
  await expect(conversation).toContainText('Guide replies remain readable in the transcript');
});

test('live Guide text reaches the local Qwen-backed API and renders its reply', async ({ page }) => {
  test.skip(process.env.LAWSENSE_E2E_REAL_OLLAMA !== '1', 'Set LAWSENSE_E2E_REAL_OLLAMA=1 to exercise the installed local model.');
  test.setTimeout(90_000);

  const caseId = await enterCase(page);
  await page.goto(`/case/${caseId}/voice`);
  const conversation = page.locator('[aria-label="Guide voice and text conversation"]');
  const message = 'Please reply in English with one short clarifying question about what happened first.';
  const responsePromise = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return response.request().method() === 'POST' && requestUrl.pathname === '/api/guide/chat';
  });
  await conversation.getByLabel('Type a message instead').fill(message);
  await conversation.getByRole('button', { name: 'Send typed message' }).click();

  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json() as { reply: string; status: string; model: string };
  expect(body.status).toBe('ok');
  expect(body.model).toBe('qwen3.5:4b-q4_K_M');
  expect(body.reply.trim().length).toBeGreaterThan(0);
  expect(body.reply).not.toMatch(/<\/?(?:think|analysis|reasoning)>/i);
  await expect(conversation.locator('[data-speaker="guide"]').last()).toContainText(body.reply);
  await expect(conversation).toContainText(/Speaking now|Spoken aloud|Speech output unavailable|Could not play aloud/, { timeout: 15_000 });
  await expect(page.locator('#voice-transcript')).toHaveValue(message);
  await expect(page.getByRole('button', { name: 'Review transcript' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Confirm and add statement' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Review transcript' }).click();
  await expect(page.getByRole('heading', { name: 'Review the extracted details' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to confirmation' }).click();
  await expect(page.getByRole('button', { name: 'Confirm and add statement' })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm and add statement' }).click();
  await expect(page.getByText('Confirmed and added to the case.')).toBeVisible();
});
