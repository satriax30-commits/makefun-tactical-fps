// main.js — EMBERLINE bootstrap and game loop.
// The simulation runs on a fixed 60 Hz step, apart from rendering: the loop
// accumulates real time, steps the sim in SIM_DT slices, then syncs the
// renderer and the HUD once per animation frame. All game state lives in the
// one state object; the systems (player, bots, combat) only mutate that.
//
// Shot modes for screenshots and tests (?shot=start|play|site|buy|end):
// the game starts itself, places the camera and the bots, and runs the sim a
// little so the frame shows a real moment of play — no pointer lock needed.

import { CONFIG, createState } from './state.js';
import { createInput } from './input.js';
import { createPlayer, resetPlayerForRound, updatePlayer } from './player.js';
import { createBots, resetBotsForRound, updateBots } from './bots.js';
import { buildMap } from './map.js';
import { createRender } from './render.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { sfx, unlockAudio } from './audio.js';
import {
  buyArmor, buyGrenade, buyPrimary, handleWeaponKeys, playerShoot,
  resetRoundState, startMatch, updateBomb, updateGrenades, updateReloads, updateRounds,
} from './combat.js';
import { makeWeapon } from './weapons.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 1337);
const shot = params.get('shot');

const state = createState(seed);
state.player = createPlayer();
createBots(state);

const render = createRender(state, document.getElementById('game'));
const map = buildMap(render.scene, state.rng);
render.bindMap(map);
const effects = createEffects(render.scene);
const input = createInput(render.renderer.domElement);
input.noLock = shot !== null;

const hud = createHud(state, {
  play: () => {
    unlockAudio();
    input.requestLock();
    if (state.phase === 'menu' || state.phase === 'matchEnd') beginMatch();
  },
  buyPrimary: (id) => buyPrimary(state, id),
  buyGrenade: (kind) => buyGrenade(state, kind),
  buyArmor: () => buyArmor(state),
});

// --- Match and round orchestration ---------------------------------------

function beginRound() {
  resetPlayerForRound(state, map, state.round - 1);
  resetBotsForRound(state, map);
  resetRoundState(state);
}

function beginMatch() {
  startMatch(state);
  beginRound();
}

// --- Shot modes -----------------------------------------------------------

function applyShotMode() {
  if (!shot) return;
  if (shot === 'start') return; // the menu overlay is the shot
  beginMatch();
  const p = state.player;
  if (shot === 'play') {
    // Mid-lane duel: the player holds the rifle down mid, two Ember bots in
    // the sightline, the sim warmed up so a tracer is in the air.
    p.weapons[0] = makeWeapon('ar77');
    p.armor = 100;
    p.x = -2;
    p.z = 0;
    p.yaw = -Math.PI / 2;
    state.phase = 'live';
    state.timer = CONFIG.ROUND_TIME;
    const e0 = state.bots.find((b) => b.id === 'e0');
    const e1 = state.bots.find((b) => b.id === 'e1');
    e0.x = 13; e0.z = -3;
    e1.x = 17; e1.z = 3;
    for (const e of [e0, e1]) {
      e.ai.target = p;
      e.ai.mode = 'engage';
      e.ai.lastSeenAt = state.time;
      // No fire during the warmup: the first burst lands right as the
      // screenshot is taken, so a tracer is in the air and the player is
      // still standing.
      e.ai.nextBurstAt = state.time + 3.0;
    }
    for (let i = 0; i < 120; i++) step(CONFIG.SIM_DT);
  } else if (shot === 'site') {
    // Site A with the charge planted, a smoke cloud and a teammate holding.
    p.weapons[0] = makeWeapon('ar77');
    p.x = -16;
    p.z = -10;
    p.yaw = Math.atan2(6, 2);
    state.phase = 'live';
    state.timer = CONFIG.ROUND_TIME;
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.x = -22;
    state.bomb.z = -12;
    state.bomb.fuse = 25;
    state.smokes.push({ x: -18, z: -12, radius: 4, until: state.time + 12 });
    const f0 = state.bots.find((b) => b.id === 'f0');
    f0.x = -19;
    f0.z = -8;
    f0.yaw = Math.atan2(3, -2);
    for (let i = 0; i < 30; i++) step(CONFIG.SIM_DT);
  } else if (shot === 'buy') {
    state.money = 4200;
  } else if (shot === 'end') {
    state.score = { A: 2, B: 1 };
    state.phase = 'roundEnd';
    state.roundWinner = 'A';
    state.roundEndReason = 'Ember eliminated';
    state.timer = 4.5;
    p.x = 0;
    p.z = 0;
    p.yaw = -Math.PI / 2;
    const e0 = state.bots.find((b) => b.id === 'e0');
    const e1 = state.bots.find((b) => b.id === 'e1');
    e0.alive = false;
    e1.alive = false;
  }
}

// --- Sound drain -----------------------------------------------------------
// The sim raises sound names into state.sounds; this frame plays them (at
// most eight a frame, so a firefight never queues a backlog).

function drainSounds() {
  if (state.stepTick) {
    sfx.step();
    state.stepTick = false;
  }
  const sounds = state.sounds;
  for (let i = 0; i < sounds.length && i < 8; i++) {
    const name = sounds[i];
    if (name === 'dry') sfx.dry();
    else if (name === 'reload') sfx.reload();
    else if (name === 'hit') sfx.hit();
    else if (name === 'kill') sfx.kill();
    else if (name === 'explosion') sfx.explosion();
    else if (name === 'beep') sfx.beep();
    else if (name === 'plantTick') sfx.plantTick();
    else if (name === 'click') sfx.click();
    else if (name === 'buy') sfx.buy();
    else if (name === 'roundWin') sfx.roundWin();
    else if (name === 'roundLose') sfx.roundLose();
    else sfx.shot(name); // weapon sounds: pistol, smg, rifle, shotgun, sniper
  }
  sounds.length = 0;
}

// --- Fixed-step simulation ---------------------------------------------------

function step(dt) {
  state.time += dt;
  if (state.phase === 'freeze' || state.phase === 'live') {
    updatePlayer(state, map, input, dt);
    updateBots(state, map, dt);
    if (state.phase === 'live') playerShoot(state, render.world, input, dt);
    updateReloads(state);
    updateBomb(state, map, input, dt);
    updateGrenades(state, map, dt);
  }
  updateRounds(state, map, dt, beginRound);
  if (state.phase === 'matchEnd' && input.wasPressed('KeyR')) beginMatch();
}

// --- Frame loop ---------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state.phase === 'menu') {
    // Slow orbit over the yard behind the title screen.
    const t = now * 0.00004;
    render.camera.position.set(Math.cos(t) * 21, 8, Math.sin(t) * 21);
    render.camera.lookAt(0, 1.5, 0);
  }

  acc += dt;
  let steps = 0;
  while (acc >= CONFIG.SIM_DT && steps < 5) {
    step(CONFIG.SIM_DT);
    acc -= CONFIG.SIM_DT;
    steps += 1;
  }
  if (steps === 5) acc = 0;

  // Keys that act once per frame, not once per sim step.
  handleWeaponKeys(state, input);
  if (input.mousePressed && !input.locked && !input.noLock
    && (state.phase === 'live' || state.phase === 'freeze')) {
    input.requestLock();
  }

  render.sync(dt, input, map);
  effects.update(state, dt, render.muzzle);
  hud.update(input);
  drainSounds();
  render.renderer.render(render.scene, render.camera);
  input.endFrame();
}

applyShotMode();
window.__emberline = { state, version: 'emberline-1.0.0' };
requestAnimationFrame(frame);
