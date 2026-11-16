// weapons.js — every weapon's definition and the helpers that turn a weapon
// plus a shooter's movement into a shot. Damage, fire rate, spread and price
// all live here; the raycast and the damage itself live in combat.js.

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 34, headMult: 2, pellets: 1, rpm: 400, auto: false,
    mag: 12, reserve: 36, reload: 1.5,
    spread: 0.55, moveSpread: 1.6, range: 60, kick: 0.35, sound: 'pistol',
  },
  vk9: {
    id: 'vk9', name: 'VK-9 Ripper', kind: 'smg', price: 1200,
    damage: 22, headMult: 2, pellets: 1, rpm: 750, auto: true,
    mag: 32, reserve: 96, reload: 2.1,
    spread: 0.9, moveSpread: 2.2, range: 45, kick: 0.28, sound: 'smg',
  },
  ar77: {
    id: 'ar77', name: 'AR-77 Longshot', kind: 'rifle', price: 2700,
    damage: 33, headMult: 2, pellets: 1, rpm: 600, auto: true,
    mag: 30, reserve: 90, reload: 2.4,
    spread: 0.35, moveSpread: 1.8, range: 80, kick: 0.5, sound: 'rifle',
  },
  sg12: {
    id: 'sg12', name: 'SG-12 Breacher', kind: 'shotgun', price: 1700,
    damage: 11, headMult: 2, pellets: 8, rpm: 75, auto: false,
    mag: 6, reserve: 24, reload: 2.7,
    spread: 2.6, moveSpread: 2.0, range: 26, kick: 1.1, sound: 'shotgun',
  },
  lw50: {
    id: 'lw50', name: 'LW-50 Marksman', kind: 'sniper', price: 4750,
    damage: 110, headMult: 2, pellets: 1, rpm: 45, auto: false,
    mag: 5, reserve: 15, reload: 3.1,
    spread: 0.06, moveSpread: 3.5, range: 120, kick: 1.6, sound: 'sniper',
    zoom: true,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, radius: 6, maxDamage: 100, fuse: 2.2 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 200, radius: 4, duration: 12, fuse: 1.4 },
};

export const ARMOR_PRICE = 650;
export const BUY_ORDER = ['vk9', 'ar77', 'sg12', 'lw50'];

// A weapon instance: the definition plus the ammo and timing a fight needs.
export function makeWeapon(id) {
  const def = WEAPONS[id];
  return {
    def, mag: def.mag, reserve: def.reserve,
    nextShot: 0, reloading: false, reloadEnd: 0,
  };
}

export function currentWeapon(agent) {
  return agent.weapons[agent.slot];
}

// Spread in degrees for one shot. Standing still and crouched is the tight
// group; moving, airborne and firing fast all open it up — stopping to aim
// pays, firing on the move does not.
export function spreadFor(agent, def, speed, airborne) {
  const move = speed / 4.3; // 0 still, ~1 at full sprint
  let spread = def.spread;
  spread *= 1 + def.moveSpread * move;
  if (airborne) spread *= 1.8;
  if (agent.crouched) spread *= 0.65;
  spread += agent.bloom;
  return spread;
}

// Seconds between shots for a fire rate in rounds per minute.
export function shotInterval(def) {
  return 60 / def.rpm;
}
