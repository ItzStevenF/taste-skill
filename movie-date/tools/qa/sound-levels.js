// Render the sound score offline and measure peak / RMS per cue (dBFS).
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve');
(async () => {
  const site = await serve(path.resolve(__dirname, '../../site'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(site.url + 'index.html');
  const result = await page.evaluate(async () => {
    const { createSound } = await import('./js/sound.js');
    const SR = 44100, LEN = 11;
    const off = new OfflineAudioContext(2, SR * LEN, SR);
    window.AudioContext = function () { return off; };       // sound.js will build its graph on this
    const realResume = off.resume.bind(off);
    off.resume = () => Promise.resolve();
    const s = createSound();
    s.cue('house');
    s.setEnabled(true, { scene: 'opening' });
    const at = { strike: 0.6, title: 4.6, slip: 7.0, cut: 7.52, slide: 7.95 };
    for (const [name, t] of Object.entries(at)) off.suspend(t).then(() => { s.cue(name); realResume(); });
    const buf = await off.startRendering();
    const d = buf.getChannelData(0);
    const seg = (a, b) => { let pk = 0, ss = 0; const i0 = Math.floor(a * SR), i1 = Math.floor(b * SR); for (let i = i0; i < i1; i++) { const v = Math.abs(d[i]); pk = Math.max(pk, v); ss += v * v; } const db = (x) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1); return `peak ${db(pk)} dBFS, rms ${db(Math.sqrt(ss / (i1 - i0)))} dBFS`; };
    return {
      'room tone only (0.2-0.6s)': seg(0.2, 0.6),
      'strike (0.6-1.0s)': seg(0.6, 1.0),
      'projector running (2-4s)': seg(2, 4),
      'title swell (5-7s)': seg(5, 7),
      'slip (7.0-7.5s)': seg(7.0, 7.5),
      'cut + wind-down (7.52-7.9s)': seg(7.52, 7.9),
      'slide (7.95-8.2s)': seg(7.95, 8.2),
      'after (9-11s)': seg(9, 11),
    };
  });
  for (const [k, v] of Object.entries(result)) console.log(k.padEnd(30), v);
  await browser.close(); site.close();
})().catch((e) => { console.error(e); process.exit(1); });
