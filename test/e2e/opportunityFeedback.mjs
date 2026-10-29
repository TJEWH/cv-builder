/** AF-02 synthetic browser acceptance. Start Vite, then run this file with Node.
 * Optional PLAYWRIGHT_MODULE_PATH / PLAYWRIGHT_CHROMIUM_EXECUTABLE select an
 * already installed test runtime. No package installation or real account.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error('Use an installed Playwright runtime through PLAYWRIGHT_MODULE_PATH.', { cause: error });
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH);
}
const url = new URL(process.env.OPPORTUNITY_FEEDBACK_FIXTURE_URL ?? 'http://localhost:5177/cv-builder/test/browser/opportunity-feedback.html');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Browser acceptance may use only a local synthetic fixture.');
assert.ok(['/cv-builder/test/browser/opportunity-feedback.html', '/test/browser/opportunity-feedback.html'].includes(url.pathname));
const screenshotDirectory = join(tmpdir(), 'cv-opportunity-feedback-browser');
await mkdir(screenshotDirectory, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const results = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
    const externalRequests = [];
    await context.route('**/*', route => {
      const requestUrl = new URL(route.request().url());
      if (['localhost', '127.0.0.1'].includes(requestUrl.hostname)) return route.continue();
      externalRequests.push(requestUrl.origin);
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Search feedback', exact: true }).waitFor();
    const events = page.getByTestId('fixture-events');
    const summary = page.getByLabel('Summary for search feedback', { exact: true });
    const waitEvents = text => page.waitForFunction(expected => document.querySelector('[data-testid="fixture-events"]')?.textContent.includes(expected), text);
    assert.match(await events.innerText(), /Summary saves: 0; approvals: 0/);
    assert.match(await events.innerText(), /sharing: false/);

    await summary.fill('Prefer physical sensing prototypes.');
    await summary.press('Shift+Enter');
    assert.equal(await summary.inputValue(), 'Prefer physical sensing prototypes.\n');
    await summary.dispatchEvent('compositionstart');
    await summary.press('Enter');
    assert.match(await events.innerText(), /Summary saves: 0; approvals: 0/);
    await summary.dispatchEvent('compositionend');
    await summary.fill('Prefer physical sensing prototypes.');
    await page.getByLabel('Interest override (0–10)', { exact: true }).click();
    await waitEvents('Summary saves: 1; approvals: 0');
    assert.match(await events.innerText(), /approved: false/);

    await page.getByRole('button', { name: 'Approve for search feedback', exact: true }).click();
    await waitEvents('approvals: 1;');
    await waitEvents('approved: true');
    assert.match(await events.innerText(), /sharing: false/);

    await summary.fill('Prefer acoustic sensing experiments.');
    await summary.press('Enter');
    await waitEvents('Summary saves: 2;');
    await waitEvents('approved: false');
    await page.getByRole('button', { name: 'Approve for search feedback', exact: true }).click();
    await waitEvents('approvals: 2;');
    await page.getByLabel('Personal evaluation — private', { exact: true }).fill('Synthetic private update: private@example.invalid.');
    await page.getByLabel('Personal evaluation — private', { exact: true }).press('Enter');
    await waitEvents('approved: false');
    assert.equal(await page.getByLabel('Personal evaluation — private', { exact: true }).inputValue(), 'Synthetic private update: private@example.invalid.');
    await page.getByRole('button', { name: 'Approve for search feedback', exact: true }).click();
    await waitEvents('approvals: 3;');
    await page.getByRole('button', { name: 'Revoke sharing', exact: true }).click();
    await waitEvents('revocations: 1;');
    await waitEvents('approved: false');

    await page.getByRole('button', { name: 'Use structured feedback for this search', exact: true }).click();
    await waitEvents('consent changes: 1;');
    await waitEvents('sharing: true');
    await page.getByRole('button', { name: 'Disable structured feedback', exact: true }).click();
    await waitEvents('consent changes: 2;');
    await waitEvents('sharing: false');

    const rating = page.getByLabel('Interest override (0–10)', { exact: true });
    await rating.fill('0'); await rating.press('Tab');
    await waitEvents('structured changes: 1;');
    await page.waitForFunction(() => document.querySelector('.feedback-score')?.textContent?.startsWith('0/10'));
    await page.getByLabel('Category', { exact: true }).selectOption('funding');
    await page.getByLabel('Preference', { exact: true }).selectOption('negative');
    await page.getByRole('button', { name: 'Add reason', exact: true }).click();
    await waitEvents('structured changes: 2;');
    await page.getByText('Funding: Avoid', { exact: true }).waitFor();
    await page.getByLabel('Exclude from adaptive search', { exact: true }).check();
    await waitEvents('structured changes: 3;');
    await page.waitForFunction(() => document.querySelector('.feedback-score')?.textContent?.startsWith('No adaptive score'));

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name} must not overflow horizontally`);
    assert.deepEqual(errors, [], `${name} browser errors`);
    assert.deepEqual(externalRequests, [], `${name} fixture must not contact external services`);
    const screenshot = join(screenshotDirectory, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    results.push({ name, width, height, result: 'passed', screenshot, events: await events.innerText() });
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(results, null, 2));
