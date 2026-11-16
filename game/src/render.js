// render.js — everything the eye sees: the three.js renderer, dusk lighting,
// the player viewmodel, the bot bodies with health bars, the charge mesh and
// the camera. The simulation never touches three.js; it writes positions into
// state and this module syncs meshes to it once a frame.

import * as THREE from 'three';
import { TEAMS } from './state.js';
import { currentWeapon } from './weapons.js';

const _muzzle = new THREE.Vector3();
const _shake = new THREE.Vector3();

export function createRender(state, container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141a24);
  scene.fog = new THREE.Fog(0x1a2230, 40, 130);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 240);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  // A small warm light riding the camera so the viewmodel gun reads as a
  // gun instead of a black silhouette; its range is too short to wash out
  // the map.
  const vmLight = new THREE.PointLight(0xffe0b3, 0.9, 2.5);
  camera.add(vmLight);

  const hemi = new THREE.HemisphereLight(0x9a8a6a, 0x1a1c20, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.1);
  sun.position.set(28, 42, -24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // The player's gun: dark steel boxes on the camera, with a muzzle tip.
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x3d4046, roughness: 0.45, metalness: 0.7 });
  const gunAccent = new THREE.MeshStandardMaterial({ color: 0x565b64, roughness: 0.5, metalness: 0.6 });
  const viewmodel = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.55), gunMetal);
  viewmodel.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 10), gunAccent);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.45);
  viewmodel.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), gunMetal);
  mag.position.set(0, -0.14, -0.05);
  mag.rotation.x = 0.25;
  viewmodel.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), gunAccent);
  sight.position.set(0, 0.1, -0.1);
  viewmodel.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), gunMetal);
  grip.position.set(0, -0.13, 0.16);
  grip.rotation.x = 0.4;
  viewmodel.add(grip);
  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0, 0.02, -0.68);
  viewmodel.add(muzzleTip);
  viewmodel.position.set(0.26, -0.24, -0.45);
  camera.add(viewmodel);

  // The charge: a dark case with a blinking amber lamp.
  const bombMesh = new THREE.Group();
  const bombCase = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.22, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 }),
  );
  bombCase.castShadow = true;
  bombMesh.add(bombCase);
  const bombLampMat = new THREE.MeshStandardMaterial({ color: 0x2a2108, emissive: 0xffb02e, emissiveIntensity: 2 });
  const bombLamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), bombLampMat);
  bombLamp.position.set(0, 0.14, 0);
  bombMesh.add(bombLamp);
  bombMesh.visible = false;
  scene.add(bombMesh);

  const botRecords = new Map();
  let shootables = [];

  function buildBotMesh(agent) {
    const teamColor = TEAMS[agent.team].color;
    const group = new THREE.Group();
    const torsoMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.85 });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: teamColor, emissiveIntensity: 1.4, roughness: 0.3,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.72, 4, 10), torsoMat);
    body.position.y = 0.98;
    body.castShadow = true;
    body.userData = { kind: 'bot', agent, part: 'body' };
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), darkMat);
    head.position.y = 1.62;
    head.castShadow = true;
    head.userData = { kind: 'bot', agent, part: 'head' };
    group.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.06), visorMat);
    visor.position.set(0, 1.63, -0.18);
    group.add(visor);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.72), darkMat);
    gun.position.set(0.18, 1.15, -0.35);
    gun.castShadow = true;
    group.add(gun);
    // Legs, simple dark columns so the silhouette reads at a glance.
    for (const sx of [-0.14, 0.14]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), darkMat);
      leg.position.set(sx, 0.28, 0);
      group.add(leg);
    }
    // Health bar above the head, billboarded to the camera each frame.
    const barGroup = new THREE.Group();
    barGroup.position.y = 2.05;
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x111214, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    const barFg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.06),
      new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    barFg.position.z = 0.001;
    barGroup.add(barBg);
    barGroup.add(barFg);
    group.add(barGroup);
    scene.add(group);
    return { group, body, head, barGroup, barFg, deathT: 0, bobPhase: Math.random() * 6 };
  }

  function bindMap(map) {
    for (const b of state.bots) {
      const rec = buildBotMesh(b);
      botRecords.set(b.id, rec);
    }
    shootables = [...map.solids];
    for (const rec of botRecords.values()) {
      shootables.push(rec.body, rec.head);
    }
  }

  let vmKick = 0;

  function sync(dt, input, map) {
    const p = state.player;
    const mode = state.phase;
    // Camera: first person while playing (or spectating a living teammate
    // after death), free otherwise — main.js places it for the menu.
    let follow = p;
    if (p && !p.alive && (mode === 'live' || mode === 'roundEnd')) {
      follow = state.bots.find((b) => b.team === 'A' && b.alive) || p;
    }
    if ((mode === 'freeze' || mode === 'live' || mode === 'roundEnd') && follow) {
      const shakeAmt = state.shake;
      _shake.set(
        (Math.random() - 0.5) * 0.02 * shakeAmt,
        (Math.random() - 0.5) * 0.02 * shakeAmt,
        0,
      );
      camera.position.set(follow.x, follow.y + follow.eyeHeight, follow.z);
      camera.rotation.set(follow.pitch + _shake.y, follow.yaw + _shake.x, 0);
      // Sniper scope: right mouse narrows the field of view.
      const w = currentWeapon(p);
      const scoped = input && input.aiming && w && w.def.zoom && p.alive;
      const targetFov = scoped ? 32 : 75;
      if (Math.abs(camera.fov - targetFov) > 0.1) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
        camera.updateProjectionMatrix();
      }
      viewmodel.visible = p.alive;
      // Viewmodel kick and reload dip.
      vmKick = Math.max(0, vmKick - dt * 6);
      const reloading = w && w.reloading;
      let dip = 0;
      if (reloading && w.reloadEnd > state.time) {
        const total = w.def.reload;
        const done = 1 - (w.reloadEnd - state.time) / total;
        dip = Math.sin(Math.min(1, Math.max(0, done)) * Math.PI) * 0.35;
      }
      viewmodel.position.z = -0.45 + vmKick * 0.14;
      viewmodel.rotation.x = dip;
    } else {
      viewmodel.visible = false;
    }

    // Bots: positions, facing, walk bob, death fall, health bars. When the
    // camera spectates a bot, that bot's own mesh is hidden — the camera
    // sits at its eye, and its body would fill the screen.
    for (const b of state.bots) {
      const rec = botRecords.get(b.id);
      if (!rec) continue;
      rec.group.visible = !(follow && follow !== p && follow === b);
      rec.group.position.set(b.x, b.y, b.z);
      rec.group.rotation.y = b.yaw;
      const moving = Math.hypot(b.vx, b.vz);
      if (b.alive) {
        rec.group.rotation.z = 0;
        rec.group.position.y = b.y + Math.abs(Math.sin(state.time * 11 + rec.bobPhase)) * 0.04 * Math.min(1, moving / 3);
        rec.deathT = 0;
      } else {
        rec.deathT = Math.min(1, rec.deathT + dt * 3);
        rec.group.rotation.z = -Math.PI / 2 * rec.deathT;
        rec.group.position.y = 0.25 * rec.deathT;
      }
      rec.barGroup.visible = b.alive;
      if (b.alive) {
        rec.barGroup.quaternion.copy(camera.quaternion);
        rec.barFg.scale.x = Math.max(0.001, b.hp / 100);
        rec.barFg.position.x = -0.34 * (1 - b.hp / 100);
      }
    }

    // The charge sits where it was dropped or planted, lamp blinking.
    const bomb = state.bomb;
    if (bomb.state === 'dropped' || bomb.state === 'planted') {
      bombMesh.visible = true;
      bombMesh.position.set(bomb.x, 0.12, bomb.z);
      bombLampMat.emissiveIntensity = bomb.state === 'planted'
        ? 1 + Math.sin(state.time * 8) * 1.5
        : 2;
    } else {
      bombMesh.visible = false;
    }

    // Site rings pulse while their site holds the planted charge.
    if (map && map.siteRings) {
      for (const [key, ring] of Object.entries(map.siteRings)) {
        const active = bomb.state === 'planted' && bomb.site === key;
        ring.material.opacity = active ? 0.6 + Math.sin(state.time * 6) * 0.3 : 0.55;
      }
    }

    muzzleTip.getWorldPosition(_muzzle);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  return {
    renderer, scene, camera,
    world: { get shootables() { return shootables; } },
    muzzle: _muzzle,
    bindMap,
    sync,
    onResize,
    kickViewmodel(amount) { vmKick = Math.min(1, vmKick + amount); },
  };
}
