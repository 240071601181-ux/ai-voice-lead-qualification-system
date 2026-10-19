import fs from 'node:fs';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

type E2EState = {
  adminEmail: string;
  userEmail: string;
  leadId: string;
  password: string;
};

const loadState = (): E2EState => {
  const stateFile = 'test-results/e2e-state.json';
  if (!fs.existsSync(stateFile)) {
    throw new Error('E2E setup state is missing; run the suite through Playwright, not this file directly.');
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as E2EState;
};

async function apiLogin(api: APIRequestContext, email: string): Promise<string> {
  const state = loadState();
  const response = await api.post('http://localhost:4000/api/v1/auth/login', {
    data: { email, password: state.password },
    timeout: 15000,
  });

  const body = await response.text();
  const contentType = response.headers()['content-type'] ?? 'unknown';

  if (!response.ok()) {
    throw new Error(
      `API login failed: HTTP ${response.status()}; ` +
      `content-type=${contentType}; body=${body.slice(0, 500)}`
    );
  }

  let payload: { data?: { accessToken?: unknown } };
  try {
    payload = JSON.parse(body) as { data?: { accessToken?: unknown } };
  } catch {
    throw new Error(
      `API login returned non-JSON: HTTP ${response.status()}; ` +
      `content-type=${contentType}; body=${body.slice(0, 300)}`
    );
  }

  const token = payload?.data?.accessToken;
  if (typeof token !== 'string' || !token) {
    throw new Error(`API login response has no access token: ${body.slice(0, 300)}`);
  }
  return token;
}

async function loginInBrowser(page: Page, email: string): Promise<void> {
  const state = loadState();
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.locator('#auth-password').fill(state.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  try {
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 });
  } catch {
    const alerts = await page.getByRole('alert').allTextContents().catch(() => []);
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `Browser login failed. URL=${page.url()}; ` +
      `alert=${alerts.join(' | ') || '(none)'}; page=${body.slice(0, 500)}`
    );
  }
}

test.describe('MadLead real-service browser verification', () => {
  test('ADMIN login, dashboard, admin route, responsive shell, and logout', async ({ page }) => {
    const state = loadState();
    await loginInBrowser(page, state.adminEmail);
    const dashboardHeading = page.getByRole('heading').first();
if (!(await dashboardHeading.count())) {
  const pageText = await page.locator('body').innerText().catch(() => '');
  throw new Error(
    `Dashboard route rendered no heading. URL=${page.url()}; page=${pageText.slice(0, 800)}`
  );
}
await expect(dashboardHeading).toBeVisible();
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth < 768) {
      await expect(page.getByRole('button', { name: /open navigation/i })).toBeVisible();
    }
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.goto('/profile');
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.getByRole('button', { name: /sign out/i }).last().click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('USER sees shared work and is denied admin-only pages', async ({ page }) => {
    const state = loadState();
    await loginInBrowser(page, state.userEmail);
    await page.goto('/leads');
    await expect(page.getByRole('heading', { name: /leads/i })).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByText(/not authorized|insufficient permissions|admin/i).first()).toBeVisible();
    await page.goto('/profile');
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.getByRole('button', { name: /sign out/i }).last().click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('invalid credentials and invalid session never expose protected UI', async ({ page }) => {
    const state = loadState();
    await page.goto('/login');
    await page.getByLabel('Work email').fill(state.userEmail);
    await page.locator('#auth-password').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid email or password/i);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('lead, conversation qualification, follow-up, and dashboard records use real APIs', async ({ page, request: api }) => {
    const state = loadState();
    const token = await apiLogin(api, state.adminEmail);
    const lead = await api.post('http://localhost:4000/api/v1/leads', {
      headers: { Authorization: `Bearer ${token}` },
      data: { source: 'e2e', name: 'Browser Qualification Lead', phone: '+919999000002', email: `e2e-${Date.now()}@example.test` },
    });
    expect(lead.ok()).toBeTruthy();
    const leadId = (await lead.json()).data.id as string;
    const conversation = await api.post('http://localhost:4000/api/v1/conversations', {
      headers: { Authorization: `Bearer ${token}` },
      data: { leadId, channel: 'web' },
    });
    expect(conversation.ok()).toBeTruthy();
    const conversationId = (await conversation.json()).data.id as string;

    await loginInBrowser(page, state.adminEmail);
    await page.goto(`/leads/${leadId}`);
    await expect(page.getByRole('heading', { name: /browser qualification lead/i })).toBeVisible();
    await page.goto(`/conversations/${conversationId}`);
    await expect(page.getByRole('heading', { name: /conversation|browser qualification lead/i }).first()).toBeVisible();

    const message = await api.post(`http://localhost:4000/api/v1/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `e2e-${Date.now()}` },
      data: { content: 'Pickup Chennai, destination Bengaluru, truck, 500 kg, budget 15000, needed tomorrow.' },
      timeout: 180_000,
    });
    expect(message.ok()).toBeTruthy();
    const qualification = await api.post(`http://localhost:4000/api/v1/conversations/${conversationId}/qualification`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(qualification.ok()).toBeTruthy();
    expect((await qualification.json()).data.conversation_id).toBe(conversationId);

    const followup = await api.post('http://localhost:4000/api/v1/followups/schedule', {
      headers: { Authorization: `Bearer ${token}` },
      data: { leadId, action: 'crm_followup' },
    });
    const followupBody = await followup.text();
    if (!followup.ok()) {
      throw new Error(
        `POST /api/v1/followups/schedule failed: HTTP ${followup.status()}; ` +
        `body=${followupBody.slice(0, 800)}`
      );
    }
    const followupPayload = JSON.parse(followupBody);
    expect(followupPayload.data.lead_id).toBe(leadId);
    const dashboard = await api.get('http://localhost:4000/api/v1/dashboard/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(dashboard.ok()).toBeTruthy();
    expect((await dashboard.json()).data.leads.total).toBeGreaterThan(0);
  });

  test('public customer chat session is isolated and failed API state is truthful', async ({ browser, request: api }) => {
    const state = loadState();
    const token = await apiLogin(api, state.adminEmail);
    const conversation = await api.post('http://localhost:4000/api/v1/conversations', {
      headers: { Authorization: `Bearer ${token}` },
      data: { leadId: state.leadId, channel: 'web' },
    });
    const conversationId = (await conversation.json()).data.id as string;
    const share = await api.post(`http://localhost:4000/api/v1/conversations/${conversationId}/customer-access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(share.ok()).toBeTruthy();
    const shareUrl = (await share.json()).data.url as string;
    const rawToken = shareUrl.split('/chat/')[1];

    const customer = await browser.newPage();
    await customer.goto(`/chat/${rawToken}`);
    await expect(customer.getByRole('heading', { name: /shipment assistant/i })).toBeVisible();
    await customer.getByPlaceholder(/type your message/i).fill('Hello, I need a supported test shipment quote.');
    await customer.getByRole('button', { name: /send/i }).click();
    await expect(customer.getByText(/Hello, I need a supported test shipment quote/i)).toBeVisible({ timeout: 90000 });

    const isolated = await browser.newPage();
    await isolated.goto('/chat');
    await expect(isolated.getByText(/invalid, expired, or revoked|authentication required/i)).toBeVisible();
    await customer.close();
    await isolated.close();
  });

  test('backend failure renders an error state instead of a fabricated success', async ({ page }) => {
    const state = loadState();
    await loginInBrowser(page, state.adminEmail);
    await page.route('**/api/v1/leads*', (route) => route.abort('failed'));
    await page.goto('/leads');
    await expect(page.getByText(/couldn.t load|something went wrong|retry/i).first()).toBeVisible();
  });
});
