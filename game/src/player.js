// player.js — the human agent: mouse look, acceleration-based movement,
// crouch and jump, all colliding with the map's AABBs. Firing, reloading and
// the bomb channel are combat's job; this file only moves the player and
// turns intent (keys, mouse) into velocity and aim.

import { CONFIG, createAgent } from './state.js';
import { makeWeapon } from './weapons.js';
import { resolveCircle } from './map.js';
import { clamp, lerp } from './utils.js';

const LOOK_SENS = 0.0022;
const _out = { x: 0, z: 0 };

export function createPlayer() {
  const p = createAgent('player', 'You', 'A', true);
  // Everyone starts with the sidearm in both slots; the buy menu replaces
  // the primary between rounds.
  p.weapons = [makeWeapon('p9'), makeWeapon('p9')];
  p.slot = 0;
  p.stepAcc = 0;
  return p;
}

export function resetPlayerForRound(state, map, spawnIdx) {
  const p = state.player;
  const spawn = map.spawns.A[spawnIdx % map.spawns.A.length];
  p.x = spawn[0];
  p.z = spawn[1];
  p.y = 0;
  p.vy = 0;
  p.vx = 0;
  p.vz = 0;
  p.yaw = -Math.PI / 2; // facing east, down mid toward the sites
  p.pitch = 0;
  p.hp = 100;
  p.alive = true;
  p.crouched = false;
  p.eyeHeight = CONFIG.EYE_STAND;
  p.bloom = 0;
  p.recoil = 0;
  p.grenadeSlot = null;
  for (const w of p.weapons) {
    w.reloading = false;
    if (w.mag < w.def.mag && w.reserve > 0) {
      const need = w.def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
    }
  }
}

export function updatePlayer(state, map, input, dt) {
  const p = state.player;
  if (!p.alive) return;

  // Look. Recoil kicked the pitch up; it recovers on its own.
  const look = input.consumeLook();
  p.yaw -= look.dx * LOOK_SENS;
  p.pitch = clamp(p.pitch - look.dy * LOOK_SENS, -1.55, 1.55);
  if (p.recoil > 0) {
    const rec = Math.min(p.recoil, 2.4 * dt);
    p.pitch -= rec;
    p.recoil -= rec;
  }
  p.bloom = Math.max(0, p.bloom - dt * 1.4);

  // Crouch is held, not toggled.
  p.crouched = input.down('ControlLeft') || input.down('KeyC');
  const targetEye = p.crouched ? CONFIG.EYE_CROUCH : CONFIG.EYE_STAND;
  p.eyeHeight = lerp(p.eyeHeight, targetEye, Math.min(1, dt * 12));

  // Wish direction from keys, relative to yaw. Forward is (-sin yaw, -cos yaw).
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const fwdX = -sin;
  const fwdZ = -cos;
  const rightX = cos;
  const rightZ = -sin;
  let wx = 0;
  let wz = 0;
  if (input.down('KeyW')) { wx += fwdX; wz += fwdZ; }
  if (input.down('KeyS')) { wx -= fwdX; wz -= fwdZ; }
  if (input.down('KeyD')) { wx += rightX; wz += rightZ; }
  if (input.down('KeyA')) { wx -= rightX; wz -= rightZ; }
  const wLen = Math.hypot(wx, wz);
  if (wLen > 1) { wx /= wLen; wz /= wLen; }

  const speed = p.crouched ? CONFIG.CROUCH_SPEED : CONFIG.PLAYER_SPEED;
  const grounded = p.y <= 0.001;
  const accel = grounded ? CONFIG.ACCEL : CONFIG.ACCEL * 0.35;
  const tx = wx * speed;
  const tz = wz * speed;
  p.vx = approach(p.vx, tx, accel * dt);
  p.vz = approach(p.vz, tz, accel * dt);
  // Friction when no key is held.
  if (wLen === 0 && grounded) {
    const f = Math.max(0, 1 - CONFIG.FRICTION * dt);
    p.vx *= f;
    p.vz *= f;
  }

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  resolveCircle(p.x, p.z, CONFIG.AGENT_RADIUS, map.colliders, _out);
  p.x = _out.x;
  p.z = _out.z;
  // Keep inside the yard even if a collider is missed.
  p.x = clamp(p.x, -31.5, 31.5);
  p.z = clamp(p.z, -21.5, 21.5);

  if (input.wasPressed('Space') && grounded) {
    p.vy = CONFIG.JUMP_VEL;
  }
  p.vy -= CONFIG.GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) {
    p.y = 0;
    p.vy = 0;
  }

  // Footsteps: one soft tick every couple of metres on the ground.
  const moved = Math.hypot(p.vx, p.vz) * dt;
  if (grounded && moved > 0.01) {
    p.stepAcc += moved;
    const stride = p.crouched ? 1.6 : 2.4;
    if (p.stepAcc >= stride) {
      p.stepAcc = 0;
      state.stepTick = true;
    }
  }
}

// Move a value toward a target by at most maxDelta.
function approach(v, target, maxDelta) {
  if (v < target) return Math.min(target, v + maxDelta);
  if (v > target) return Math.max(target, v - maxDelta);
  return v;
}
