// Key frames for many viewports in one go: opening, mid-move, title card, finale.
// node sweep.js <outdir> [--reduced] [--nowebgl]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const serve = require('./serve');
const VIEWS = [
  ['se', 375, 667], ['iphone', 390, 844], ['promax', 430, 932], ['mini', 360, 780],
  ['landscape', 844, 390], ['ipad', 820, 1180], ['laptop', 1280, 720],
];
(async () => {
  const [out, ...flags] = process.argv.slice(2);
  const reduced = flags.includes('--reduced'), nowebgl = flags.includes('--nowebgl');
  fs.mkdirSync(out, { recursive: true });
  const site = await serve(path.resolve(__dirname, '../../site'));
  const args = nowebgl ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch({ args });
  const report = [];
  const only = (process.env.VIEWS || '').split(',').filter(Boolean);
  for (const [name, w, h] of VIEWS.filter((v) => !only.length || only.includes(v[0]))) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 900, hasTouch: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
    await page.clock.install();
    await page.goto(site.url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#stage').matches('.is-rolling, .is-still'), null, { timeout: 60000 });
    const mode = (await page.evaluate(() => document.querySelector('#stage').className)).replace('stage ', '');
    await page.clock.pauseAt(Date.now() + 10);
    const shots = [[300, 'a'], [1600, 'b'], [2600, 'c'], [4000, 'd']];
    let now = 0;
    for (const [t, tag] of shots) {
      await page.clock.runFor(t - now); now = t;
      await page.waitForTimeout(80);
      await page.screenshot({ path: `${out}/${name}-${tag}.png` });
    }
    await page.clock.runFor(9000 - now); await page.waitForTimeout(2600);
    await page.screenshot({ path: `${out}/${name}-e-invite.png` });
    // geometry checks on the title card
    const geo = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
      const lines = [...document.querySelectorAll('.title__line')].map(r);
      const answers = [...document.querySelectorAll('.answer')].map(r);
      const t = getComputedStyle(document.querySelector('.title'));
      return { vw: innerWidth, vh: innerHeight, titleSize: t.fontSize, lines, answers, sw: document.documentElement.scrollWidth };
    });
    const answer = ['.answer--yes', '.answer--no', '.answer--stay'][VIEWS.findIndex((v) => v[0] === name) % 3];
    await page.locator(answer).click();
    await page.clock.runFor(2500); await page.waitForTimeout(2600);
    await page.screenshot({ path: `${out}/${name}-f-final.png` });
    const fin = await page.evaluate(() => {
      const s = document.querySelector('#slide').getBoundingClientRect();
      return { text: document.querySelector('#rushed').innerText.replace(/\s+/g, ' ').trim(), vis: getComputedStyle(document.querySelector('#rushed')).visibility, invite: getComputedStyle(document.querySelector('#invite')).visibility, slide: [Math.round(s.x), Math.round(s.y), Math.round(s.right), Math.round(s.bottom)] };
    });
    const issues = [];
    if (geo.sw > geo.vw) issues.push('horizontal overflow');
    for (const l of geo.lines) if (l.x < 0 || l.r > geo.vw) issues.push(`title line off-screen ${JSON.stringify(l)}`);
    for (const a of geo.answers) { if (a.b > geo.vh || a.x < 0 || a.r > geo.vw) issues.push(`answer off-screen ${JSON.stringify(a)}`); if (a.h < 44) issues.push(`answer too short ${a.h}`); }
    if (fin.slide[0] < 0 || fin.slide[2] > geo.vw || fin.slide[1] < 0 || fin.slide[3] > geo.vh) issues.push(`message off-screen ${fin.slide}`);
    if (fin.text !== 'This website was rushed, I can’t find out what option you picked. Please text me with your answer lol') issues.push('final text mismatch: ' + fin.text);
    if (fin.invite !== 'hidden' && !reduced) issues.push('invite still visible after the cut');
    report.push(`${name} ${w}x${h} [${mode}] title ${geo.titleSize} answer=${answer} ${issues.length ? 'ISSUES: ' + issues.join('; ') : 'ok'}${logs.length ? '\n  ' + logs.join('\n  ') : ''}`);
    await ctx.close();
  }
  console.log(report.join('\n'));
  await browser.close(); site.close();
})().catch((e) => { console.error(e); process.exit(1); });
