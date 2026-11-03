/* Baseline screenshot of the Hollow Grove UI + graphics. */
import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || 'shot.png';
const WAIT = Number(process.env.WAIT || 9000);

const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, WAIT));
await page.screenshot({ path: OUT, type: 'png' });
const info = await page.evaluate(() => ({
  title: document.title,
  loaderHidden: document.getElementById('loader')?.classList.contains('done') ?? null,
  hudVisible: !!document.getElementById('hud'),
  canvasSize: [document.getElementById('game')?.width, document.getElementById('game')?.height],
  mode: document.querySelector('.mode-btn.is-active')?.textContent?.trim() ?? null,
  wave: document.getElementById('hud-wave')?.textContent ?? null,
  souls: document.getElementById('hud-souls')?.textContent ?? null,
  houseHp: document.getElementById('hud-house-hp')?.style.width ?? null,
}));
console.log(JSON.stringify({ info, errors }, null, 2));
await browser.close();
