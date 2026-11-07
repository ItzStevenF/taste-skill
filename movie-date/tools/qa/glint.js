// Crop the clasped hands at 2x around the projector strike to check the ring glint.
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve');
(async () => {
  const out = process.argv[2];
  const site = await serve(path.resolve(__dirname, '../../site'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.clock.install();
  await page.goto(site.url);
  await page.waitForFunction(() => document.querySelector('#stage').matches('.is-rolling'));
  await page.clock.pauseAt(Date.now() + 10);
  let now = 0;
  for (const t of [880, 1030, 1080, 1120, 1170, 1250]) {
    await page.clock.runFor(t - now); now = t;
    await page.waitForTimeout(900);   // let the canvas fade-in transition finish
    await page.screenshot({ path: `${out}/glint-${t}.png`, clip: { x: 125, y: 500, width: 130, height: 100 } });
  }
  await browser.close(); site.close();
})();
