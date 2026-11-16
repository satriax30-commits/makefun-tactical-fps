// combat.js — everything that hurts, explodes or ends a round: the player's
// hitscan fire (raycast against walls and bot hit meshes), damage and armor,
// grenades, the plant/defuse channel, the round clock and the economy.
// Bots call damageAgent from bots.js; nothing here imports bots.js.

import * as THREE from 'three';
import { CONFIG } from './state.js';
import { ARMOR_PRICE, BUY_ORDER, GRENADES, WEAPONS, currentWeapon, makeWeapon, shotInterval, spreadFor } from './weapons.js';
import { losBlocked, resolveCircle } from './map.js';
import { clamp, distSq2D, wrapAngle } from './utils.js';

const raycaster = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
let prevFiring = false;
let lastDryAt = -10;

// --- Player fire -------------------------------------------------------

export function playerShoot(state, world, input, dt) {
  const p = state.player;
  const w = currentWeapon(p);
  if (!p.alive || !w || w.reloading) return;
  const time = state.time;
  if (input.firing) {
    if (!w.def.auto && prevFiring) {
      prevFiring = true;
      return;
    }
    if (time < w.nextShot) {
      prevFiring = true;
      return;
    }
    if (w.mag <= 0) {
      if (time - lastDryAt > 0.3) {
        lastDryAt = time;
        state.sounds.push('dry');
      }
      startReload(p);
      prevFiring = true;
      return;
    }
    firePlayerShot(state, world, p, w);
  }
  prevFiring = input.firing;
}

function firePlayerShot(state, world, p, w) {
  const def = w.def;
  const time = state.time;
  w.nextShot = time + shotInterval(def);
  w.mag -= 1;
  state.stats.shots += 1;
  state.sounds.push(def.sound);

  const speed = Math.hypot(p.vx, p.vz);
  const airborne = p.y > 0.01;
  const spreadDeg = spreadFor(p, def, speed, airborne);
  const spreadRad = (spreadDeg * Math.PI) / 180;

  // Muzzle: just ahead of the camera, right and low — the viewmodel's tip.
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const mx = p.x - sin * 0.7 + cos * 0.22;
  const mz = p.z - cos * 0.7 - sin * 0.22;
  const my = p.y + p.eyeHeight - 0.12;
  const eyeX = p.x;
  const eyeY = p.y + p.eyeHeight;
  const eyeZ = p.z;

  for (let pellet = 0; pellet < def.pellets; pellet++) {
    const yaw = p.yaw + (state.rng() - 0.5) * 2 * spreadRad;
    const pitch = p.pitch + (state.rng() - 0.5) * 2 * spreadRad;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const cp = Math.cos(pitch);
    _dir.set(-sy * cp, Math.sin(pitch), -cy * cp);
    _origin.set(eyeX, eyeY, eyeZ);
    raycaster.set(_origin, _dir);
    raycaster.far = def.range;
    const hits = raycaster.intersectObjects(world.shootables, false);
    let hx;
    let hy;
    let hz;
    if (hits.length === 0) {
      hx = eyeX + _dir.x * def.range;
      hy = eyeY + _dir.y * def.range;
      hz = eyeZ + _dir.z * def.range;
    } else {
      const h = hits[0];
      hx = h.point.x;
      hy = h.point.y;
      hz = h.point.z;
      const ud = h.object.userData;
      if (ud.kind === 'bot' && ud.agent.alive) {
        const dmg = def.damage * (ud.part === 'head' ? def.headMult : 1);
        state.stats.hits += 1;
        if (ud.part === 'head') state.stats.headshots += 1;
        state.hitmarkAt = time;
        state.sounds.push('hit');
        damageAgent(state, ud.agent, dmg, p, ud.part === 'head');
      } else {
        state.impacts.push({ x: hx, y: hy, z: hz });
      }
    }
    state.tracers.push({
      x1: mx, y1: my, z1: mz,
      x2: hx, y2: hy, z2: hz,
      at: time, team: 'A',
    });
  }

  // Recoil kicks the aim up and blooms the spread; both recover in player.js.
  p.pitch += def.kick * 0.014;
  p.recoil += def.kick * 0.014;
  p.bloom = Math.min(1.4, p.bloom + (def.pellets > 1 ? 0.3 : 0.12));
  state.flash = 1;
  state.shake = Math.min(0.5, state.shake + 0.05);
  state.noises.push({ x: p.x, z: p.z, radius: 30 });
}

// --- Damage ------------------------------------------------------------

export function damageAgent(state, victim, dmg, attacker, isHead) {
  if (!victim.alive) return;
  const absorbed = Math.min(victim.armor, dmg * CONFIG.ARMOR_ABSORB);
  victim.armor -= absorbed;
  victim.hp -= dmg - absorbed;
  if (victim.isPlayer) {
    const dx = attacker.x - victim.x;
    const dz = attacker.z - victim.z;
    const ang = Math.atan2(-dx, -dz);
    state.damageFrom = wrapAngle(ang - victim.yaw);
    state.damageAt = state.time;
    state.shake = Math.min(0.6, state.shake + 0.18);
  }
  if (victim.hp > 0) return;
  victim.hp = 0;
  victim.alive = false;
  victim.deaths += 1;
  if (attacker) attacker.kills += 1;
  const vTeam = victim.team === 'A' ? 'Vanguard' : 'Ember';
  const aTeam = attacker && attacker.team === 'A' ? 'Vanguard' : 'Ember';
  state.feed.push({
    text: `${attacker ? attacker.name : 'The yard'} [${aTeam}] eliminated ${victim.name} [${vTeam}]${isHead ? ' — headshot' : ''}`,
    team: attacker ? attacker.team : 'B',
    at: state.time,
  });
  if (attacker && attacker.isPlayer) {
    state.money += CONFIG.KILL_BONUS;
    state.kills += 1;
    state.killAt = state.time;
    state.sounds.push('kill');
  }
  if (victim.isPlayer) state.deaths += 1;
  // The charge drops where its carrier falls.
  if (state.bomb.carrierId === victim.id && state.bomb.state === 'carried') {
    state.bomb.state = 'dropped';
    state.bomb.carrierId = null;
    state.bomb.x = victim.x;
    state.bomb.z = victim.z;
    state.bomb.plantProgress = 0;
    state.feed.push({ text: 'The charge was dropped', team: 'A', at: state.time });
  }
  checkRoundEnd(state);
}

function aliveCount(state, team) {
  let n = 0;
  if (team === 'A' && state.player.alive) n += 1;
  for (const b of state.bots) if (b.team === team && b.alive) n += 1;
  return n;
}

function checkRoundEnd(state) {
  if (state.phase !== 'live') return;
  if (state.bomb.state === 'planted') return; // the fuse decides now
  if (aliveCount(state, 'A') === 0) endRound(state, 'B', 'Vanguard eliminated');
  else if (aliveCount(state, 'B') === 0) endRound(state, 'A', 'Ember eliminated');
}

// --- Rounds and economy -------------------------------------------------

export function startMatch(state) {
  state.round = 1;
  state.score = { A: 0, B: 0 };
  state.lossStreak = { A: 0, B: 0 };
  state.money = CONFIG.START_MONEY;
  state.kills = 0;
  state.deaths = 0;
  state.matchWinner = null;
  // main.js resets the player and the bots, then calls resetRoundState.
}

// Resets the round-level state (bomb, feed, clock). main.js resets the
// player and the bots themselves before calling this.
export function resetRoundState(state) {
  state.bomb = {
    state: 'carried', carrierId: 'player', site: null,
    x: state.player.x, z: state.player.z,
    plantProgress: 0, defuseProgress: 0, fuse: 0,
  };
  state.grenades = [];
  state.smokes = [];
  state.feed.push({ text: `Round ${state.round} — plant the charge at A or B`, team: 'A', at: state.time });
  state.phase = 'freeze';
  state.timer = CONFIG.FREEZE_TIME;
  state.roundWinner = null;
  state.roundEndReason = '';
}

export function endRound(state, winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.roundWinner = winner;
  state.roundEndReason = reason;
  state.timer = 4.5;
  state.score[winner] += 1;
  if (winner === 'A') {
    state.money += CONFIG.WIN_BONUS;
    state.lossStreak.A = 0;
    state.lossStreak.B += 1;
    state.sounds.push('roundWin');
  } else {
    const bonus = Math.min(
      CONFIG.LOSS_BONUS + CONFIG.LOSS_BONUS_STEP * state.lossStreak.A,
      CONFIG.LOSS_BONUS_MAX,
    );
    state.money += bonus;
    state.lossStreak.A += 1;
    state.lossStreak.B = 0;
    state.sounds.push('roundLose');
  }
  if (state.score.A >= CONFIG.WIN_ROUNDS || state.score.B >= CONFIG.WIN_ROUNDS || state.round >= CONFIG.MAX_ROUNDS) {
    state.matchWinner = state.score.A > state.score.B ? 'A' : state.score.B > state.score.A ? 'B' : null;
  }
}

export function updateRounds(state, map, dt, beginRound) {
  if (state.phase === 'freeze') {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.phase = 'live';
      state.timer = CONFIG.ROUND_TIME;
    }
  } else if (state.phase === 'live') {
    if (state.bomb.state !== 'planted') {
      state.timer -= dt;
      if (state.timer <= 0) endRound(state, 'B', 'Time expired — the charge was never planted');
    }
  } else if (state.phase === 'roundEnd') {
    state.timer -= dt;
    if (state.timer <= 0) {
      if (state.matchWinner || state.round >= CONFIG.MAX_ROUNDS) {
        state.phase = 'matchEnd';
      } else {
        state.round += 1;
        beginRound();
      }
    }
  }
}

// --- The charge ----------------------------------------------------------

export function updateBomb(state, map, input, dt) {
  if (state.phase !== 'live') return;
  const bomb = state.bomb;
  const time = state.time;

  if (bomb.state === 'carried') {
    const carrier = bomb.carrierId === 'player'
      ? state.player
      : state.bots.find((b) => b.id === bomb.carrierId);
    if (!carrier || !carrier.alive) return;
    // Planting: hold E inside a site ring. The carrier bot channels by
    // standing on its site with mode 'plant'.
    const siteKey = siteAt(state, map, carrier.x, carrier.z);
    const channeling = carrier.isPlayer
      ? input.down('KeyE') && siteKey !== null
      : carrier.ai.mode === 'plant' && siteKey === carrier.ai.site;
    if (channeling) {
      bomb.plantProgress += dt;
      if (time - (bomb.lastBeepAt || -10) > 0.5) {
        bomb.lastBeepAt = time;
        state.sounds.push('plantTick');
      }
      if (bomb.plantProgress >= CONFIG.PLANT_TIME) {
        bomb.state = 'planted';
        bomb.site = siteKey;
        bomb.x = carrier.x;
        bomb.z = carrier.z;
        bomb.fuse = CONFIG.FUSE_TIME;
        bomb.plantProgress = 0;
        state.plantedAt = time;
        state.money += CONFIG.PLANT_BONUS;
        state.feed.push({ text: 'The charge is planted — hold the site', team: 'A', at: time });
        state.sounds.push('beep');
      }
    } else {
      bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
    }
  } else if (bomb.state === 'dropped') {
    // Any living Vanguard agent walking over it picks it up.
    const agents = [state.player, ...state.bots.filter((b) => b.team === 'A')];
    for (const a of agents) {
      if (a.alive && distSq2D(a.x, a.z, bomb.x, bomb.z) < 1.2 * 1.2) {
        bomb.state = 'carried';
        bomb.carrierId = a.id;
        state.feed.push({ text: `${a.isPlayer ? 'You picked' : `${a.name} picked`} up the charge`, team: 'A', at: time });
        break;
      }
    }
  } else if (bomb.state === 'planted') {
    bomb.fuse -= dt;
    const interval = Math.max(0.22, bomb.fuse / CONFIG.FUSE_TIME);
    if (time - (bomb.lastBeepAt || -10) > interval) {
      bomb.lastBeepAt = time;
      state.sounds.push('beep');
    }
    // Defusing: a defender bot in defuse mode at the charge.
    let defusing = false;
    for (const b of state.bots) {
      if (b.team === 'B' && b.alive && b.ai.mode === 'defuse'
        && distSq2D(b.x, b.z, bomb.x, bomb.z) < 2.5 * 2.5) {
        defusing = true;
        break;
      }
    }
    if (defusing) {
      bomb.defuseProgress += dt;
      if (bomb.defuseProgress >= CONFIG.DEFUSE_TIME) {
        bomb.state = 'defused';
        endRound(state, 'B', 'The charge was defused');
        return;
      }
    } else {
      bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 2);
    }
    if (bomb.fuse <= 0) {
      bomb.state = 'exploded';
      state.explosionAt = { x: bomb.x, y: 1, z: bomb.z, radius: 9, at: time };
      state.sounds.push('explosion');
      state.shake = 0.6;
      endRound(state, 'A', 'The charge detonated');
    }
  }
}

function siteAt(state, map, x, z) {
  for (const [key, s] of Object.entries(map.sites)) {
    if (distSq2D(x, z, s.x, s.z) < s.r * s.r) return key;
  }
  return null;
}

// --- Grenades -------------------------------------------------------------

export function throwGrenade(state, agent, kind) {
  const def = GRENADES[kind];
  if (agent.grenades[kind] <= 0) return;
  agent.grenades[kind] -= 1;
  agent.grenadeSlot = null;
  const sin = Math.sin(agent.yaw);
  const cos = Math.cos(agent.yaw);
  const cp = Math.cos(agent.pitch);
  state.grenades.push({
    kind,
    x: agent.x - sin * 0.6,
    y: agent.y + agent.eyeHeight - 0.1,
    z: agent.z - cos * 0.6,
    vx: -sin * cp * 15,
    vy: Math.sin(agent.pitch) * 15 + 2.5,
    vz: -cos * cp * 15,
    fuse: def.fuse,
  });
  state.sounds.push('click');
}

export function updateGrenades(state, map, dt) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vy -= 12 * dt;
    // Axis-separated move with a bounce on each blocked axis.
    let nx = g.x + g.vx * dt;
    const probe = { x: nx, z: g.z };
    resolveCircle(nx, g.z, 0.15, map.colliders, probe);
    if (probe.x !== nx) g.vx = -g.vx * 0.4;
    g.x = probe.x;
    let nz = g.z + g.vz * dt;
    probe.x = g.x;
    probe.z = nz;
    resolveCircle(g.x, nz, 0.15, map.colliders, probe);
    if (probe.z !== nz) g.vz = -g.vz * 0.4;
    g.z = probe.z;
    g.y += g.vy * dt;
    if (g.y < 0.12) {
      g.y = 0.12;
      g.vy = -g.vy * 0.35;
      g.vx *= 0.7;
      g.vz *= 0.7;
      if (Math.abs(g.vy) < 0.8) g.vy = 0;
    }
    if (g.fuse > 0) continue;
    state.grenades.splice(i, 1);
    if (g.kind === 'frag') detonateFrag(state, map, g);
    else {
      state.smokes.push({ x: g.x, z: g.z, radius: GRENADES.smoke.radius, until: state.time + GRENADES.smoke.duration });
      state.sounds.push('click');
    }
  }
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (state.time > state.smokes[i].until) state.smokes.splice(i, 1);
  }
}

function detonateFrag(state, map, g) {
  const def = GRENADES.frag;
  state.explosionAt = { x: g.x, y: Math.max(0.6, g.y), z: g.z, radius: def.radius, at: state.time };
  state.sounds.push('explosion');
  state.noises.push({ x: g.x, z: g.z, radius: 40 });
  const p = state.player;
  if (distSq2D(p.x, p.z, g.x, g.z) < 20 * 20) state.shake = Math.min(0.6, state.shake + 0.3);
  const agents = [p, ...state.bots];
  for (const a of agents) {
    if (!a.alive) continue;
    const dSq = distSq2D(a.x, a.z, g.x, g.z);
    if (dSq > def.radius * def.radius) continue;
    if (losBlocked(g.x, g.z, a.x, a.z, map.colliders, null)) continue;
    const dist = Math.sqrt(dSq);
    const dmg = def.maxDamage * (1 - dist / def.radius);
    damageAgent(state, a, dmg, null, false);
  }
}

// --- Buying and weapon handling -------------------------------------------

export function buyPrimary(state, id) {
  if (state.phase !== 'freeze') return false;
  const def = WEAPONS[id];
  if (!def || state.money < def.price) return false;
  state.money -= def.price;
  state.player.weapons[0] = makeWeapon(id);
  state.player.slot = 0;
  state.player.grenadeSlot = null;
  state.sounds.push('buy');
  return true;
}

export function buyGrenade(state, kind) {
  if (state.phase !== 'freeze') return false;
  const def = GRENADES[kind];
  if (!def || state.money < def.price) return false;
  if (state.player.grenades[kind] >= 1) return false;
  state.money -= def.price;
  state.player.grenades[kind] += 1;
  state.sounds.push('buy');
  return true;
}

export function buyArmor(state) {
  if (state.phase !== 'freeze') return false;
  if (state.money < ARMOR_PRICE || state.player.armor >= 100) return false;
  state.money -= ARMOR_PRICE;
  state.player.armor = 100;
  state.sounds.push('buy');
  return true;
}

export function startReload(agent) {
  const w = currentWeapon(agent);
  if (!w || w.reloading || w.mag >= w.def.mag || w.reserve <= 0) return;
  w.reloading = true;
  w.reloadEnd = -1; // updateReloads stamps the end time from the clock
}

export function updateReloads(state) {
  const agents = [state.player, ...state.bots];
  for (const a of agents) {
    const w = currentWeapon(a);
    if (!w || !w.reloading) continue;
    if (w.reloadEnd === -1) {
      w.reloadEnd = state.time + w.def.reload;
      if (a.isPlayer) state.sounds.push('reload');
    }
    if (state.time < w.reloadEnd) continue;
    w.reloading = false;
    if (a.isPlayer) {
      const need = w.def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
    } else {
      w.mag = w.def.mag;
    }
  }
}

// Keys that change weapons, throw grenades or reload. Buy shortcuts only
// apply during the freeze, when the buy menu is open.
export function handleWeaponKeys(state, input) {
  const p = state.player;
  if (!p.alive) return;
  if (state.phase === 'freeze') {
    if (input.wasPressed('Digit1')) buyPrimary(state, BUY_ORDER[0]);
    if (input.wasPressed('Digit2')) buyPrimary(state, BUY_ORDER[1]);
    if (input.wasPressed('Digit3')) buyPrimary(state, BUY_ORDER[2]);
    if (input.wasPressed('Digit4')) buyPrimary(state, BUY_ORDER[3]);
    if (input.wasPressed('Digit5')) buyGrenade(state, 'frag');
    if (input.wasPressed('Digit6')) buyGrenade(state, 'smoke');
    if (input.wasPressed('Digit7')) buyArmor(state);
    return;
  }
  if (state.phase !== 'live') return;
  if (input.wasPressed('Digit1')) {
    p.slot = 0;
    p.grenadeSlot = null;
    state.sounds.push('click');
  }
  if (input.wasPressed('Digit2')) {
    p.slot = 1;
    p.grenadeSlot = null;
    state.sounds.push('click');
  }
  if (input.wasPressed('Digit3') && p.grenades.frag > 0) {
    p.grenadeSlot = 'frag';
    state.sounds.push('click');
  }
  if (input.wasPressed('Digit4') && p.grenades.smoke > 0) {
    p.grenadeSlot = 'smoke';
    state.sounds.push('click');
  }
  if (input.wasPressed('KeyR')) startReload(p);
  if (input.mousePressed && p.grenadeSlot) {
    throwGrenade(state, p, p.grenadeSlot);
  }
  const wheel = input.consumeWheel();
  if (wheel !== 0) {
    p.slot = p.slot === 0 ? 1 : 0;
    p.grenadeSlot = null;
    state.sounds.push('click');
  }
}
