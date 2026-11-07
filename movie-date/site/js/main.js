// The director: runs the opening shot, hands over to the title card, and stages the "technical
// difficulty" when an answer is chosen. Nothing about the answer is stored or sent anywhere.

import { createTheater } from './theater.js';
import { createSound } from './sound.js';

const $ = (sel) => document.querySelector(sel);
const stage = $('#stage');
const canvas = $('#theater');
const invite = $('#invite');
const answers = $('#answers');
const rushed = $('#rushed');
const frameline = $('#frameline');
const grain = $('#grain');
const soundButton = $('#sound');

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const sound = createSound();

// ───────────── film grain: one small noise tile, moved to a new place 24 times a second ─────────────

(function makeGrain() {
  const size = 96, cell = 2;                         // clumps about two pixels across
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 64;
      for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) {
        const i = ((y + dy) * size + (x + dx)) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  grain.style.setProperty('--grain', `url(${c.toDataURL('image/png')})`);
})();

let grainTimer = 0;
function runGrain(on) {
  grain.classList.toggle('is-on', on);
  clearInterval(grainTimer);
  if (!on || calm.matches) return;
  grainTimer = setInterval(() => {
    if (document.hidden) return;
    const x = Math.floor(Math.random() * 96) * 2, y = Math.floor(Math.random() * 96) * 2;
    grain.style.transform = `translate3d(${-x}px, ${-y}px, 0)`;
  }, 1000 / 24);
}

// ───────────── sound: off until she asks for it ─────────────

soundButton.addEventListener('click', () => {
  const on = soundButton.getAttribute('aria-pressed') !== 'true';
  soundButton.setAttribute('aria-pressed', String(on));
  soundButton.querySelector('.sound__label').textContent = on ? 'Sound on' : 'Sound';
  sound.setEnabled(on, { scene: act });
});

// ───────────── the timeline of the opening shot (milliseconds) ─────────────

const T = {
  fadeIn: [0, 650],          // house lights up, the room in warm light
  houseDown: [520, 1000],    // house lights dim to embers
  strike: 900,               // the projector strikes
  text: [1250, 1650],        // "Loading a movie date…" arrives on the screen
  dots: 1500,                // the dots begin to step
  dolly: [1150, 5000],       // the camera move
  handoff: 4900,             // the title card starts to come up on the dark frame
  end: 5700,
};

// Lamp strike: the screen stutters on before it holds.
const STRIKE = [[0, 0], [45, 0.55], [90, 0.12], [150, 0.82], [205, 0.38], [270, 1], [340, 0.9], [420, 1]];

let act = 'opening';
let theater = null;

start();

async function start() {
  // The title face must be ready before anything with type is drawn.
  const fonts = Promise.all([
    document.fonts.load('300 72px "Newsreader"'),
    document.fonts.load('400 20px "Newsreader"'),
    document.fonts.load('italic 360 20px "Newsreader"'),
  ]).catch(() => {});

  if (calm.matches) {
    await fonts;
    return stillOpening({ reduced: true });
  }
  try {
    // On a very slow connection, don't keep her waiting on a blur: after 12 s use the still shot.
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error('scene took too long')), 12000));
    const theaterReady = createTheater(canvas, {
      fontFamily: '"Newsreader", Georgia, serif',
      onLost: () => { if (act === 'opening') cutToTitle(); },
    });
    const [th] = await Promise.race([Promise.all([theaterReady, fonts]), slow]);
    theater = th;
  } catch (err) {
    console.info('Opening shot uses the still version:', err && err.message);
    await fonts;
    return stillOpening({ reduced: false });
  }
  runOpening();
}

// If the GPU is lost mid-shot, skip straight to the title card.
function cutToTitle() {
  stage.classList.add('is-done');
  if (act === 'opening') showInvite();
}

function runOpening() {
  const s = theater.state;
  let t = 0, last = performance.now(), speed = 1, handedOff = false;
  window.__opening = true;
  stage.classList.add('is-rolling');
  sound.cue('house');

  // A tap during the shot (after its first beat) runs the rest of it faster rather than cutting.
  const hurry = (e) => {
    if (e.target.closest('.sound')) return;
    if (t > 1400) speed = 3.2;
  };
  window.addEventListener('pointerdown', hurry);
  const onResize = () => theater.resize();
  window.addEventListener('resize', onResize);

  let struck = false;
  const frame = (now) => {
    const dt = Math.min(now - last, 50);         // never jump after a stall or a hidden tab
    last = now;
    t += dt * speed;

    s.time = t / 1000;
    s.fade = ease(prog(t, ...T.fadeIn));
    s.house = 1 - easeInOut(prog(t, ...T.houseDown)) * 0.78;

    // the camera
    s.progress = prog(t, ...T.dolly);
    s.drift = 1;
    // the reel ends: the projection drops to a dark frame as we arrive, so the phone never flashes
    s.dim = easeInOut(prog(s.progress, 0.63, 0.93));

    // projector strike
    const st = t - T.strike;
    s.screen = st < 0 ? 0 : st > STRIKE[STRIKE.length - 1][0] ? 1 : keyed(STRIKE, st);
    if (st >= 0 && !struck) { struck = true; sound.cue('strike'); }
    // the screen's light on the room follows the projection, including when the reel goes dark
    const lit = (s.screen > 0.05 ? 0.25 + s.screen * 0.75 : 0) * (1 - 0.92 * s.dim);
    s.light += (lit - s.light) * Math.min(1, dt / 70);
    s.glint = st > 120 && st < 300 ? Math.sin(((st - 120) / 180) * Math.PI) : 0;

    // projected words: up after the strike, gone before they outgrow the frame
    s.text = easeInOut(prog(t, ...T.text)) * (1 - easeInOut(prog(s.progress, 0.55, 0.66)));
    s.dots = t < T.dots ? 0 : 1 + Math.floor((t - T.dots) / 380) % 3;
    s.flicker = 1 + (Math.random() - 0.5) * 0.03 * s.screen;
    s.grainSeed = Math.floor(t / (1000 / 24));

    if (theater.lost) {                          // the GPU went away: the title card has taken over
      window.removeEventListener('pointerdown', hurry);
      window.removeEventListener('resize', onResize);
      return;
    }
    theater.frame();

    if (!handedOff && t >= T.handoff) {
      handedOff = true;
      showInvite();
    }
    if (t < T.end) requestAnimationFrame(frame);
    else {
      window.removeEventListener('pointerdown', hurry);
      window.removeEventListener('resize', onResize);
      stage.classList.add('is-done');
      setTimeout(() => { theater.destroy(); theater = null; }, 600);
    }
  };
  requestAnimationFrame(frame);
}

// Reduced motion or no WebGL: the same shot as a still, with the lights and the words, then the card.
function stillOpening({ reduced }) {
  window.__opening = true;
  stage.classList.add('is-still');
  const proj = $('#projection');
  const img = stage.querySelector('.stage__still img');
  const still = stage.querySelector('.stage__still');
  const place = () => {
    const r = placeProjection(img, proj);
    still.style.transformOrigin = `${r.cx}px ${r.cy}px`;   // push toward the screen's real centre
  };
  const ready = img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; });
  ready.then(() => {
    place();
    window.addEventListener('resize', place);
    stage.style.opacity = '0';
    stage.style.transition = 'opacity 800ms ease';
    requestAnimationFrame(() => { stage.style.opacity = '1'; });
    setTimeout(() => stage.classList.add('is-lit'), 700);
    let n = 0;
    const dots = [...proj.querySelectorAll('.dots i')];
    const stepper = setInterval(() => { n = (n + 1) % 4; dots.forEach((d, i) => { d.style.opacity = i < n ? '1' : '0'; }); }, 380);
    if (!reduced) {
      // a plain push toward the screen when WebGL is missing
      still.style.transition = 'transform 3600ms cubic-bezier(0.55, 0, 0.35, 1)';
      setTimeout(() => { still.style.transform = 'scale(3.4)'; }, 1100);
    }
    setTimeout(() => {
      clearInterval(stepper);
      showInvite();
      stage.classList.add('is-done');
    }, reduced ? 2600 : 4700);
  });
}

// Keep the HTML projection on the still's screen rectangle (object-fit: cover maths).
function placeProjection(img, el) {
  const vw = innerWidth, vh = innerHeight, iw = 1536, ih = 2752;
  const k = Math.max(vw / iw, vh / ih);
  const ox = (vw - iw * k) / 2, oy = (vh - ih * k) / 2;
  const left = ox + 369 * k, top = oy + 661 * k, width = 800 * k, height = 517 * k;
  Object.assign(el.style, {
    left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
    fontSize: `${width * 0.071}px`,
  });
  return { cx: left + width / 2, cy: top + height / 2 };
}

// ───────────── the title card ─────────────

function showInvite() {
  if (invite.classList.contains('is-on')) return;
  window.__invited = true;
  act = 'invite';
  invite.classList.add('is-on');
  runGrain(true);
  sound.cue('title');
  setTimeout(() => invite.classList.add('is-live'), 1900);
}

// ───────────── the answer, and the technical difficulty ─────────────

answers.addEventListener('submit', (e) => e.preventDefault());
answers.addEventListener('click', (e) => {
  const btn = e.target.closest('.answer');
  if (!btn || act !== 'invite') return;
  e.preventDefault();
  act = 'rushed';
  // Whatever was chosen goes nowhere: the same thing happens for all three.
  btn.classList.add('is-pressed');
  answers.querySelectorAll('.answer').forEach((b) => { b.disabled = true; });
  sound.cue('slip');

  if (calm.matches) {
    setTimeout(() => {
      invite.style.transition = 'opacity 450ms ease';
      invite.style.opacity = '0';
      setTimeout(showRushed, 700);
    }, 160);
    return;
  }

  setTimeout(() => {
    invite.classList.remove('is-live');
    invite.classList.add('is-slipping');
    frameline.classList.add('is-on');
  }, 100);
  // freeze for a breath, then the hard cut to black
  setTimeout(() => {
    invite.classList.add('is-cut');
    frameline.classList.add('is-cut');
    sound.cue('cut');
  }, 620);
  // the "uh-oh": darkness and grain only, then the slide drops in, crooked
  setTimeout(showRushed, 1050);
});

function showRushed() {
  rushed.classList.add('is-on');
  sound.cue('slide');
  const slide = $('#slide');
  slide.setAttribute('tabindex', '-1');
  slide.focus({ preventScroll: true });
}

// ───────────── tiny maths ─────────────

function prog(t, a, b) { return Math.min(1, Math.max(0, (t - a) / (b - a))); }
function ease(x) { return 1 - Math.pow(1 - x, 3); }
function easeInOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function keyed(keys, t) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
}
