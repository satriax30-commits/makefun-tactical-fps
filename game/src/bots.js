// bots.js — the nine bots. Each one has a role (attack a site, hold a site,
// roam mid), a path over the waypoint graph, a line of sight and ears.
// They advance along routes, hold angles, react to gunfire they hear, carry
// and plant the charge, and defuse it. Their shots are a probability model:
// a burst of hitscan fire whose hit chance falls with distance, movement
// and a moving target — the same levers the player's spread uses.

import { CONFIG, createAgent } from './state.js';
import { makeWeapon } from './weapons.js';
import { damageAgent } from './combat.js';
import { resolveCircle, losBlocked } from './map.js';
import { angleDiff, clamp, distSq2D, wrapAngle } from './utils.js';

const FRIENDLY_NAMES = ['Vex', 'Mara', 'Juno', 'Kip'];
const ENEMY_NAMES = ['Ash', 'Cinder', 'Rook', 'Slate', 'Fang'];
const FRIENDLY_GUNS = ['ar77', 'vk9', 'ar77', 'sg12'];
const ENEMY_GUNS = ['ar77', 'ar77', 'vk9', 'vk9', 'lw50'];

const _out = { x: 0, z: 0 };

export function createBots(state) {
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const b = createAgent(`f${i}`, FRIENDLY_NAMES[i], 'A', false);
    b.weapons = [makeWeapon(FRIENDLY_GUNS[i]), makeWeapon('p9')];
    b.weapons[0].reserve = 999; // bots never run dry on reserve
    b.ai = newAi('attack', i < 2 ? 'A' : 'B');
    bots.push(b);
  }
  for (let i = 0; i < 5; i++) {
    const b = createAgent(`e${i}`, ENEMY_NAMES[i], 'B', false);
    b.weapons = [makeWeapon(ENEMY_GUNS[i]), makeWeapon('p9')];
    b.weapons[0].reserve = 999;
    b.ai = newAi(i === 4 ? 'roam' : 'defend', i % 2 === 0 ? 'A' : 'B');
    bots.push(b);
  }
  state.bots = bots;
  return bots;
}

function newAi(role, site) {
  return {
    role, site,
    mode: 'advance', // advance | hold | engage | plant | defuse | investigate
    path: [],
    pathIdx: 0,
    holdUntil: 0,
    target: null,
    lastSeenAt: -99,
    lastX: 0,
    lastZ: 0,
    burstLeft: 0,
    nextShot: 0,
    nextBurstAt: 0,
    thinkAt: 0,
    strafeDir: 1,
    strafeAt: 0,
    investigateX: 0,
    investigateZ: 0,
  };
}

export function resetBotsForRound(state, map) {
  const rng = state.rng;
  for (const b of state.bots) {
    const spawns = b.team === 'A' ? map.spawns.A : map.spawns.B;
    const s = spawns[Math.floor(rng() * spawns.length)];
    b.x = s[0] + (rng() - 0.5) * 1.2;
    b.z = s[1] + (rng() - 0.5) * 1.2;
    b.y = 0;
    b.vy = 0;
    b.vx = 0;
    b.vz = 0;
    b.yaw = b.team === 'A' ? -Math.PI / 2 : Math.PI / 2;
    b.pitch = 0;
    b.hp = 100;
    b.armor = 0;
    b.alive = true;
    b.crouched = false;
    b.bloom = 0;
    b.recoil = 0;
    b.grenadeSlot = null;
    b.weapons[0].mag = b.weapons[0].def.mag;
    b.weapons[0].reloading = false;
    b.slot = 0;
    const ai = b.ai;
    ai.mode = 'advance';
    ai.path = [];
    ai.pathIdx = 0;
    ai.holdUntil = 0;
    ai.target = null;
    ai.lastSeenAt = -99;
    ai.burstLeft = 0;
    ai.nextShot = 0;
    ai.nextBurstAt = 0;
    ai.thinkAt = 0;
  }
  assignRoles(state, map);
}

// Attackers split across the two sites; defenders hold them; one roams mid.
function assignRoles(state, map) {
  const attackers = state.bots.filter((b) => b.team === 'A');
  const defenders = state.bots.filter((b) => b.team === 'B');
  attackers.forEach((b, i) => {
    b.ai.role = 'attack';
    b.ai.site = i % 2 === 0 ? 'A' : 'B';
  });
  defenders.forEach((b, i) => {
    if (i === 4) {
      b.ai.role = 'roam';
      b.ai.site = 'A';
    } else {
      b.ai.role = 'defend';
      b.ai.site = i % 2 === 0 ? 'A' : 'B';
    }
  });
}

// BFS over the waypoint graph. Returns an array of node ids, start excluded.
export function findPath(nodes, fromId, toId) {
  if (fromId === toId) return [];
  const prev = new Map();
  const queue = [fromId];
  prev.set(fromId, null);
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toId) break;
    for (const n of nodes[cur].links) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        queue.push(n);
      }
    }
  }
  if (!prev.has(toId)) return [];
  const path = [];
  let cur = toId;
  while (cur !== null && cur !== fromId) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  return path;
}

function nearestNode(nodes, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const n of Object.values(nodes)) {
    const d = distSq2D(x, z, n.x, n.z);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function setPathTo(ai, nodes, fromX, fromZ, toId) {
  const from = nearestNode(nodes, fromX, fromZ);
  ai.path = findPath(nodes, from.id, toId);
  ai.pathIdx = 0;
}

// A site's approach nodes: the last waypoint before the site ring.
const SITE_NODES = { A: ['AS0', 'AS1', 'AS2'], B: ['BS0', 'BS1', 'BS2'] };

function siteNodeFor(ai, state) {
  const opts = SITE_NODES[ai.site];
  return opts[Math.floor(state.rng() * opts.length)];
}

export function updateBots(state, map, dt) {
  const time = state.time;
  for (const b of state.bots) {
    if (!b.alive) continue;
    const ai = b.ai;
    if (state.phase === 'freeze') {
      // Hold the spawn, face the yard.
      b.yaw = b.team === 'A' ? -Math.PI / 2 : Math.PI / 2;
      continue;
    }
    if (state.phase !== 'live') continue;

    // Think on a stagger so nine bots never all scan on the same step.
    if (time >= ai.thinkAt) {
      ai.thinkAt = time + 0.12 + (b.id.charCodeAt(1) % 5) * 0.02;
      scan(state, map, b);
    }

    // Hearing: a loud noise nearby becomes an investigation.
    if (ai.mode !== 'engage') {
      for (const n of state.noises) {
        if (distSq2D(b.x, b.z, n.x, n.z) < n.radius * n.radius) {
          ai.investigateX = n.x;
          ai.investigateZ = n.z;
          if (ai.mode !== 'investigate') {
            ai.mode = 'investigate';
            setPathTo(ai, map.waypoints, b.x, b.z, nearestNode(map.waypoints, n.x, n.z).id);
          }
          break;
        }
      }
    }

    // The charge drives the mode: carrier plants, defenders defuse.
    const bomb = state.bomb;
    if (bomb.state === 'planted' && b.team === 'B' && ai.mode !== 'engage') {
      if (ai.mode !== 'defuse') {
        ai.mode = 'defuse';
        setPathTo(ai, map.waypoints, b.x, b.z, siteNodeFor(ai, state));
      }
    } else if (bomb.carrierId === b.id && bomb.state === 'carried' && ai.mode !== 'engage') {
      if (ai.mode !== 'plant') {
        ai.mode = 'plant';
        setPathTo(ai, map.waypoints, b.x, b.z, siteNodeFor(ai, state));
      }
    }

    if (ai.mode === 'engage' && ai.target) {
      engage(state, map, b, dt);
    } else if (ai.mode === 'plant' && atSite(state, map, b, ai.site)) {
      // Stand on the site and channel the plant; combat.js advances it.
      b.vx = 0;
      b.vz = 0;
      faceToward(b, map.sites[ai.site].x, map.sites[ai.site].z, dt, 6);
    } else if (ai.mode === 'defuse' && bomb.state === 'planted' && nearBomb(state, b)) {
      b.vx = 0;
      b.vz = 0;
      faceToward(b, bomb.x, bomb.z, dt, 6);
    } else {
      walkPath(state, map, b, dt);
    }
  }
}

function atSite(state, map, b, siteKey) {
  const s = map.sites[siteKey];
  return distSq2D(b.x, b.z, s.x, s.z) < s.r * s.r;
}

function nearBomb(state, b) {
  return distSq2D(b.x, b.z, state.bomb.x, state.bomb.z) < 2.5 * 2.5;
}

// Look for a visible enemy. FOV is ~110 degrees, wider up close; smoke and
// walls block sight through losBlocked.
function scan(state, map, b) {
  const ai = b.ai;
  const enemies = b.team === 'A'
    ? state.bots.filter((o) => o.team === 'B' && o.alive)
    : [state.player, ...state.bots.filter((o) => o.team === 'A' && o.alive)];
  let best = null;
  let bestD = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dSq = distSq2D(b.x, b.z, e.x, e.z);
    if (dSq > 48 * 48) continue;
    const dx = e.x - b.x;
    const dz = e.z - b.z;
    const dist = Math.sqrt(dSq);
    // Facing: forward is (-sin yaw, -cos yaw).
    const fx = -Math.sin(b.yaw);
    const fz = -Math.cos(b.yaw);
    const dot = (dx * fx + dz * fz) / dist;
    if (dot < 0.2 && dist > 8) continue; // outside the view cone
    if (losBlocked(b.x, b.z, e.x, e.z, map.colliders, state.smokes)) continue;
    if (dSq < bestD) {
      bestD = dSq;
      best = e;
    }
  }
  if (best) {
    ai.target = best;
    ai.lastSeenAt = state.time;
    ai.lastX = best.x;
    ai.lastZ = best.z;
    ai.mode = 'engage';
  } else if (ai.mode === 'engage' && state.time - ai.lastSeenAt > 0.6) {
    ai.target = null;
    ai.mode = ai.role === 'defend' ? 'hold' : 'advance';
    ai.path = [];
  }
}

function engage(state, map, b, dt) {
  const ai = b.ai;
  const t = ai.target;
  if (!t || !t.alive) {
    ai.target = null;
    ai.mode = 'advance';
    ai.path = [];
    return;
  }
  const dist = Math.hypot(t.x - b.x, t.z - b.z);
  // Face the target, strafing sideways now and then so the duel moves.
  if (state.time >= ai.strafeAt) {
    ai.strafeAt = state.time + 0.8 + state.rng() * 1.2;
    ai.strafeDir = state.rng() < 0.5 ? -1 : 1;
  }
  const wantYaw = Math.atan2(-(t.x - b.x), -(t.z - b.z));
  b.yaw += clamp(angleDiff(b.yaw, wantYaw), -5 * dt, 5 * dt);

  const w = b.weapons[b.slot];
  const speed = dist > 14 ? CONFIG.BOT_SPEED * 0.8 : 0;
  const strafeX = Math.cos(b.yaw) * ai.strafeDir * (dist < 14 ? 1.4 : 0);
  const strafeZ = -Math.sin(b.yaw) * ai.strafeDir * (dist < 14 ? 1.4 : 0);
  const towardX = dist > 14 ? (-Math.sin(b.yaw)) * speed : 0;
  const towardZ = dist > 14 ? (-Math.cos(b.yaw)) * speed : 0;
  b.vx = towardX + strafeX;
  b.vz = towardZ + strafeZ;
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  resolveCircle(b.x, b.z, CONFIG.AGENT_RADIUS, map.colliders, _out);
  b.x = _out.x;
  b.z = _out.z;

  // Burst fire: 3–5 shots, then a pause. Accuracy falls with distance and
  // with either side moving — the same trade the player makes.
  if (state.time >= ai.nextBurstAt && ai.burstLeft <= 0) {
    ai.burstLeft = 3 + Math.floor(state.rng() * 3);
  }
  if (ai.burstLeft > 0 && state.time >= ai.nextShot && !w.reloading) {
    if (w.mag <= 0) {
      w.reloading = true;
      w.reloadEnd = state.time + w.def.reload;
    } else {
      botShoot(state, b, t, dist);
      ai.burstLeft -= 1;
      ai.nextShot = state.time + 60 / w.def.rpm;
      if (ai.burstLeft <= 0) ai.nextBurstAt = state.time + 0.45 + state.rng() * 0.6;
    }
  }
  if (w.reloading && state.time >= w.reloadEnd) {
    w.reloading = false;
    w.mag = w.def.mag;
  }
}

function botShoot(state, b, t, dist) {
  const w = b.weapons[b.slot];
  const rng = state.rng;
  w.mag -= 1;
  w.lastShotAt = state.time;
  const targetSpeed = Math.hypot(t.vx, t.vz);
  const botSpeed = Math.hypot(b.vx, b.vz);
  let p = 0.55 - (dist / 48) * 0.3;
  if (targetSpeed > 1) p *= 0.75;
  if (botSpeed > 1) p *= 0.65;
  if (t.crouched) p *= 0.85;
  p = clamp(p, 0.05, 0.7);

  const muzzleX = b.x - Math.sin(b.yaw) * 0.5;
  const muzzleZ = b.z - Math.cos(b.yaw) * 0.5;
  const muzzleY = 1.45;
  let hitX;
  let hitY;
  let hitZ;
  let hit = false;
  let head = false;
  if (rng() < p) {
    hit = true;
    head = rng() < 0.15;
    hitX = t.x;
    hitY = head ? 1.55 : 1.1;
    hitZ = t.z;
  } else {
    // Miss wide of the target, so the tracer still tells the story.
    const mx = (rng() - 0.5) * 2.4;
    const mz = (rng() - 0.5) * 2.4;
    hitX = t.x + mx;
    hitY = 0.6 + rng() * 1.2;
    hitZ = t.z + mz;
  }
  state.tracers.push({
    x1: muzzleX, y1: muzzleY, z1: muzzleZ,
    x2: hitX, y2: hitY, z2: hitZ,
    at: state.time, team: b.team,
  });
  state.noises.push({ x: b.x, z: b.z, radius: 28 });
  const distToPlayer = Math.hypot(b.x - state.player.x, b.z - state.player.z);
  if (distToPlayer < 45) state.sounds.push(w.def.sound);
  if (hit) {
    const falloff = dist > w.def.range ? 0.6 : 1;
    const dmg = w.def.damage * (head ? w.def.headMult : 1) * falloff;
    damageAgent(state, t, dmg, b, head);
  }
}

function walkPath(state, map, b, dt) {
  const ai = b.ai;
  // No path yet: pick one for the role.
  if (ai.path.length === 0) {
    if (ai.mode === 'investigate') {
      ai.mode = 'hold';
      ai.holdUntil = state.time + 1.5;
      return;
    }
    if (ai.role === 'attack') {
      setPathTo(ai, map.waypoints, b.x, b.z, siteNodeFor(ai, state));
    } else if (ai.role === 'defend') {
      const holdNodes = ai.site === 'A'
        ? ['A4', 'AS2', 'A2']
        : ['B4', 'BS2', 'B2'];
      const node = holdNodes[Math.floor(state.rng() * holdNodes.length)];
      setPathTo(ai, map.waypoints, b.x, b.z, node);
    } else {
      // Roam: pick a random mid node.
      const mids = ['M1', 'M3', 'M4', 'N2', 'S2'];
      setPathTo(ai, map.waypoints, b.x, b.z, mids[Math.floor(state.rng() * mids.length)]);
    }
    ai.mode = 'advance';
  }
  if (ai.mode === 'hold') {
    b.vx = 0;
    b.vz = 0;
    // Scan the lane: slow yaw sweep.
    b.yaw += Math.sin(state.time * 0.5 + b.id.charCodeAt(1)) * 0.4 * dt;
    if (state.time >= ai.holdUntil) {
      ai.mode = 'advance';
      ai.path = [];
    }
    return;
  }
  const node = map.waypoints[ai.path[ai.pathIdx]];
  if (!node) {
    ai.path = [];
    return;
  }
  const dx = node.x - b.x;
  const dz = node.z - b.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.7) {
    ai.pathIdx += 1;
    if (ai.pathIdx >= ai.path.length) {
      ai.path = [];
      ai.mode = 'hold';
      ai.holdUntil = state.time + (ai.role === 'defend' ? 4 + state.rng() * 3 : 1.2);
    }
    return;
  }
  const speed = CONFIG.BOT_SPEED;
  b.vx = (dx / dist) * speed;
  b.vz = (dz / dist) * speed;
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  resolveCircle(b.x, b.z, CONFIG.AGENT_RADIUS, map.colliders, _out);
  b.x = _out.x;
  b.z = _out.z;
  faceToward(b, node.x, node.z, dt, 5);
}

function faceToward(b, x, z, dt, rate) {
  const wantYaw = Math.atan2(-(x - b.x), -(z - b.z));
  b.yaw += clamp(angleDiff(b.yaw, wantYaw), -rate * dt, rate * dt);
  b.yaw = wrapAngle(b.yaw);
}
