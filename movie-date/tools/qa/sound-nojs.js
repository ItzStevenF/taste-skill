// 1) Turn sound on during the opening, play through, answer: no errors, audio context running.
// 2) JavaScript disabled: the card is there and an answer still reaches the message.
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve');
(async () => {
  const site = await serve(path.resolve(__dirname, '../../site'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'] });

  // 1. sound
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await page.addInitScript(() => {
    // record every AudioContext created, and when
    const AC = window.AudioContext;
    window.__audio = [];
    window.AudioContext = function (...a) { const c = new AC(...a); window.__audio.push({ at: performance.now(), c }); return c; };
    window.AudioContext.prototype = AC.prototype;
  });
  await page.goto(site.url);
  await page.waitForFunction(() => document.querySelector('#stage').matches('.is-rolling'));
  const before = await page.evaluate(() => window.__audio.length);
  await page.waitForTimeout(700);
  await page.tap('#sound');
  await page.waitForTimeout(6500);
  const state = await page.evaluate(() => ({ n: window.__audio.length, state: window.__audio[0] && window.__audio[0].c.state, label: document.querySelector('.sound__label').textContent, pressed: document.querySelector('#sound').getAttribute('aria-pressed') }));
  await page.tap('.answer--stay');
  await page.waitForTimeout(2500);
  await page.tap('#sound');
  await page.waitForTimeout(600);
  const off = await page.evaluate(() => ({ state: window.__audio[0].c.state, label: document.querySelector('.sound__label').textContent }));
  console.log('audio contexts before the tap:', before, '| after:', JSON.stringify(state), '| after turning off:', JSON.stringify(off));
  console.log('console issues:', errs.length ? errs.join('\n  ') : 'none');
  await ctx.close();

  // 2. no JS
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false, isMobile: true, hasTouch: true });
  const p2 = await ctx2.newPage();
  await p2.goto(site.url);
  await p2.waitForTimeout(800);
  const visible = await p2.evaluate(() => ({ invite: getComputedStyle(document.querySelector('#invite')).visibility, title: document.querySelector('h1').innerText.replace(/\s+/g, ' '), stage: getComputedStyle(document.querySelector('#stage')).display }));
  await p2.screenshot({ path: process.argv[2] + '/nojs-invite.png' });
  await p2.click('.answer--no');
  await p2.waitForTimeout(800);
  const after = await p2.evaluate(() => ({ url: location.href.replace(/^http:\/\/localhost:\d+/, ''), rushed: getComputedStyle(document.querySelector('#rushed')).visibility, invite: getComputedStyle(document.querySelector('#invite')).display, text: document.querySelector('#rushed').innerText.replace(/\s+/g, ' ').trim() }));
  await p2.screenshot({ path: process.argv[2] + '/nojs-final.png' });
  console.log('no-JS card:', JSON.stringify(visible));
  console.log('no-JS after NO:', JSON.stringify(after));
  await browser.close(); site.close();
})().catch((e) => { console.error(e); process.exit(1); });
