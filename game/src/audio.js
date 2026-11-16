// audio.js — every sound is synthesized with Web Audio: no audio files, no
// network, nothing to download. One shared noise buffer, short envelopes,
// per-weapon gunfire. The context starts on the first user gesture.

let ctx = null;
let master = null;
let noiseBuf = null;

function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.42;
  master.connect(ctx.destination);
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  ensure();
}

function noise(dur, filterType, freq, gain, when = 0) {
  if (!ensure()) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function tone(freq, dur, type, gain, when = 0, slideTo = 0) {
  if (!ensure()) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const SHOTS = {
  pistol: { freq: 1800, dur: 0.09, gain: 0.5, thump: 140 },
  smg: { freq: 2400, dur: 0.07, gain: 0.38, thump: 150 },
  rifle: { freq: 1500, dur: 0.11, gain: 0.55, thump: 120 },
  shotgun: { freq: 900, dur: 0.16, gain: 0.7, thump: 90 },
  sniper: { freq: 1100, dur: 0.22, gain: 0.7, thump: 80 },
};

export const sfx = {
  shot(sound) {
    const s = SHOTS[sound] || SHOTS.rifle;
    noise(s.dur, 'lowpass', s.freq, s.gain);
    tone(s.thump, 0.09, 'sine', 0.5, 0, 45);
  },
  dry() {
    tone(1400, 0.04, 'square', 0.12);
  },
  reload() {
    tone(900, 0.05, 'square', 0.14);
    tone(650, 0.05, 'square', 0.14, 0.18);
    tone(1100, 0.05, 'square', 0.16, 0.42);
  },
  step() {
    noise(0.05, 'lowpass', 500, 0.06);
  },
  hit() {
    tone(2100, 0.06, 'sine', 0.25);
  },
  kill() {
    tone(1500, 0.07, 'sine', 0.28);
    tone(2100, 0.1, 'sine', 0.28, 0.08);
  },
  explosion() {
    noise(0.9, 'lowpass', 700, 0.9);
    tone(110, 0.8, 'sine', 0.8, 0, 28);
  },
  beep(freq = 1200) {
    tone(freq, 0.09, 'square', 0.2);
  },
  plantTick() {
    tone(950, 0.05, 'square', 0.15);
  },
  click() {
    tone(1800, 0.03, 'square', 0.1);
  },
  buy() {
    tone(900, 0.06, 'sine', 0.2);
    tone(1350, 0.09, 'sine', 0.2, 0.07);
  },
  roundWin() {
    tone(523, 0.14, 'triangle', 0.3);
    tone(659, 0.14, 'triangle', 0.3, 0.13);
    tone(784, 0.22, 'triangle', 0.3, 0.26);
  },
  roundLose() {
    tone(392, 0.16, 'triangle', 0.28);
    tone(330, 0.16, 'triangle', 0.28, 0.15);
    tone(262, 0.28, 'triangle', 0.28, 0.3);
  },
};
