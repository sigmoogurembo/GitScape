import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp = THREE.MathUtils.clamp;
const masonry = ['#bc8164', '#c1a186', '#d0b89a', '#d5c6ad', '#a7ada0', '#b79372', '#d4aa84', '#a6b7ab'];
const tiles = ['#8b8171', '#967762', '#7b8271', '#9c8977'];
const kinds = ['townhouse', 'shop', 'library', 'warehouse', 'workshop', 'office', 'apartments', 'clocktower', 'greenhouse'];

export const BUILDING_KINDS = Object.freeze([...kinds]);

/** File purpose gives each neighbourhood a character; the hash varies its skyline. */
export function buildingKind(file, seed = 0) {
  const path = String(file.path || file.name || '').toLowerCase().replaceAll('\\', '/');
  const choose = options => options[(seed >>> 0) % options.length];
  if (/(^|\/)(readme|license|contributing|architecture)/.test(path) || /(^|\/)docs\//.test(path)) return 'library';
  if (/(bootstrap|appshell|routes|main|entry)\./.test(path)) return choose(['clocktower', 'office', 'clocktower']);
  if (/(^|\/)(scripts|bin|build|tools)\//.test(path) || /(release|worker|queue|sync)\./.test(path)) return 'workshop';
  if (/(^|\/)(tests?|spec|fixtures)\//.test(path) || /\.(test|spec)\./.test(path)) return choose(['workshop', 'greenhouse', 'greenhouse']);
  if (/(^|\/)(store|data|db|storage|assets)\//.test(path) || /\.(json|ya?ml|toml|sql)$/.test(path)) return choose(['warehouse', 'warehouse', 'workshop']);
  if (/(^|\/)(services?|api|network|server)\//.test(path)) return choose(['office', 'workshop', 'warehouse']);
  if (/(^|\/)(components?|ui|views?)\//.test(path)) return choose(['townhouse', 'shop', 'townhouse', 'apartments']);
  if (/(^|\/)(styles?|themes?)\//.test(path) || /\.(css|scss|html)$/.test(path)) return choose(['shop', 'townhouse', 'greenhouse']);
  if (/(^|\/)(lib|utils?|helpers?)\//.test(path)) return choose(['library', 'townhouse', 'workshop', 'office']);
  if (/(^|\/)(features?|pages?)\//.test(path)) return choose(['apartments', 'shop', 'office', 'townhouse']);
  return choose(kinds);
}

function dimensions(kind, lines, requestedHeight, inputWidth, inputDepth, seed) {
  // A house stays a house. Size remains meaningful within a building type.
  const growth = Math.sqrt(Math.max(1, lines));
  const profiles = {
    townhouse: [2.45 + growth * 0.19, 2.7, 7.4, 0.85, 0.90],
    shop: [2.15 + growth * 0.14, 2.5, 6.0, 1.04, 0.83],
    library: [2.45 + growth * 0.20, 3.1, 8.4, 1.08, 0.98],
    warehouse: [1.8 + growth * 0.17, 2.5, 7.0, 1.10, 1.08],
    workshop: [2.5 + growth * 0.24, 3.5, 12.5, 1.03, 0.98],
    office: [2.2 + growth * 1.03, 4.0, 39, 0.86, 0.88],
    apartments: [3.1 + growth * 1.16, 4.5, 44, 1.0, 0.98],
    clocktower: [4.3 + growth * 0.28, 5.3, 17, 0.98, 0.92],
    greenhouse: [1.75 + growth * 0.10, 2.1, 4.6, 1.10, 0.95],
  };
  const [size, min, max, widthScale, depthScale] = profiles[kind];
  const lineHeight = Number.isFinite(requestedHeight) ? Math.max(1, requestedHeight) : Infinity;
  const height = clamp(Math.min(size, lineHeight * 1.75), min, max);
  const width = clamp((Number(inputWidth) || 3.8) * widthScale, 2.7, 4.75);
  const depth = clamp((Number(inputDepth) || 3.8) * depthScale, 2.7, 4.6);
  return { height, width, depth, turn: seed % 2 };
}

function mergeDecorations(root) {
  const batches = new Map();
  const before = root.children.filter(object => object.isMesh).length;
  for (const mesh of root.children) {
    // Textured walls keep their individual material arrays. Decoration meshes
    // with identical materials can share one draw call and one raycast target.
    if (!mesh.isMesh || Array.isArray(mesh.material)) continue;
    const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(mesh);
  }
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const pieces = meshes.map(mesh => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(pieces, false);
    pieces.forEach(geometry => geometry.dispose());
    if (!merged) continue;
    const sample = meshes[0], replacement = new THREE.Mesh(merged, sample.material);
    replacement.castShadow = sample.castShadow; replacement.receiveShadow = sample.receiveShadow;
    for (const mesh of meshes) { root.remove(mesh); mesh.geometry.dispose(); }
    root.add(replacement);
  }
  return { before, after: root.children.filter(object => object.isMesh).length };
}

/**
 * All geometry lives above y=0 in a single group. No DOM or renderer is needed.
 * `facade` may return a cached window texture, or null for headless inspection.
 */
export function createBuilding({ file, style = 'game', seed = 0, requestedHeight, width: inputWidth, depth: inputDepth, languageColor = '#7393b1', facade = () => null }) {
  seed >>>= 0;
  const kind = buildingKind(file, seed);
  const lines = Math.max(1, Number(file.lines) || 1);
  const { height: h, width: w, depth: d } = dimensions(kind, lines, requestedHeight, inputWidth, inputDepth, seed);
  const root = new THREE.Group(); root.name = `building:${kind}`;
  const stone = masonry[seed % masonry.length], tile = tiles[(seed >>> 3) % tiles.length];
  const material = color => new THREE.MeshStandardMaterial({ color, roughness: 0.88, emissiveIntensity: 0 });
  const side = new THREE.MeshStandardMaterial({ color: style === 'game' ? '#ffffff' : '#e6e7e2', roughness: 0.88, emissiveIntensity: 0 });
  const roof = material(style === 'game' ? '#d9cfb8' : languageColor);
  const trim = material('#e1d6bf'), dark = material('#43574e'), roofTile = material(tile), plain = material(stone);
  const glass = new THREE.MeshStandardMaterial({ color: '#8faea3', roughness: 0.5, metalness: 0.06, emissiveIntensity: 0 });
  const stripe = material(seed % 2 ? '#8a9c83' : '#b58065');
  const palette = [side, roof, trim, dark, roofTile, plain, glass, stripe];
  for (const mat of palette) if (mat !== roof) mat.emissive = side.emissive;
  let roofTop = h;

  const add = (geometry, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  const box = (bw, bh, bd, mat, x = 0, y = bh / 2, z = 0) => add(new THREE.BoxGeometry(bw, bh, bd), mat, x, y, z);
  const walls = (bw, bh, bd, x = 0, y = bh / 2 + 0.12, z = 0, texture = true) => {
    const wall = side.clone();
    wall.emissive = side.emissive;
    if (style === 'game' && texture) wall.map = facade(stone, bw, bh, seed);
    else if (style === 'game') wall.color.set(stone);
    palette.push(wall);
    return box(bw, bh, bd, [wall, wall, roof, trim, wall, wall], x, y, z);
  };
  const gable = (bw, bd, rise, y, mat = roofTile, x = 0, z = 0) => {
    const shape = new THREE.Shape();
    shape.moveTo(-bw / 2, 0); shape.lineTo(0, rise); shape.lineTo(bw / 2, 0); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: bd, steps: 1, bevelEnabled: false });
    geometry.translate(0, 0, -bd / 2);
    add(geometry, mat, x, y, z);
    box(0.10, 0.08, bd + 0.04, trim, x, y + rise, z);
    roofTop = Math.max(roofTop, y + rise + 0.04);
  };
  const door = (x, y, z, dw = 0.65, dh = 1.22) => {
    box(dw + 0.17, dh + 0.14, 0.12, trim, x, y + dh / 2, z);
    box(dw, dh, 0.14, dark, x, y + dh / 2, z + 0.014);
    box(0.10, 0.04, 0.03, roofTile, x + dw * 0.27, y + dh * 0.5, z + 0.09);
  };
  const window = (x, y, z, ww = 0.78, wh = 0.94) => {
    box(ww + 0.15, wh + 0.13, 0.11, trim, x, y, z);
    box(ww, wh, 0.13, glass, x, y + 0.012, z + 0.014);
    box(0.06, wh, 0.035, trim, x, y + 0.012, z + 0.093);
    box(ww, 0.05, 0.035, trim, x, y + 0.012, z + 0.093);
  };
  const marker = (x = 0, z = 0) => box(0.60, 0.13, 0.53, material(languageColor), x, roofTop + 0.075, z);
  const baseWidth = Math.min(5.18, w + 0.38), baseDepth = Math.min(5.18, d + 0.38);
  box(baseWidth, 0.12, baseDepth, trim);

  if (kind === 'townhouse') {
    const rise = Math.min(1.0, h * 0.2), bodyH = h - rise - 0.12;
    walls(w, bodyH, d);
    box(w + 0.16, 0.14, d + 0.16, trim, 0, bodyH + 0.12, 0);
    gable(w + 0.24, d + 0.24, rise, bodyH + 0.18);
    door(-w * 0.22, 0.12, d / 2 + 0.02);
    window(w * 0.21, 0.98, d / 2 + 0.03, w * 0.22, 0.88);
    box(0.38, 0.8, 0.42, plain, -w * 0.25, h - 0.2, -d * 0.19);
    roofTop = Math.max(roofTop, h + 0.2);
    if (seed % 3 === 0) {
      walls(0.85, 0.62, 0.74, w * 0.21, bodyH + 0.42, d * 0.23, false);
      gable(1.03, 0.88, 0.35, bodyH + 0.76, roofTile, w * 0.21, d * 0.23);
    }
    marker(w * 0.24, -d * 0.21);
  } else if (kind === 'shop') {
    const bodyH = h - 0.25;
    walls(w, bodyH, d, 0, bodyH / 2 + 0.12, 0, bodyH > 3.1);
    box(w + 0.18, 0.24, d + 0.18, trim, 0, h, 0);
    const front = d / 2 + 0.04;
    window(-w * 0.23, 1.06, front, w * 0.34, 1.34);
    door(w * 0.28, 0.12, front, 0.65, 1.58);
    box(w * 0.9, 0.38, 0.18, trim, 0, 2.02, front + 0.03);
    box(w * 0.56, 0.09, 0.04, dark, -0.08, 2.03, front + 0.15);
    const awningW = w * 0.95, stripeCount = 8;
    for (let i = 0; i < stripeCount; i++) {
      const panel = box(awningW / stripeCount, 0.095, 0.65, i % 2 ? trim : stripe, -awningW / 2 + (i + 0.5) * awningW / stripeCount, 1.78, front + 0.22);
      panel.rotation.x = 0.18;
      box(awningW / stripeCount, 0.20, 0.06, i % 2 ? trim : stripe, panel.position.x, 1.63, front + 0.53);
    }
    for (const x of [-w * 0.36, w * 0.05]) {
      box(0.50, 0.28, 0.34, roofTile, x, 0.27, front + 0.21);
      box(0.42, 0.14, 0.29, stripe, x, 0.48, front + 0.21);
    }
    roofTop = h + 0.12; marker(w * 0.24, -d * 0.22);
  } else if (kind === 'library') {
    const bodyH = h - 0.72, front = d / 2 - 0.13, porticoW = w * 0.82;
    walls(w, bodyH, d - 0.42);
    box(w + 0.2, 0.17, d - 0.15, trim, 0, bodyH + 0.15, -0.14);
    gable(w + 0.2, d + 0.12, 0.63, bodyH + 0.2, trim);
    box(porticoW + 0.25, 0.14, 0.77, trim, 0, 0.17, front + 0.15);
    box(porticoW + 0.12, 0.14, 0.69, trim, 0, 0.30, front + 0.15);
    door(0, 0.30, front - 0.05, 0.85, 1.58);
    const colH = bodyH - 0.43;
    for (let i = 0; i < 4; i++) {
      const cx = -porticoW / 2 + i * porticoW / 3;
      add(new THREE.CylinderGeometry(0.13, 0.16, colH, 8), trim, cx, 0.41 + colH / 2, front + 0.32);
      box(0.35, 0.13, 0.35, trim, cx, 0.40, front + 0.32);
      box(0.35, 0.14, 0.35, trim, cx, colH + 0.44, front + 0.32);
    }
    box(porticoW + 0.35, 0.22, 0.76, trim, 0, bodyH + 0.03, front + 0.18);
    marker(0, -d * 0.2);
  } else if (kind === 'warehouse') {
    const rise = Math.min(0.76, h * 0.2), bodyH = h - rise - 0.12;
    walls(w, bodyH, d, 0, bodyH / 2 + 0.12, 0, false);
    gable(w + 0.17, d + 0.17, rise, bodyH + 0.15);
    const front = d / 2 + 0.015, gateW = w * 0.55, gateH = Math.min(2.05, bodyH * 0.77);
    box(gateW + 0.18, gateH + 0.16, 0.14, trim, 0, 0.18 + gateH / 2, front);
    box(gateW, gateH, 0.16, dark, 0, 0.18 + gateH / 2, front + 0.012);
    for (let y = 0.43; y < gateH + 0.05; y += 0.22) box(gateW, 0.035, 0.035, roofTile, 0, y, front + 0.11);
    for (const x of [-w * 0.35, w * 0.35]) window(x, bodyH * 0.75, front, 0.43, 0.48);
    for (const x of [-w / 2 + 0.14, w / 2 - 0.14]) box(0.13, bodyH, 0.14, trim, x, bodyH / 2 + 0.12, front);
    box(1.12, 0.16, 0.42, trim, 0, 0.21, front + 0.18);
    marker(w * 0.25, -d * 0.22);
  } else if (kind === 'workshop') {
    const bodyH = clamp(h * 0.56, 2.1, 6.1), sawW = w / 3;
    walls(w, bodyH, d, 0, bodyH / 2 + 0.12, 0, false);
    roofTop = bodyH + 0.18;
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + (i + 0.5) * sawW;
      gable(sawW + 0.035, d + 0.12, 0.60, bodyH + 0.12, roofTile, x);
      box(0.08, 0.33, d * 0.76, glass, x + sawW * 0.31, bodyH + 0.38, 0);
    }
    for (const x of [-w * 0.27, w * 0.27]) window(x, bodyH * 0.64 + 0.12, d / 2 + 0.03, w * 0.23, 0.74);
    door(0, 0.12, d / 2 + 0.03, 0.74, 1.37);
    const chimneyH = h - 0.12, cx = -w * 0.35, cz = -d * 0.31;
    box(0.70, 0.80, 0.70, plain, cx, 0.52, cz);
    add(new THREE.CylinderGeometry(0.23, 0.34, chimneyH, 8), plain, cx, chimneyH / 2 + 0.12, cz);
    add(new THREE.CylinderGeometry(0.32, 0.32, 0.17, 8), roofTile, cx, h + 0.02, cz);
    roofTop = Math.max(roofTop, h + 0.105);
    marker(cx, cz);
  } else if (kind === 'office') {
    const bodyH = h - 0.22, podiumH = Math.min(1.7, bodyH * 0.25), towerW = w * 0.83, towerD = d * 0.83;
    walls(w, podiumH, d, 0, podiumH / 2 + 0.12);
    box(w + 0.15, 0.16, d + 0.15, trim, 0, podiumH + 0.12, 0);
    box(towerW, bodyH - podiumH, towerD, glass, 0, podiumH + 0.12 + (bodyH - podiumH) / 2, 0);
    const floors = Math.max(2, Math.round((bodyH - podiumH) / 1.34));
    for (let i = 0; i <= floors; i++) box(towerW + 0.05, 0.075, towerD + 0.05, trim, 0, podiumH + 0.12 + i * (bodyH - podiumH) / floors, 0);
    for (const x of [-towerW / 2, 0, towerW / 2]) {
      box(0.095, bodyH - podiumH, 0.12, trim, x, podiumH + 0.12 + (bodyH - podiumH) / 2, towerD / 2 + 0.02);
      box(0.095, bodyH - podiumH, 0.12, trim, x, podiumH + 0.12 + (bodyH - podiumH) / 2, -towerD / 2 - 0.02);
    }
    box(towerW + 0.18, 0.20, towerD + 0.18, trim, 0, h, 0);
    door(0, 0.12, d / 2 + 0.03, 0.80, Math.min(1.5, podiumH));
    roofTop = h + 0.1; marker(towerW * 0.2, towerD * 0.19);
  } else if (kind === 'apartments') {
    const podiumH = h * 0.38, upperH = h * 0.59, upperW = w * 0.72, upperD = d * 0.76;
    walls(w, podiumH, d);
    box(w + 0.14, 0.19, d + 0.14, trim, 0, podiumH + 0.12, 0);
    walls(upperW, upperH, upperD, -w * 0.04, podiumH + upperH / 2 + 0.20);
    const top = podiumH + upperH + 0.20;
    box(upperW + 0.18, 0.18, upperD + 0.18, trim, -w * 0.04, top, 0);
    const balconyCount = Math.min(7, Math.max(1, Math.floor(upperH / 1.75)));
    for (let i = 0; i < balconyCount; i++) {
      const y = podiumH + 0.44 + i * upperH / balconyCount;
      box(upperW * 0.75, 0.10, 0.40, trim, -w * 0.04, y, upperD / 2 + 0.14);
      box(upperW * 0.75, 0.31, 0.05, dark, -w * 0.04, y + 0.20, upperD / 2 + 0.32);
    }
    door(0, 0.12, d / 2 + 0.03);
    box(w * 0.50, 0.13, 0.43, roofTile, 0, 1.45, d / 2 + 0.15);
    box(0.72, 0.55, 0.72, plain, -w * 0.23, top + 0.30, -d * 0.14);
    roofTop = top + 0.58; marker(upperW * 0.18, upperD * 0.19);
  } else if (kind === 'clocktower') {
    const hallH = Math.min(3.45, h * 0.42), towerW = w * 0.40, towerD = d * 0.46;
    walls(w, hallH, d);
    gable(w + 0.14, d + 0.16, 0.57, hallH + 0.12);
    const towerH = h - 0.48;
    walls(towerW, towerH, towerD, 0, towerH / 2 + 0.12, -d * 0.05);
    box(towerW + 0.19, 0.22, towerD + 0.19, trim, 0, towerH - 0.55, -d * 0.05);
    box(towerW + 0.27, 0.24, towerD + 0.27, trim, 0, towerH + 0.14, -d * 0.05);
    const radius = Math.min(0.48, towerW * 0.30), clockY = towerH - 0.07;
    const face = add(new THREE.CircleGeometry(radius, 24), trim, 0, clockY, -d * 0.05 + towerD / 2 + 0.023);
    face.receiveShadow = false;
    box(0.035, radius * 0.64, 0.03, dark, 0, clockY + radius * 0.16, face.position.z + 0.013);
    const hand = box(radius * 0.62, 0.035, 0.03, dark, radius * 0.18, clockY + radius * 0.02, face.position.z + 0.016); hand.rotation.z = -0.3;
    gable(towerW + 0.25, towerD + 0.25, 0.65, towerH + 0.24);
    door(0, 0.12, d / 2 + 0.03, 0.88, 1.6);
    for (const x of [-w * 0.33, w * 0.33]) window(x, 1.55, d / 2 + 0.03, w * 0.18, 1.2);
    marker(0, -d * 0.07);
  } else if (kind === 'greenhouse') {
    const rise = Math.min(0.87, h * 0.28), bodyH = h - rise - 0.12;
    box(w, bodyH, d, glass, 0, bodyH / 2 + 0.12, 0);
    gable(w + 0.08, d + 0.08, rise, bodyH + 0.12, glass);
    box(w + 0.12, 0.19, d + 0.12, trim, 0, 0.18, 0);
    const bays = 4;
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + w * i / bays;
      for (const z of [-d / 2, d / 2]) box(0.085, bodyH, 0.09, trim, x, bodyH / 2 + 0.12, z);
    }
    for (let i = 0; i <= bays; i++) {
      const z = -d / 2 + d * i / bays;
      for (const x of [-w / 2, w / 2]) box(0.09, bodyH, 0.085, trim, x, bodyH / 2 + 0.12, z);
      for (const direction of [-1, 1]) {
        const beam = box(Math.hypot(w / 2, rise), 0.09, 0.09, trim, direction * w / 4, bodyH + 0.12 + rise / 2, z);
        beam.rotation.z = -direction * Math.atan2(rise, w / 2);
      }
    }
    box(w + 0.12, 0.09, d + 0.12, trim, 0, bodyH + 0.12, 0);
    door(0, 0.12, d / 2 + 0.025, 0.67, Math.min(1.4, bodyH * 0.86));
    for (const x of [-w * 0.33, w * 0.33]) {
      box(0.65, 0.32, 0.41, roofTile, x, 0.28, d / 2 + 0.12);
      box(0.56, 0.12, 0.36, stripe, x, 0.49, d / 2 + 0.12);
    }
    marker(0, -d * 0.26);
  }

  const geometryStats = style === 'game' ? mergeDecorations(root) : null;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
  if (style !== 'game') {
    // Same lot and scale as City, presented as a clean architectural mass.
    const unusedMaterials = new Set(palette);
    root.traverse(object => {
      object.geometry?.dispose();
      if (object.material) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) unusedMaterials.add(mat);
    });
    root.clear();
    for (const mat of unusedMaterials) if (mat !== side && mat !== roof) mat.dispose();
    side.color.set('#e6e7e2'); side.map = null;
    box(size.x, size.y - 0.15, size.z, [side, side, roof, side, side, side], 0, (size.y - 0.15) / 2, 0);
    box(size.x + 0.03, 0.15, size.z + 0.03, roof, 0, size.y - 0.075, 0);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color: '#8b9799', transparent: true, opacity: 0.24 }));
    outline.position.y = size.y / 2; root.add(outline);
    return { root, kind, height: size.y, width: size.x + 0.03, depth: size.z + 0.03, side, roof };
  }
  // The main side material is retained for selection/commit emissive highlights.
  side.color.set(stone);
  return { root, kind, height: bounds.max.y, width: size.x, depth: size.z, side, roof, geometryStats };
}
