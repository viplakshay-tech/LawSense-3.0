import { expect, test, type Route } from '@playwright/test';

const initialStatement = 'My employer has not paid the agreed salary for two months.';

async function fetchFromIsolatedApi(route: Route) {
  const target = new URL(route.request().url());
  target.port = '8001';
  target.pathname = target.pathname.replace(/^\/api(?=\/|$)/, '');
  return route.fetch({ url: target.toString() });
}

async function enterCase(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await page.locator('textarea').fill(initialStatement);
  await page.getByRole('button', { name: 'Continue with this statement' }).click();
  await expect(page.getByRole('heading', { name: 'Here’s what I understood.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to guided questions' }).click();
  await expect(page).toHaveURL(/\/case\/[^/]+$/);
  return new URL(page.url()).pathname.split('/').at(-1)!;
}

test('Guide text and voice modes share the same case-scoped conversation across routes', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/guide/chat') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'I can help clarify the timeline. When was the first salary payment due?',
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
  await page.getByRole('button', { name: 'Expand Guide control surface' }).click();

  const guidePanel = page.getByRole('complementary', { name: 'LawSense Guide control surface' });
  await guidePanel.getByLabel('Message your Guide').fill('Help me understand what information is missing.');
  await guidePanel.getByRole('button', { name: 'Send to local Guide' }).click();
  await expect(guidePanel.getByRole('log', { name: 'Guide conversation' })).toContainText('Help me understand what information is missing.');
  await expect(guidePanel.getByRole('log', { name: 'Guide conversation' })).toContainText('When was the first salary payment due?');

  await guidePanel.getByRole('button', { name: 'Voice' }).last().click();
  await expect(page).toHaveURL(`/case/${caseId}/voice`);

  const voiceConversation = page.getByRole('log', { name: 'Voice conversation transcript' });
  await expect(voiceConversation).toContainText('Help me understand what information is missing.');
  await expect(voiceConversation).toContainText('When was the first salary payment due?');
  await expect(page.getByLabel('Type a message instead')).toBeEnabled();

  await page.reload();
  const restoredConversation = page.getByRole('log', { name: 'Voice conversation transcript' });
  await expect(restoredConversation).toContainText('Help me understand what information is missing.');
  await expect(restoredConversation).toContainText('When was the first salary payment due?');
});
