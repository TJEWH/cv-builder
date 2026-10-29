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
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/setup-${width}.png`, fullPage: true });
    await context.close();
    console.log(`PASS synthetic setup, pending-draft flush and failed-save recovery at ${width}px`);
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
