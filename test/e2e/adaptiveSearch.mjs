/** Synthetic local browser gate. Requires the isolated test:e2e:serve config. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = '/tmp/cv-adaptive-search-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const external = [], errors = [];
    await context.route('**/*', route => {
      if (['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5177/cv-builder/test/browser/adaptive-search.html', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^Meta research/u }).waitFor();
    await page.getByText('Daily schedule', { exact: true }).click();
    await page.evaluate(() => window.adaptiveFixture.holdRequest());
    await page.getByRole('button', { name: 'Prepare adaptive task update', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.some(call => call.name === 'request_adaptive_search_migration'));
    const interests = page.getByLabel('Research interests, preferred and avoided tasks', { exact: true });
    await interests.fill('BCI; acoustic prototypes; NEW DURING SETUP');
    await page.evaluate(() => window.adaptiveFixture.releaseRequest());
    try {
      await page.waitForFunction(() => {
        const { row } = window.adaptiveFixture.snapshot();
        return row.criteria.topicsAndMethods.includes('NEW DURING SETUP') && row.meta_search.recurringPrompt.includes('private.begin_adaptive_opportunity_search');
      });
    } catch (error) {
      console.error(await page.evaluate(() => ({ errors: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
        interests: window.adaptiveFixture.snapshot().row.criteria.topicsAndMethods, calls: window.adaptiveFixture.snapshot().calls.map(call => call.name) })));
      throw error;
    }
    assert.equal(await interests.inputValue(), 'BCI; acoustic prototypes; NEW DURING SETUP');
    await page.getByRole('button', { name: 'Copy replace prompt', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().copied.includes('private.read_adaptive_search_setup'));
    const prepared = await page.evaluate(() => window.adaptiveFixture.snapshot());
    assert(prepared.copied.includes('private.ack_adaptive_search_setup'));
    assert.equal(prepared.calls.filter(call => call.name === 'request_adaptive_search_migration').length, 1);
    assert(!prepared.calls.some(call => /begin_|submit_|ack_/u.test(call.name)));
    assert.equal(prepared.state.binding.task_id, 'synthetic-existing-task');
    await page.getByRole('button', { name: 'Prepare adaptive task update', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'request_adaptive_search_migration').length === 2);
    const repeated = await page.evaluate(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'request_adaptive_search_migration'));
    assert.equal(repeated[0].args.p_setup_id, repeated[1].args.p_setup_id, 'A pending setup UUID must remain reconcilable');
    await page.getByRole('button', { name: 'Prepare adaptive task update', exact: true }).waitFor();

    await page.evaluate(() => window.adaptiveFixture.failSave());
    await interests.fill('BCI; RECOVER THIS DRAFT'); await interests.press('Enter');
    await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
    assert.equal(await interests.inputValue(), 'BCI; RECOVER THIS DRAFT');
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().row.criteria.topicsAndMethods.includes('RECOVER THIS DRAFT'));
    await page.getByRole('heading', { name: 'Adaptive feedback', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/controls-${width}.png`, fullPage: true });
    const baseRevision = await page.evaluate(() => window.adaptiveFixture.snapshot().row.revision);
    await page.getByLabel('Use structured feedback for this search', { exact: true }).check();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().dashboard.settings.structured_feedback_enabled);
    await page.getByLabel('Adapt query priorities', { exact: true }).check();
    await page.getByLabel('Pause adaptation', { exact: true }).uncheck();
    await page.getByLabel('Pause adaptation', { exact: true }).check();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().dashboard.settings.adaptation_paused);
    await page.locator('summary').filter({ hasText: 'Outgoing feedback preview' }).click();
    const packet = JSON.parse(await page.getByLabel('Exact outgoing packet', { exact: true }).inputValue());
    assert.deepEqual(packet, await page.evaluate(() => window.adaptiveFixture.snapshot().dashboard.feedback_preview));
    await page.locator('summary').filter({ hasText: 'Reusable sources' }).click();
    const source = page.locator('.adaptive-entry').filter({ has: page.locator('a') }).first();
    const cadence = source.getByLabel('Check every (hours)', { exact: true });
    await page.evaluate(() => window.adaptiveFixture.loseSourceResponse());
    await cadence.fill('72'); await cadence.press('Enter');
    await page.getByRole('button', { name: 'Retry exact request', exact: true }).waitFor();
    assert.equal(await cadence.inputValue(), '72');
    await page.getByRole('button', { name: 'Retry exact request', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_source').length === 2);
    const sourceCalls = await page.evaluate(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_source'));
    assert.deepEqual(sourceCalls[0].args, sourceCalls[1].args);
    await source.getByLabel('Pinned', { exact: true }).focus();
    await source.getByLabel('Pinned', { exact: true }).press('Space');
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_source').length >= 3);
    assert.equal(await page.evaluate(() => window.adaptiveFixture.snapshot().row.revision), baseRevision, 'Adaptive controls must not rewrite the base editor');
    await page.locator('summary').filter({ hasText: 'Saved queries and actual checks' }).click();
    await page.locator('summary').filter({ hasText: 'Recent runs' }).click();
    await page.getByRole('heading', { name: 'Failed run', exact: true }).waitFor();
    const body = await page.locator('.adaptive-dashboard').innerText();
    assert(!body.includes('PRIVATE_CANARY'));
    assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(body), 'Normal history labels must not expose internal IDs');
    await page.getByRole('button', { name: 'English / Deutsch', exact: true }).click();
    await page.getByRole('heading', { name: 'Adaptives Feedback', exact: true }).waitFor();
    await page.getByLabel('Strukturiertes Feedback für diese Suche verwenden', { exact: true }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/setup-${width}.png`, fullPage: true });
    await context.close();
    console.log(`PASS setup, draft recovery, feedback/source controls, exact preview and English/German keyboard UI at ${width}px`);
  }
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto('http://127.0.0.1:5177/cv-builder/test/browser/adaptive-search.html?readinessFailure=1', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Copy replace prompt', exact: true }).click();
  assert.equal(await page.evaluate(() => window.adaptiveFixture.snapshot().copied), '');
  await page.evaluate(() => window.adaptiveFixture.failReadiness(false));
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.search-error'));
  await context.close();
  console.log('PASS unknown readiness blocks copying until successful reload');
} finally { await browser.close(); }
