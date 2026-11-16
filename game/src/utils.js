// utils.js — small math and deterministic-random helpers shared by every
// module. Everything here works on plain numbers, so the hot loops allocate
// nothing: callers pass their own temporaries in and out.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// mulberry32: a tiny seeded PRNG. The game takes its randomness from one
// stream (state.rng), so a fixed seed replays the same round.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wrap an angle to [-PI, PI).
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Shortest signed turn from angle a to angle b, in [-PI, PI).
export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

// 2D segment (x1,z1)->(x2,z2) against an XZ axis-aligned box. Walls and
// crates are tall enough that sight and movement only ever need the XZ test.
export function segmentHitsAABB(x1, z1, x2, z2, minX, minZ, maxX, maxZ) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  let tmin = 0;
  let tmax = 1;
  if (dx === 0) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    let t1 = (minX - x1) / dx;
    let t2 = (maxX - x1) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (dz === 0) {
    if (z1 < minZ || z1 > maxZ) return false;
  } else {
    let t1 = (minZ - z1) / dz;
    let t2 = (maxZ - z1) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return true;
}

// 2D segment against a circle (x, z, radius): used for smoke blocking sight.
export function segmentHitsCircle(x1, z1, x2, z2, cx, cz, r) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) {
    const ex = x1 - cx;
    const ez = z1 - cz;
    return ex * ex + ez * ez <= r * r;
  }
  let t = ((cx - x1) * dx + (cz - z1) * dz) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = x1 + dx * t - cx;
  const pz = z1 + dz * t - cz;
  return px * px + pz * pz <= r * r;
}

// Squared distance on the XZ plane.
export function distSq2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
