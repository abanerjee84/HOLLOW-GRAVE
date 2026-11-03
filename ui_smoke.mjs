// Optional browser integration checks; uses the locally installed Puppeteer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: 'new', defaultViewport: { width: 1440, height: 900 },
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
try {
  await page.goto(process.env.URL || 'http://localhost:8080/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__grove?.metrics?.iteration >= 12, { timeout: 90000 });
  await page.click('#btn-pause');
  await page.waitForFunction(() => !window.__grove.run.training && document.querySelector('#train-note').textContent.startsWith('Training paused.'), { timeout: 15000 });
  const checkpoint = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('hollow-grove-ppo-v8'));
    return { iteration: data.iteration, weights: data.weights, baseline: data.baseline,
      evaluation: data.evaluation, metrics: data.metrics };
  });
  assert.ok(checkpoint.iteration >= 12);
  assert.ok(checkpoint.baseline.runs.length === 4 && checkpoint.evaluation.iteration >= 10);
  assert.ok(checkpoint.metrics.clearRate >= 0 && checkpoint.metrics.clearRate <= 1);
  await page.click('#btn-follow');
  assert.equal(await page.$eval('#btn-follow', el => el.getAttribute('aria-pressed')), 'true');
  await page.click('[data-mode="play"]');
  await page.waitForFunction(() => document.querySelector('#agent-mode').textContent === 'MANUAL OVERRIDE', { timeout: 10000 });
  await page.keyboard.down('KeyD');
  await new Promise(resolve => setTimeout(resolve, 250));
  await page.keyboard.up('KeyD');
  assert.equal(await page.$eval('#agent-mode', el => el.textContent), 'MANUAL OVERRIDE');
  await page.click('[data-mode="watch"]');
  await page.click('#btn-follow');
  await page.screenshot({ path: 'upgraded.png' });
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await page.setViewport({ width, height });
    if (width < 760) {
      assert.equal(await page.$eval('#ai-panel', el => getComputedStyle(el).display), 'none');
      await page.click('#btn-learning');
      assert.equal(await page.$eval('#btn-learning', el => el.getAttribute('aria-expanded')), 'true');
    }
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('#ai-panel');
      const rect = panel.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(layout.left >= 0 && layout.right <= width && layout.bottom <= height);
    assert.equal(layout.overflow, false);
    await page.screenshot({ path: `ui-${width}.png` });
  }
  // Reload retains the exact paused policy before auto-training starts again.
  await page.setViewport({ width: 1440, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__grove?.policyReady);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('hollow-grove-ppo-v8')));
  assert.ok(restored.weights === checkpoint.weights, 'Reload changed paused checkpoint weights');
  assert.equal(restored.iteration, checkpoint.iteration);
  await page.waitForFunction(iteration => window.__grove?.metrics?.iteration > iteration, { timeout: 90000 }, checkpoint.iteration);
  assert.equal(errors.length, 0, errors.join('\n'));
  const result = await page.evaluate(() => ({ iteration: window.__grove.metrics.iteration,
    holdRate: window.__grove.metrics.holdRate, baseline: window.__grove.metrics.baseline,
    evaluation: window.__grove.metrics.evaluation }));
  fs.writeFileSync('ui_smoke_report.json', JSON.stringify({ ...result, errors, checks: 'training, pause, checkpoint, reload, resume, follow camera, manual mode, desktop and mobile layouts' }, null, 2));
  console.log(`Browser checks passed at update ${result.iteration}; no page or HTTP errors.`);
} finally {
  await browser.close();
}
