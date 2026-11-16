// hud.js — the DOM layer: health, ammo, money, timer, score, kill feed,
// crosshair, buy menu and overlays. It reads state once a frame and only
// touches the DOM when a value actually changed, so the frame stays cheap.

import { ARMOR_PRICE, BUY_ORDER, GRENADES, WEAPONS, currentWeapon, spreadFor } from './weapons.js';
import { CONFIG } from './state.js';

export function createHud(state, callbacks) {
  const el = (id) => document.getElementById(id);
  const els = {
    hud: el('hud'),
    ammo: el('ammo'),
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    weaponName: el('weapon-name'),
    grenades: el('grenades'),
    healthNum: el('health-num'),
    healthBar: el('health-bar'),
    armorNum: el('armor-num'),
    armorBar: el('armor-bar'),
    money: el('money'),
    timer: el('timer'),
    roundLabel: el('round-label'),
    scoreA: el('score-a'),
    scoreB: el('score-b'),
    alive: el('alive'),
    feed: el('feed'),
    objective: el('objective'),
    hint: el('hint'),
    bombStatus: el('bomb-status'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    vignette: el('vignette'),
    buyMenu: el('buy-menu'),
    buyItems: el('buy-items'),
    buyMoney: el('buy-money'),
    menuOverlay: el('menu-overlay'),
    playBtn: el('play-btn'),
    endOverlay: el('end-overlay'),
    endTitle: el('end-title'),
    endSub: el('end-sub'),
    restartBtn: el('restart-btn'),
    deathNote: el('death-note'),
    scope: el('scope'),
  };

  // Build the buy menu once from the weapon definitions.
  const buyRows = [];
  function buyRow(key, name, price, desc, onBuy) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${name}</span><span class="buy-desc">${desc}</span><span class="buy-price">$${price}</span>`;
    row.addEventListener('click', () => onBuy());
    els.buyItems.appendChild(row);
    buyRows.push({ row, price });
    return row;
  }
  BUY_ORDER.forEach((id, i) => {
    const def = WEAPONS[id];
    buyRow(String(i + 1), def.name, def.price, `${def.kind} · ${def.damage} dmg · ${def.mag} rounds`, () => callbacks.buyPrimary(id));
  });
  buyRow('5', GRENADES.frag.name, GRENADES.frag.price, 'Blast damage in a 6 m radius', () => callbacks.buyGrenade('frag'));
  buyRow('6', GRENADES.smoke.name, GRENADES.smoke.price, 'Blocks sight for 12 seconds', () => callbacks.buyGrenade('smoke'));
  buyRow('7', 'Kevlar Vest', ARMOR_PRICE, 'Absorbs half of incoming damage', () => callbacks.buyArmor());
  buyRows.push({ row: null, price: 0 });

  els.playBtn.addEventListener('click', () => callbacks.play());
  els.restartBtn.addEventListener('click', () => callbacks.play());

  const last = {};
  function setText(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }
  function setWidth(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.style.width = value;
    }
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function aliveCount(team) {
    let n = 0;
    if (team === 'A' && state.player.alive) n += 1;
    for (const b of state.bots) if (b.team === team && b.alive) n += 1;
    return n;
  }

  let feedLen = 0;
  function renderFeed() {
    const entries = state.feed.slice(-5);
    if (entries.length === feedLen && entries.length > 0) return;
    feedLen = entries.length;
    els.feed.innerHTML = '';
    for (const e of entries) {
      const div = document.createElement('div');
      div.className = `feed-item team-${e.team.toLowerCase()}`;
      div.textContent = e.text;
      els.feed.appendChild(div);
    }
  }

  return {
    update(input) {
      const p = state.player;
      const w = p ? currentWeapon(p) : null;

      // The menu and match-end overlays are their own DOM; the in-game HUD
      // stays hidden while either of them is up.
      els.hud.style.display = (state.phase === 'menu' || state.phase === 'matchEnd') ? 'none' : '';

      // Crosshair gap follows the live spread: still is tight, moving is wide.
      if (w && p.alive && (state.phase === 'live' || state.phase === 'freeze')) {
        const speed = Math.hypot(p.vx, p.vz);
        const spread = spreadFor(p, w.def, speed, p.y > 0.01);
        const gap = Math.round(4 + spread * 7);
        if (last.gap !== gap) {
          last.gap = gap;
          els.crosshair.style.setProperty('--gap', `${gap}px`);
        }
      }
      const scoped = !!(input && input.aiming && w && w.def.zoom && p.alive && state.phase === 'live');
      els.scope.hidden = !scoped;
      els.crosshair.style.visibility = scoped ? 'hidden' : 'visible';

      // Hitmarker: 150 ms after a hit lands.
      els.hitmarker.classList.toggle('on', state.time - state.hitmarkAt < 0.15);

      // Damage vignette from the last hit, and a direction tick.
      const dmgAge = state.time - state.damageAt;
      els.vignette.style.opacity = dmgAge < 0.6 ? String(0.55 * (1 - dmgAge / 0.6)) : '0';
      els.vignette.style.setProperty('--dmg-angle', `${(state.damageFrom * 180) / Math.PI}deg`);

      if (p) {
        setText(els.healthNum, 'hp', String(Math.max(0, Math.ceil(p.hp))));
        setWidth(els.healthBar, 'hpw', `${Math.max(0, p.hp)}%`);
        els.healthBar.classList.toggle('low', p.hp <= 30);
        setText(els.armorNum, 'armor', String(Math.ceil(p.armor)));
        setWidth(els.armorBar, 'arw', `${Math.max(0, p.armor)}%`);
        setText(els.money, 'money', `$${state.money.toLocaleString('en-US')}`);
        if (w) {
          setText(els.ammoMag, 'mag', w.reloading ? '--' : String(w.mag));
          setText(els.ammoReserve, 'res', `/ ${w.reserve >= 999 ? '∞' : w.reserve}`);
          setText(els.weaponName, 'wname', `${w.def.name}${w.reloading ? ' — reloading' : ''}`);
        }
        const g = p.grenades;
        setText(els.grenades, 'gren', `Frag ${g.frag} · Smoke ${g.smoke}${p.grenadeSlot ? ` — ${p.grenadeSlot} selected, click to throw` : ''}`);
      }

      setText(els.roundLabel, 'round', `Round ${state.round} / ${CONFIG.MAX_ROUNDS}`);
      setText(els.scoreA, 'sa', String(state.score.A));
      setText(els.scoreB, 'sb', String(state.score.B));
      setText(els.alive, 'alive', `Vanguard ${aliveCount('A')} · Ember ${aliveCount('B')}`);
      if (state.phase === 'live' && state.bomb.state === 'planted') {
        setText(els.timer, 'timer', `PLANTED ${fmtTime(state.bomb.fuse)}`);
      } else if (state.phase === 'freeze') {
        setText(els.timer, 'timer', `BUY ${fmtTime(state.timer)}`);
      } else {
        setText(els.timer, 'timer', fmtTime(state.timer));
      }

      // Objective line follows the charge.
      const bomb = state.bomb;
      let objective = '';
      if (state.phase === 'freeze') objective = 'Buy phase — spend your money, then the round goes live';
      else if (bomb.state === 'carried' && bomb.carrierId === 'player') objective = 'You carry the charge — plant it at A or B (hold E in the ring)';
      else if (bomb.state === 'carried') objective = `${botName(state, bomb.carrierId)} carries the charge — cover them`;
      else if (bomb.state === 'dropped') objective = 'The charge was dropped — walk over it to pick it up';
      else if (bomb.state === 'planted') objective = `Charge planted at ${bomb.site} — defend it until it detonates`;
      else if (bomb.state === 'defused') objective = 'The charge was defused';
      else if (bomb.state === 'exploded') objective = 'The charge detonated';
      setText(els.objective, 'obj', objective);

      // Bomb status chip: plant/defuse progress as a bar.
      let bombText = '';
      if (bomb.state === 'carried' && bomb.plantProgress > 0) {
        bombText = `PLANTING ${Math.round((bomb.plantProgress / CONFIG.PLANT_TIME) * 100)}%`;
      } else if (bomb.state === 'planted' && bomb.defuseProgress > 0) {
        bombText = `DEFUSING ${Math.round((bomb.defuseProgress / CONFIG.DEFUSE_TIME) * 100)}%`;
      }
      setText(els.bombStatus, 'bomb', bombText);
      els.bombStatus.hidden = bombText === '';

      // Context hint.
      let hint = '';
      if (state.phase === 'live' && p && !p.alive) hint = 'You were eliminated — spectating a teammate. Next round you are back in.';
      else if (state.phase === 'live' && p && p.grenadeSlot) hint = 'Click to throw the grenade';
      else if (!input.locked && !input.noLock && (state.phase === 'live' || state.phase === 'freeze')) hint = 'Click the game to capture the mouse';
      setText(els.hint, 'hint', hint);

      renderFeed();

      // Round-end banner.
      const showBanner = state.phase === 'roundEnd';
      els.banner.hidden = !showBanner;
      if (showBanner) {
        const won = state.roundWinner === 'A';
        setText(els.bannerTitle, 'bt', won ? 'ROUND WON' : 'ROUND LOST');
        els.bannerTitle.classList.toggle('lost', !won);
        setText(els.bannerSub, 'bs', state.roundEndReason);
      }

      // Buy menu: open during the freeze, B toggles it. The ammo block sits
      // under the menu's right-hand panel, so it hides while buying.
      const showBuy = state.phase === 'freeze';
      els.buyMenu.hidden = !showBuy;
      els.ammo.style.visibility = showBuy ? 'hidden' : 'visible';
      if (showBuy) {
        setText(els.buyMoney, 'bmoney', `$${state.money.toLocaleString('en-US')}`);
        for (const { row, price } of buyRows) {
          if (row) row.classList.toggle('cant', state.money < price);
        }
      }

      // Overlays.
      els.menuOverlay.hidden = state.phase !== 'menu';
      els.endOverlay.hidden = state.phase !== 'matchEnd';
      if (state.phase === 'matchEnd') {
        const won = state.matchWinner === 'A';
        setText(els.endTitle, 'et', state.matchWinner ? (won ? 'VANGUARD WINS THE MATCH' : 'EMBER WINS THE MATCH') : 'MATCH DRAWN');
        setText(els.endSub, 'es', `Final score ${state.score.A} — ${state.score.B} · ${state.kills} eliminations · ${state.stats.hits}/${state.stats.shots} shots hit`);
      }
      els.deathNote.hidden = !(state.phase === 'live' && p && !p.alive);
    },
  };
}

function botName(state, id) {
  const b = state.bots.find((o) => o.id === id);
  return b ? b.name : 'A teammate';
}
