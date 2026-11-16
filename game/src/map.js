// map.js — "Foundry Yard", an original three-lane map: a dusk-lit industrial
// yard with a central warehouse hall, a furnace hall (site A) to the west and
// a container yard (site B) to the east. North lane, mid through the hall and
// south lane connect the spawns; every wall, crate and container is both a
// mesh and an AABB collider, and the waypoint graph bots walk is hand-laid
// over the same floor plan.
//
// Palette: charcoal concrete, rust orange, amber sodium light, teal steel.
// Nothing here is copied from any commercial map.

import * as THREE from 'three';
import { segmentHitsAABB, segmentHitsCircle } from './utils.js';

export const MAP = {
  minX: -32, maxX: 32, minZ: -22, maxZ: 22,
  sites: {
    A: { x: -22, z: -12, r: 5, label: 'A' },
    B: { x: 22, z: 12, r: 5, label: 'B' },
  },
  spawns: {
    A: [[-28, 2], [-29, 5], [-27, 7], [-29, -1], [-26, 4]],
    B: [[28, -2], [29, -5], [27, -7], [29, 1], [26, -4]],
  },
};

// Waypoint graph: id -> { x, z, links: [ids] }. Bots path over it with BFS.
const WAYPOINTS = {
  A0: [-28, 4], A1: [-24, 0], A2: [-20, -6], A3: [-16, 6], A4: [-12, -12],
  A5: [-12, 12], A6: [-10, 0], AS0: [-24, -12], AS1: [-18, -16], AS2: [-26, -8],
  M0: [-6, 0], M1: [0, 0], M2: [6, 0], M3: [0, -10], M4: [0, 10],
  BM0: [12, 0], B1: [24, 0], B2: [20, 6], B3: [16, -6], B4: [12, -12],
  B5: [12, 12], B0: [28, -4], BS0: [24, 12], BS1: [18, 16], BS2: [26, 8],
  N0: [-20, -17], N1: [-8, -17], N2: [4, -17], N3: [16, -17], N4: [24, -17],
  S0: [-20, 17], S1: [-8, 17], S2: [4, 17], S3: [16, 17], S4: [24, 17],
};
const LINKS = [
  ['A0', 'A1'], ['A1', 'A2'], ['A1', 'A3'], ['A2', 'AS0'], ['A2', 'A4'],
  ['A2', 'AS2'], ['AS0', 'AS1'], ['AS0', 'AS2'], ['AS1', 'A4'], ['A3', 'A5'],
  ['A4', 'N0'], ['A5', 'S0'], ['A4', 'A6'], ['A5', 'A6'], ['A6', 'M0'],
  ['A6', 'M3'], ['A6', 'M4'], ['M0', 'M1'], ['M1', 'M2'], ['M1', 'M3'],
  ['M1', 'M4'], ['M3', 'M0'], ['M4', 'M0'],
  ['N0', 'N1'], ['N1', 'N2'], ['N2', 'N3'], ['N3', 'N4'], ['N4', 'B4'],
  ['S0', 'S1'], ['S1', 'S2'], ['S2', 'S3'], ['S3', 'S4'], ['S4', 'B5'],
  ['M2', 'BM0'], ['BM0', 'B1'], ['BM0', 'B3'], ['BM0', 'B4'], ['BM0', 'B5'],
  ['B1', 'B0'], ['B3', 'B1'], ['B3', 'B2'], ['B2', 'BS0'], ['B2', 'BS2'],
  ['BS0', 'BS1'], ['BS0', 'BS2'], ['B4', 'B3'], ['B5', 'B3'],
];

function buildWaypoints() {
  const nodes = {};
  for (const [id, [x, z]] of Object.entries(WAYPOINTS)) {
    nodes[id] = { id, x, z, links: [] };
  }
  for (const [a, b] of LINKS) {
    nodes[a].links.push(b);
    nodes[b].links.push(a);
  }
  return nodes;
}

// A box described once, used as both a mesh and a collider.
function box(list, x, z, w, d, h, y = 0) {
  list.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h, x, z, w, d, h, y });
  return list[list.length - 1];
}

export function buildMap(scene, rng) {
  const colliders = [];
  const solids = []; // meshes bullets stop at: walls, crates, floor, barrels
  const mats = {
    floor: new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.95 }),
    apron: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 1 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x3d434c, roughness: 0.9 }),
    wallDark: new THREE.MeshStandardMaterial({ color: 0x2e333a, roughness: 0.9 }),
    rust: new THREE.MeshStandardMaterial({ color: 0xa8542c, roughness: 0.75, metalness: 0.25 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x2e6f6a, roughness: 0.7, metalness: 0.3 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xc98a2e, roughness: 0.7, metalness: 0.3 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x6b543a, roughness: 0.95 }),
    crateDark: new THREE.MeshStandardMaterial({ color: 0x54432f, roughness: 0.95 }),
    furnace: new THREE.MeshStandardMaterial({ color: 0x1f2126, roughness: 0.6, metalness: 0.5 }),
    glowOrange: new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: 0xff7a1a, emissiveIntensity: 2.2 }),
    glowAmber: new THREE.MeshStandardMaterial({ color: 0x2a2108, emissive: 0xffb02e, emissiveIntensity: 1.6 }),
    pillar: new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.85 }),
    skyline: new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 1 }),
  };

  // Floor and the apron beyond the walls.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData = { kind: 'wall' };
  scene.add(floor);
  solids.push(floor);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mats.apron);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  scene.add(apron);

  const addBox = (b, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    mesh.position.set(b.x, b.y + b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'wall' };
    scene.add(mesh);
    solids.push(mesh);
    return mesh;
  };

  // Perimeter walls.
  box(colliders, 0, -22.5, 66, 1, 4);
  box(colliders, 0, 22.5, 66, 1, 4);
  box(colliders, -32.5, 0, 1, 46, 4);
  box(colliders, 32.5, 0, 1, 46, 4);
  for (const b of colliders.slice(0, 4)) addBox(b, mats.wallDark);

  // Warehouse hall walls at x = -8 and x = +8, each with three door gaps
  // (north, mid, south). Wall segments between the gaps.
  for (const x of [-8, 8]) {
    const segs = [[-14, -12], [-8, -2], [2, 8], [12, 14]];
    for (const [z0, z1] of segs) {
      const b = box(colliders, x, (z0 + z1) / 2, 1, z1 - z0, 4);
      addBox(b, mats.wall);
    }
  }
  // Hall roof beams (visual only, high above play).
  for (const z of [-10, -4, 2, 8]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 0.8), mats.pillar);
    beam.position.set(0, 4.4, z);
    scene.add(beam);
  }
  // Pillars inside the hall.
  for (const [x, z] of [[-4, -6], [4, -6], [-4, 6], [4, 6]]) {
    addBox(box(colliders, x, z, 1, 1, 4), mats.pillar);
  }
  // Crates in the hall.
  addBox(box(colliders, 0, -10, 2, 2, 1.1), mats.crate);
  addBox(box(colliders, 0.5, 10, 2, 2, 1.1), mats.crateDark);

  // Site A — furnace hall (west). The furnace mouth glows orange.
  const furnace = box(colliders, -27, -16, 5, 4, 3.4);
  addBox(furnace, mats.furnace);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), mats.glowOrange);
  mouth.position.set(-24.4, 1.1, -16);
  mouth.rotation.y = Math.PI / 2;
  scene.add(mouth);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 7, 10), mats.furnace);
  chimney.position.set(-27, 6.5, -16);
  chimney.userData = { kind: 'wall' };
  scene.add(chimney);
  solids.push(chimney);
  addBox(box(colliders, -18, -18, 2.4, 2.4, 1.2), mats.crate);
  addBox(box(colliders, -24, -6, 2, 2, 1.1), mats.crateDark);
  addBox(box(colliders, -16, -10, 1.6, 1.6, 1), mats.crate);

  // Site B — container yard (east). Stacked containers make the sightlines.
  addBox(box(colliders, 22, 10, 8, 2.6, 2.6), mats.rust);
  const top = new THREE.Mesh(new THREE.BoxGeometry(8, 2.6, 2.6), mats.teal);
  top.position.set(22, 3.9, 10);
  top.castShadow = true;
  top.receiveShadow = true;
  scene.add(top);
  // The stacked container blocks movement at ground level the same as one box.
  colliders[colliders.length - 1].top = 5.2;
  addBox(box(colliders, 26, 16, 6, 2.6, 2.6), mats.teal);
  addBox(box(colliders, 17, 16, 2.4, 2.4, 1.2), mats.crate);
  addBox(box(colliders, 28, 6, 2, 2, 1.1), mats.crateDark);
  addBox(box(colliders, 15, 8, 1.6, 1.6, 1), mats.amber);

  // Lane cover: crates and barriers north and south.
  addBox(box(colliders, -4, -17, 2, 2, 1.1), mats.crate);
  addBox(box(colliders, 12, -17, 2, 2, 1.1), mats.crateDark);
  addBox(box(colliders, 4, 17, 2, 2, 1.1), mats.crateDark);
  addBox(box(colliders, -12, 17, 2, 2, 1.1), mats.crate);
  addBox(box(colliders, -20, 0, 1.6, 1.6, 1), mats.crate);
  addBox(box(colliders, 20, -2, 1.6, 1.6, 1), mats.crateDark);

  // Scattered barrels (visual, small colliders).
  for (let i = 0; i < 10; i++) {
    const x = -30 + rng() * 60;
    const z = -20 + rng() * 40;
    if (Math.abs(x) < 10 && Math.abs(z) < 15) continue; // keep the hall clear
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12),
      i % 2 ? mats.rust : mats.teal,
    );
    barrel.position.set(x, 0.55, z);
    barrel.castShadow = true;
    barrel.userData = { kind: 'wall' };
    scene.add(barrel);
    solids.push(barrel);
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, top: 1.1 });
  }

  // Site rings: glowing floor markers that say where the charge goes.
  const siteRings = {};
  for (const [key, site] of Object.entries(MAP.sites)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
    siteRings[key] = ring;
    const label = makeTextSprite(site.label, '#ffb02e');
    label.position.set(site.x, 3.4, site.z);
    scene.add(label);
  }

  // Sodium lamps: emissive heads plus a few real point lights.
  const lampHeads = [];
  for (const [x, z] of [[-20, 0], [0, 0], [20, 0], [-22, -12], [22, 12], [0, -17], [0, 17]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.6, 8), mats.pillar);
    pole.position.set(x, 2.3, z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.4), mats.glowAmber);
    head.position.set(x, 4.6, z);
    scene.add(head);
    lampHeads.push([x, z]);
  }
  for (const [x, z] of [[-20, 0], [0, 0], [20, 0], [-22, -12], [22, 12]]) {
    const light = new THREE.PointLight(0xffb02e, 22, 26, 1.6);
    light.position.set(x, 4.4, z);
    scene.add(light);
  }

  // Distant skyline silhouettes beyond the walls, for the dusk read.
  for (let i = 0; i < 14; i++) {
    const w = 6 + rng() * 10;
    const h = 6 + rng() * 14;
    const angle = (i / 14) * Math.PI * 2 + rng() * 0.3;
    const r = 78 + rng() * 20;
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mats.skyline);
    s.position.set(Math.cos(angle) * r, h / 2 - 0.5, Math.sin(angle) * r);
    scene.add(s);
  }

  return { colliders, solids, waypoints: buildWaypoints(), sites: MAP.sites, spawns: MAP.spawns, siteRings };
}

// A floating letter drawn on a canvas — runtime-generated, no asset file.
function makeTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 96px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.2, 2.2, 1);
  return sprite;
}

// Push a circle (x, z, radius) out of every overlapping AABB. Runs a few
// passes so corners resolve. Returns the corrected position in out.
export function resolveCircle(x, z, radius, colliders, out) {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const cx = px < c.minX ? c.minX : px > c.maxX ? c.maxX : px;
      const cz = pz < c.minZ ? c.minZ : pz > c.maxZ ? c.maxZ : pz;
      const dx = px - cx;
      const dz = pz - cz;
      const dSq = dx * dx + dz * dz;
      if (dSq >= radius * radius) continue;
      if (dSq === 0) {
        // Centre inside the box: push out along the smallest penetration.
        const pl = px - c.minX;
        const pr = c.maxX - px;
        const pt = pz - c.minZ;
        const pb = c.maxZ - pz;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) px = c.minX - radius;
        else if (m === pr) px = c.maxX + radius;
        else if (m === pt) pz = c.minZ - radius;
        else pz = c.maxZ + radius;
      } else {
        const d = Math.sqrt(dSq);
        const push = (radius - d) / d;
        px += dx * push;
        pz += dz * push;
      }
    }
  }
  out.x = px;
  out.z = pz;
  return out;
}

// Line of sight on the XZ plane: blocked by any collider, or by a smoke
// cloud. Eye height is above every crate, but every wall and container is
// taller than an eye, so the 2D test is the sight test.
export function losBlocked(x1, z1, x2, z2, colliders, smokes) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.top < 1.5) continue; // low crates do not block sight
    if (segmentHitsAABB(x1, z1, x2, z2, c.minX, c.minZ, c.maxX, c.maxZ)) return true;
  }
  if (smokes) {
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      if (segmentHitsCircle(x1, z1, x2, z2, s.x, s.z, s.radius)) return true;
    }
  }
  return false;
}
