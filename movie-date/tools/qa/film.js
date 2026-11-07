// Film the whole experience at a given viewport with a fake clock, frame by frame.
// node film.js <outdir> <width> <height> [answer: yes|no|stay] [--reduced]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const serve = require('./serve');
(async () => {
  const [out, w, h, answer = 'yes', flag] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const site = await serve(path.resolve(__dirname, '../../site'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({
    viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DPR || 1), isMobile: true, hasTouch: true,
    reducedMotion: flag === '--reduced' ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
  await page.clock.install();
  await page.goto(site.url, { waitUntil: 'load' });
  // wait (in real time) for the opening to start rolling or to fall back to the still
  await page.waitForFunction(() => document.querySelector('#stage').matches('.is-rolling, .is-still'), null, { timeout: 60000 });
  const mode = await page.evaluate(() => document.querySelector('#stage').className);
  logs.push(`[mode] ${mode}`);
  await page.clock.pauseAt(Date.now() + 10);
  const shots = [0, 300, 700, 1000, 1200, 1500, 1900, 2400, 2900, 3400, 3900, 4400, 4900, 5300, 5800, 6600, 7600];
  let now = 0;
  for (const t of shots) {
    await page.clock.runFor(t - now); now = t;
    await page.waitForTimeout(t > 5000 ? 250 : 30);   // let CSS (real-time) settle a little
    await page.screenshot({ path: `${out}/t${String(t).padStart(5, '0')}.png` });
  }
  // let the CSS entrance finish in real time
  await page.clock.runFor(2500); await page.waitForTimeout(2200);
  await page.screenshot({ path: `${out}/invite.png` });
  const sel = { yes: '.answer--yes', no: '.answer--no', stay: '.answer--stay' }[answer];
  const box = await page.locator(sel).boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const fin = [60, 200, 330, 460, 640, 900, 1100, 1300, 1800];
  let f0 = 0;
  for (const t of fin) {
    await page.clock.runFor(t - f0); f0 = t;
    await page.waitForTimeout(t - (fin[fin.indexOf(t) - 1] || 0));   // CSS runs on real time
    await page.screenshot({ path: `${out}/f${String(t).padStart(4, '0')}.png` });
  }
  await page.clock.runFor(1500); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/final.png` });
  const finalText = await page.evaluate(() => {
    const r = document.querySelector('#rushed');
    return { visible: getComputedStyle(r).visibility, text: r.innerText.replace(/\s+/g, ' ').trim() };
  });
  logs.push(`[final] ${JSON.stringify(finalText)}`);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  logs.push(`[overflow] ${JSON.stringify(overflow)}`);
  fs.writeFileSync(`${out}/log.txt`, logs.join('\n'));
  console.log(logs.join('\n'));
  await browser.close(); site.close();
})().catch((e) => { console.error(e); process.exit(1); });
