// state.js — one place for every number the game runs on. createState builds
// the whole game state: phases, rounds, money, the bomb, both teams and the
// event lists the systems read and write. Modules mutate this object; none of
// them keeps a second copy of anything that lives here.

import { mulberry32 } from './utils.js';

// Tunables, all in one place so a balance pass touches this file only.
export const CONFIG = {
  SIM_DT: 1 / 60,
  ROUND_TIME: 100, // seconds of live play per round
  FREEZE_TIME: 8, // buy time before a round goes live
  PLANT_TIME: 3.5, // seconds holding E at a site to plant
  DEFUSE_TIME: 5, // seconds holding E at a planted charge to defuse
  FUSE_TIME: 35, // seconds from plant to detonation
  WIN_ROUNDS: 5, // first to this many round wins takes the match
  MAX_ROUNDS: 9,
  START_MONEY: 800,
  WIN_BONUS: 3250,
  LOSS_BONUS: 1900,
  LOSS_BONUS_STEP: 500,
  LOSS_BONUS_MAX: 3400,
  KILL_BONUS: 300,
  PLANT_BONUS: 300,
  PLAYER_SPEED: 4.3,
  CROUCH_SPEED: 2.2,
  BOT_SPEED: 3.4,
  ACCEL: 42,
  FRICTION: 11,
  GRAVITY: 15,
  JUMP_VEL: 5.6,
  EYE_STAND: 1.62,
  EYE_CROUCH: 1.08,
  AGENT_RADIUS: 0.35,
  ARMOR_ABSORB: 0.5, // share of damage kevlar takes before health
  TEAM_SIZE: 5,
};

export const TEAMS = {
  A: { id: 'A', name: 'Vanguard', color: 0x3f8cff, css: '#5ea8ff', spawn: 'A' },
  B: { id: 'B', name: 'Ember', color: 0xff5a3c, css: '#ff7a5c', spawn: 'B' },
};

export function createState(seed) {
  return {
    seed,
    rng: mulberry32(seed),
    time: 0, // seconds since the match started (simulation clock)
    phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
    round: 1,
    score: { A: 0, B: 0 },
    lossStreak: { A: 0, B: 0 },
    timer: 0, // counts down in freeze and live phases
    roundWinner: null, // 'A' | 'B' | null
    roundEndReason: '',
    roundEndAt: 0,
    matchWinner: null,
    money: CONFIG.START_MONEY,
    kills: 0,
    deaths: 0,
    // The charge: carried by the player at round start, dropped where its
    // carrier dies, planted at a site, defused or detonated.
    bomb: {
      state: 'carried', // carried | dropped | planted | defused | exploded
      carrierId: 'player',
      site: null, // 'A' | 'B'
      x: 0, z: 0,
      plantProgress: 0,
      defuseProgress: 0,
      fuse: 0,
    },
    player: null, // agent record, built by player.js
    bots: [], // agent records, built by bots.js
    // Transient events systems raise and others consume, cleared each step.
    noises: [], // { x, z, radius } — gunfire and explosions bots can hear
    sounds: [], // sound names the frame drain plays (see main.js)
    stepTick: false, // set when a footstep lands; the frame drain plays it
    feed: [], // kill feed entries { text, team, at }
    grenades: [], // live thrown grenades { x, y, z, vx, vy, vz, kind, fuse }
    smokes: [], // active smoke clouds { x, z, radius, until }
    tracers: [], // visual shot lines, consumed by effects.js
    impacts: [], // visual impact points { x, y, z }
    shake: 0, // camera shake amount, decays
    flash: 0, // muzzle-flash light strength, decays
    explosionAt: null, // { x, y, z, radius, at } of the latest blast
    hitmarkAt: -10, // time of the last hitmarker
    killAt: -10, // time of the last kill (for the kill chime)
    damageFrom: 0, // yaw of the last damage source, for the HUD indicator
    damageAt: -10,
    plantedAt: 0,
    stats: { shots: 0, hits: 0, headshots: 0 },
  };
}

// Every agent — the player and each bot — has the same record shape.
export function createAgent(id, name, team, isPlayer) {
  return {
    id, name, team, isPlayer,
    alive: true,
    x: 0, y: 0, z: 0, // feet position; y is only the jump hop
    vy: 0,
    yaw: 0, pitch: 0,
    vx: 0, vz: 0, // horizontal velocity, m/s
    hp: 100,
    armor: 0,
    crouched: false,
    eyeHeight: CONFIG.EYE_STAND,
    weapons: [], // [primary, pistol] weapon instances
    slot: 0, // 0 primary, 1 pistol
    grenades: { frag: 0, smoke: 0 },
    grenadeSlot: null, // 'frag' | 'smoke' while a grenade is selected
    kills: 0,
    deaths: 0,
    bloom: 0, // spread bloom from recent fire, decays
    recoil: 0, // pitch kick still to recover
    lastShotAt: -10,
    // Bot-only fields; the player leaves them null.
    ai: null,
  };
}
