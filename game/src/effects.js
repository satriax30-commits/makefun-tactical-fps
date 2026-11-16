// effects.js — every visual effect is a pre-allocated pool: tracer lines,
// impact sparks, smoke sprites, one explosion sphere and a muzzle light.
// The simulation only pushes small records into state (tracers, impacts,
// explosionAt); this module consumes them and owns all three.js objects, so
// the hot loops allocate nothing.

import * as THREE from 'three';

const TRACER_POOL = 24;
const SPARK_COUNT = 240;
const SMOKE_POOL = 10;

function radialTexture(inner, outer) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createEffects(scene) {
  const tex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');

  // Tracer lines: one THREE.Line each, two points, faded out fast.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  // Impact sparks: one THREE.Points, fixed slots, dead sparks parked at y=-100.
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  for (let i = 0; i < SPARK_COUNT; i++) sparkPos[i * 3 + 1] = -100;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffc46b, size: 0.09, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkCursor = 0;

  // Smoke sprites, grey, growing to their cloud radius.
  const smokes = [];
  for (let i = 0; i < SMOKE_POOL; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0x9aa0a8, transparent: true, opacity: 0, depthWrite: false,
    }));
    sprite.scale.set(1, 1, 1);
    scene.add(sprite);
    smokes.push(sprite);
  }

  // Explosion: one expanding sphere plus one light.
  const boomMat = new THREE.MeshBasicMaterial({
    color: 0xff9a2e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), boomMat);
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff8a2e, 0, 30, 1.4);
  scene.add(boomLight);
  let boomLife = 0;
  let boomRadius = 1;

  // Muzzle flash light, positioned at the gun tip each frame.
  const muzzleLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
  scene.add(muzzleLight);
  const muzzleSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false,
  }));
  muzzleSprite.scale.set(0.5, 0.5, 1);
  scene.add(muzzleSprite);

  let lastExplosionAt = -10;

  function spawnTracer(t) {
    let slot = tracers[0];
    for (const s of tracers) if (s.life <= 0) { slot = s; break; }
    const pos = slot.line.geometry.attributes.position.array;
    pos[0] = t.x1; pos[1] = t.y1; pos[2] = t.z1;
    pos[3] = t.x2; pos[4] = t.y2; pos[5] = t.z2;
    slot.line.geometry.attributes.position.needsUpdate = true;
    slot.line.material.color.set(t.team === 'B' ? 0xff8a6a : 0xffd27a);
    slot.life = 0.09;
    slot.line.material.opacity = 0.9;
  }

  function spawnImpact(x, y, z) {
    for (let k = 0; k < 6; k++) {
      const i = sparkCursor;
      sparkCursor = (sparkCursor + 1) % SPARK_COUNT;
      sparkPos[i * 3] = x;
      sparkPos[i * 3 + 1] = y;
      sparkPos[i * 3 + 2] = z;
      sparkVel[i * 3] = (Math.random() - 0.5) * 3;
      sparkVel[i * 3 + 1] = Math.random() * 2.5 + 0.5;
      sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 3;
      sparkLife[i] = 0.35 + Math.random() * 0.25;
    }
  }

  return {
    update(state, dt, muzzle) {
      // Consume the simulation's effect records.
      for (let i = 0; i < state.tracers.length; i++) spawnTracer(state.tracers[i]);
      state.tracers.length = 0;
      for (let i = 0; i < state.impacts.length; i++) {
        const im = state.impacts[i];
        spawnImpact(im.x, im.y, im.z);
      }
      state.impacts.length = 0;
      if (state.explosionAt && state.explosionAt.at !== lastExplosionAt) {
        lastExplosionAt = state.explosionAt.at;
        boomLife = 0.5;
        boomRadius = state.explosionAt.radius;
        boom.position.set(state.explosionAt.x, state.explosionAt.y, state.explosionAt.z);
        boom.visible = true;
      }

      for (const s of tracers) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.line.material.opacity = Math.max(0, s.life / 0.09) * 0.9;
      }

      let anySpark = false;
      for (let i = 0; i < SPARK_COUNT; i++) {
        if (sparkLife[i] <= 0) continue;
        anySpark = true;
        sparkLife[i] -= dt;
        sparkVel[i * 3 + 1] -= 6 * dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        if (sparkLife[i] <= 0 || sparkPos[i * 3 + 1] < 0.02) {
          sparkPos[i * 3 + 1] = -100;
          sparkLife[i] = 0;
        }
      }
      if (anySpark) sparkGeo.attributes.position.needsUpdate = true;

      // Smoke clouds track the live smokes, one sprite each.
      for (let i = 0; i < SMOKE_POOL; i++) {
        const sprite = smokes[i];
        const cloud = state.smokes[i];
        if (!cloud) {
          sprite.material.opacity = 0;
          continue;
        }
        const remain = cloud.until - state.time;
        const fade = Math.min(1, remain / 2);
        sprite.position.set(cloud.x, 1.4, cloud.z);
        const s = cloud.radius * 2 * (1 + 0.1 * Math.sin(state.time + i));
        sprite.scale.set(s, s * 0.8, 1);
        sprite.material.opacity = 0.55 * fade;
      }

      if (boomLife > 0) {
        boomLife -= dt;
        const t = 1 - boomLife / 0.5;
        const r = Math.max(0.1, boomRadius * (0.3 + t * 0.7));
        boom.scale.set(r, r, r);
        boomMat.opacity = Math.max(0, 0.85 * (1 - t));
        boomLight.position.copy(boom.position);
        boomLight.intensity = 60 * (1 - t);
        if (boomLife <= 0) {
          boom.visible = false;
          boomLight.intensity = 0;
        }
      }

      // Muzzle flash follows the viewmodel's tip and the flash timer.
      if (state.flash > 0 && muzzle) {
        muzzleLight.position.copy(muzzle);
        muzzleLight.intensity = 26 * state.flash;
        muzzleSprite.position.copy(muzzle);
        muzzleSprite.material.opacity = 0.9 * state.flash;
        const ms = 0.4 + 0.25 * state.flash;
        muzzleSprite.scale.set(ms, ms, 1);
      } else {
        muzzleLight.intensity = 0;
        muzzleSprite.material.opacity = 0;
      }
      state.flash = Math.max(0, state.flash - dt * 9);
      state.shake = Math.max(0, state.shake - dt * 1.8);
    },
  };
}
