// Sound, synthesized, so there is nothing to download. Silent until she presses "Sound":
// nothing here can start an AudioContext on its own, and every cue is ignored while sound is off.

export function createSound() {
  let ctx = null;
  let out = null;          // master gain → compressor → speakers
  let verb = null;         // a small room reverb send
  let enabled = false;
  let room = null;         // room tone (always under everything once enabled)
  let projector = null;    // motor hum + gate clatter while film is running
  let filmRunning = false; // the director's view of whether the projector is on

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    out = ctx.createGain(); out.gain.value = 0; out.connect(comp);
    verb = ctx.createConvolver();
    verb.buffer = impulse(2.4, 2.8);
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.32;
    verb.connect(verbOut).connect(out);
    return true;
  }

  // ---------- building blocks

  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  function noiseBuffer(seconds, brown = false) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } else d[i] = w;
    }
    return b;
  }

  // One second of a projector's intermittent: 24 claw clicks, each a little different.
  function clatterBuffer() {
    const sr = ctx.sampleRate, len = sr;
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    for (let k = 0; k < 24; k++) {
      const start = Math.floor((k / 24) * len + (Math.random() - 0.5) * sr * 0.0015);
      const amp = 0.55 + Math.random() * 0.45;
      for (let i = 0; i < sr * 0.012; i++) {
        const j = start + i;
        if (j >= len) break;
        d[j] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (sr * 0.0018));
      }
      // the softer second tick of the shutter
      const s2 = start + Math.floor(sr * 0.019);
      for (let i = 0; i < sr * 0.006; i++) {
        const j = s2 + i;
        if (j >= len) break;
        d[j] += (Math.random() * 2 - 1) * amp * 0.35 * Math.exp(-i / (sr * 0.0012));
      }
    }
    return b;
  }

  function startRoom() {
    if (room) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4, true); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 360;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(out);
    src.start();
    g.gain.setTargetAtTime(0.11, ctx.currentTime, 0.8);
    room = { src, g };
  }

  function startProjector(level = 1) {
    if (projector) { projector.g.gain.setTargetAtTime(0.5 * level, ctx.currentTime, 0.3); return; }
    const now = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(out);
    // motor hum
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 49;
    const hum2 = ctx.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 98;
    const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 240;
    const humG = ctx.createGain(); humG.gain.value = 0.05;
    hum.connect(humLp); hum2.connect(humLp); humLp.connect(humG).connect(g);
    // gate clatter
    const cl = ctx.createBufferSource(); cl.buffer = clatterBuffer(); cl.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2300; bp.Q.value = 0.9;
    const clG = ctx.createGain(); clG.gain.value = 0.16;
    cl.connect(bp).connect(clG).connect(g);
    // the fan's whirr
    const fan = ctx.createBufferSource(); fan.buffer = noiseBuffer(3); fan.loop = true;
    const fbp = ctx.createBiquadFilter(); fbp.type = 'bandpass'; fbp.frequency.value = 820; fbp.Q.value = 0.7;
    const fG = ctx.createGain(); fG.gain.value = 0.03;
    fan.connect(fbp).connect(fG).connect(g);
    hum.start(now); hum2.start(now); cl.start(now); fan.start(now);
    g.gain.setTargetAtTime(0.5 * level, now, 0.25);
    projector = { g, hum, hum2, cl, fan, clG };
  }

  function stopProjector(windDown) {
    if (!projector) return;
    const p = projector; projector = null;
    const now = ctx.currentTime;
    if (windDown) {
      p.hum.frequency.setTargetAtTime(14, now, 0.35);
      p.hum2.frequency.setTargetAtTime(28, now, 0.35);
      p.clG.gain.setTargetAtTime(0, now, 0.04);
      p.g.gain.setTargetAtTime(0, now + 0.15, 0.35);
    } else {
      p.g.gain.setTargetAtTime(0, now, 0.2);
    }
    const end = now + 2.2;
    for (const n of [p.hum, p.hum2, p.cl, p.fan]) n.stop(end);
  }

  function burst({ at = 0, dur = 0.02, freq = 1800, q = 1, gain = 0.4, type = 'bandpass' }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(dur + 0.02);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t); src.stop(t + dur + 0.03);
  }

  function thump({ at = 0, from = 90, to = 38, dur = 0.18, gain = 0.5 }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // A soft, warm chord that opens under the title: D major 9, slow attack, long tail.
  function swell() {
    const t = ctx.currentTime;
    const notes = [73.42, 146.83, 220.0, 277.18, 329.63, 369.99];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(320, t);
    lp.frequency.exponentialRampToValueAtTime(1900, t + 2.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 1.8);
    g.gain.setTargetAtTime(0.0001, t + 3.2, 1.6);
    lp.connect(g);
    g.connect(out); g.connect(verb);
    notes.forEach((f, i) => {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f; o.detune.value = det + (Math.random() - 0.5) * 3;
        const og = ctx.createGain(); og.gain.value = i === 0 ? 0.5 : 0.22 / (1 + i * 0.25);
        o.connect(og).connect(lp);
        o.start(t + i * 0.06); o.stop(t + 9);
      }
    });
  }

  // ---------- the director's cues

  function cue(name) {
    if (name === 'house') filmRunning = false;
    if (name === 'strike') filmRunning = true;
    if (name === 'cut') filmRunning = false;
    if (!enabled || !ctx) return;
    switch (name) {
      case 'strike':
        burst({ dur: 0.012, freq: 3200, q: 2, gain: 0.16 });      // the relay
        thump({ at: 0.03, from: 110, to: 42, dur: 0.22, gain: 0.2 });  // the arc catching
        startProjector(1);
        break;
      case 'title':
        swell();
        if (projector) projector.g.gain.setTargetAtTime(0.28, ctx.currentTime + 0.6, 0.8);
        break;
      case 'slip':
        // the loop is lost: the film flaps against the gate, faster and louder
        for (let i = 0; i < 7; i++) burst({ at: 0.1 + i * 0.065, dur: 0.03, freq: 1200 + i * 90, q: 1.4, gain: 0.18 + i * 0.05 });
        if (projector) {
          projector.hum.frequency.setTargetAtTime(43, ctx.currentTime + 0.1, 0.12);
          projector.hum2.frequency.setTargetAtTime(86, ctx.currentTime + 0.1, 0.12);
        }
        break;
      case 'cut':
        burst({ dur: 0.02, freq: 2600, q: 1.5, gain: 0.3 });
        stopProjector(true);
        break;
      case 'slide':
        // a slide pushed into the carrier, a little too hard
        burst({ dur: 0.016, freq: 1700, q: 1.8, gain: 0.42 });
        burst({ at: 0.045, dur: 0.02, freq: 1300, q: 1.6, gain: 0.3 });
        thump({ at: 0.045, from: 140, to: 60, dur: 0.09, gain: 0.25 });
        break;
      default:
    }
  }

  function setEnabled(on, { scene } = {}) {
    enabled = on;
    if (on) {
      if (!ensure()) return;
      // She asked for sound: play it even with the ringer switch on silent, where supported.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
      ctx.resume();
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.12);
      startRoom();
      if (filmRunning && scene !== 'rushed') startProjector(scene === 'invite' ? 0.56 : 1);
    } else if (ctx) {
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
      setTimeout(() => { if (!enabled && ctx.state === 'running') ctx.suspend(); }, 450);
    }
  }

  return { setEnabled, cue };
}
