import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuilding } from './buildings.js';
import { ResidentCrowd, DENSITY_LEVELS } from './crowd.js';

export const COLORS = { TypeScript: '#7393b1', JavaScript: '#d1b75f', Python: '#84a781', CSS: '#bd858d', SCSS: '#bd858d', HTML: '#c18d68', JSON: '#81ada4', Markdown: '#a3a5a5', YAML: '#a3a5a5', Rust: '#bf846b', Go: '#75aab1', Java: '#bf846b', 'C++': '#9295b9', C: '#9295b9', Other: '#a1a7a5' };
export const colorFor = language => COLORS[language] || COLORS.Other;
const hash = text => { let n = 2166136261; for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
const clamp = THREE.MathUtils.clamp;

export class CodeCity {
  constructor(container, { onSelect, onHover, onFrame, onMode } = {}) {
    this.container = container;
    this.onSelect = onSelect; this.onHover = onHover; this.onFrame = onFrame; this.onMode = onMode;
    this.style = 'game'; this.mode = 'orbit'; this.selected = null; this.bridges = false; this.rotation = false;
    this.query = ''; this.language = null; this.historyIndex = -1;
    this.population = { count: 0, source: 'none' }; this.crowd = null; this.populationDensity = 'lively';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 3000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.075;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.controls.minDistance = 6; this.controls.maxDistance = 1600; this.controls.autoRotateSpeed = 0.22;
    this.sky = new THREE.HemisphereLight('#fff6e6', '#a9a291', 2.1); this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight('#ffead0', 3.05);
    this.sun.position.set(-70, 100, 60); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.14;
    this.sun.shadow.radius = 4; this.scene.add(this.sun, this.sun.target);
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.meshes = []; this.links = []; this.labels = []; this.positions = new Map(); this.textures = new Map();
    this.pointer = new THREE.Vector2(); this.raycaster = new THREE.Raycaster(); this.keys = new Set();
    this.down = null; this.look = false; this.hovered = null; this.targetCamera = null;
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
      this.down = { x: event.clientX, y: event.clientY };
      if (this.mode === 'fly' && event.button === 2) { this.look = true; canvas.setPointerCapture(event.pointerId); }
    });
    canvas.addEventListener('pointerup', event => {
      if (this.down && event.button === 0 && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) < 5) {
        const file = this.pick(event); if (file) this.onSelect?.(file);
      }
      this.look = false; this.down = null;
    });
    canvas.addEventListener('pointermove', event => {
      if (this.mode === 'fly' && this.look) {
        const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        euler.y -= event.movementX * 0.004; euler.x = clamp(euler.x - event.movementY * 0.004, -1.45, 1.45);
        this.camera.quaternion.setFromEuler(euler); return;
      }
      const file = this.pick(event);
      if (this.hovered?.id !== file?.id || file) { this.hovered = file; this.onHover?.(file, event); }
      canvas.style.cursor = file ? 'pointer' : this.mode === 'orbit' ? 'grab' : 'crosshair';
    });
    canvas.addEventListener('pointerleave', () => { this.hovered = null; this.onHover?.(null); });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('keydown', event => {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
      this.keys.add(event.code);
      if (this.mode === 'fly' && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space'].includes(event.code)) event.preventDefault();
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.look = false; });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    this.clock = new THREE.Clock(); this.elapsed = 0; this.frameCount = 0; this.lastFps = 0;
    this.applySceneStyle(); this.resize(); this.animate();
  }

  applySceneStyle() {
    const game = this.style === 'game';
    this.scene.background = new THREE.Color(game ? '#e8e3d7' : '#e5e8e8'); this.scene.fog = null;
    this.sky.color.set(game ? '#fff6e6' : '#ffffff'); this.sky.groundColor.set(game ? '#aaa28d' : '#aab0b3');
    this.sky.intensity = game ? 2.1 : 2.5;
    this.sun.color.set(game ? '#ffead0' : '#ffffff'); this.sun.intensity = game ? 3.05 : 2.45;
    this.renderer.toneMappingExposure = game ? 1.12 : 1.03;
    this.container.dataset.cityStyle = this.style;
  }

  setStyle(style) {
    if (!['game', 'tool'].includes(style) || style === this.style) return;
    const state = { selected: this.selected, query: this.query, language: this.language, historyIndex: this.historyIndex, mode: this.mode };
    this.style = style; this.applySceneStyle(); this.resize();
    if (this.repo) {
      this.load(this.repo); this.filter(state.query, state.language, state.historyIndex); this.select(state.selected);
      if (state.mode === 'fly') this.setMode('fly');
    }
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height; this.camera.clearViewOffset(); this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes.filter(mesh => mesh.userData.active), true)[0];
    let object = hit?.object;
    while (object && !object.userData.file) object = object.parent;
    return object?.userData.file || null;
  }

  box(width, height, depth, color, x = 0, y = 0, z = 0, parent = this.world) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }

  facade(color, width, height, seed) {
    const key = `${color}:${width.toFixed(2)}:${height.toFixed(2)}:${seed % 3}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128);
    // One repeating tile is a floor with two inset windows and pale lintels.
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.13;
    for (let y = 0; y < 128; y += 16) {
      ctx.fillRect(0, y, 128, 1);
      for (let x = (y / 16 % 2) * 16; x < 128; x += 32) ctx.fillRect(x, y, 1, 16);
    }
    ctx.globalAlpha = 1;
    for (const x of [15, 79]) {
      ctx.fillStyle = '#574f43'; ctx.fillRect(x - 3, 22, 37, 74);
      ctx.fillStyle = '#385151'; ctx.fillRect(x, 25, 31, 64);
      ctx.fillStyle = '#9fbbb6'; ctx.globalAlpha = 0.23; ctx.fillRect(x + 3, 29, 11, 58);
      ctx.globalAlpha = 1; ctx.fillStyle = '#e0d8be'; ctx.fillRect(x - 5, 92, 41, 5); ctx.fillRect(x + 14, 25, 2, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(1, Math.round(width / 2.1)), Math.max(1, Math.round(height / 1.8)));
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.textures.set(key, texture); return texture;
  }

  clear() {
    this.crowd?.dispose(); this.crowd = null;
    const geometry = new Set(), materials = new Set();
    this.world.traverse(object => {
      if (object.geometry) geometry.add(object.geometry);
      if (object.material) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat);
    });
    geometry.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
    this.textures.forEach(texture => texture.dispose()); this.textures.clear();
    this.world.clear(); this.meshes = []; this.links = []; this.positions.clear();
    this.labels.forEach(label => label.element.remove()); this.labels = []; this.selectionRing = null;
  }

  layout(files) {
    let depth = Infinity;
    const group = file => file.directory === '.' || !file.directory ? '(root)' : file.directory.split('/').slice(0, depth).join('/');
    if (new Set(files.map(group)).size > 36) depth = 2;
    if (new Set(files.map(group)).size > 36) depth = 1;
    const groups = new Map();
    files.forEach(file => { const name = group(file); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(file); });
    this.districts = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, members]) => {
      const cols = Math.max(1, Math.ceil(Math.sqrt(members.length))), rows = Math.ceil(members.length / cols);
      return { name, files: [...members].sort((a, b) => a.path.localeCompare(b.path)), cols, rows, width: cols * 6.25 + 2.3, depth: rows * 6.25 + 3.8 };
    });
    const gap = 3.4, area = this.districts.reduce((sum, d) => sum + (d.width + gap) * (d.depth + gap), 0);
    const targetWidth = Math.max(12, ...this.districts.map(d => d.width), Math.sqrt(area) * 1.18);
    let x = 0, z = 0, rowDepth = 0, width = 0; this.streetRows = [];
    [...this.districts].sort((a, b) => b.depth - a.depth || b.width - a.width || a.name.localeCompare(b.name)).forEach(d => {
      if (x > 0 && x + d.width > targetWidth) { this.streetRows.push(z + rowDepth + gap / 2); z += rowDepth + gap; x = 0; rowDepth = 0; }
      d.x = x + d.width / 2; d.z = z + d.depth / 2;
      x += d.width + gap; rowDepth = Math.max(rowDepth, d.depth); width = Math.max(width, x - gap);
    });
    const depthTotal = z + rowDepth;
    this.districts.forEach(d => { d.x -= width / 2; d.z -= depthTotal / 2; });
    this.streetRows = this.streetRows.map(row => row - depthTotal / 2);
    this.cityWidth = width + 9; this.cityDepth = depthTotal + 9; this.size = Math.max(this.cityWidth, this.cityDepth); this.maxHeight = 0;
  }

  tree(x, z, seed, parent = this.world) {
    const greens = ['#687f52', '#81935d', '#598473', '#a0a16b'], h = 2.3 + seed % 7 * 0.12;
    this.box(0.18, h * 0.7, 0.18, '#786c50', x, h * 0.35 + 0.38, z, parent);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + seed % 3 * 0.08, 1), new THREE.MeshStandardMaterial({ color: greens[seed % greens.length], roughness: 1, flatShading: true }));
    crown.scale.set(0.85, 1.13, 0.85); crown.position.set(x, h + 0.48, z); crown.rotation.y = seed; crown.castShadow = true; parent.add(crown);
    this.box(2.45, 0.12, 2.45, '#a9aa87', x, 0.41, z, parent);
  }

  buildFile(file, district, index) {
    const seed = hash(file.path), lines = Math.max(1, Number(file.lines) || 1);
    const requestedHeight = clamp(1.8 + Math.sqrt(lines) * 1.28, 2.5, 48);
    const px = district.x - district.width / 2 + 1.15 + (index % district.cols + 0.5) * 6.25;
    const pz = district.z - district.depth / 2 + 1.15 + (Math.floor(index / district.cols) + 0.5) * 6.25;
    const building = createBuilding({
      file, style: this.style, seed, requestedHeight,
      width: 3.5 + seed % 10 * 0.12, depth: 3.45 + (seed >>> 5) % 10 * 0.11,
      languageColor: colorFor(file.language), facade: (color, w, h, s) => this.facade(color, w, h, s),
    });
    const { root: mesh, kind, height, width, depth, side, roof } = building;
    const base = 0.42;
    mesh.position.set(px, base, pz);
    mesh.userData = { file, kind, height, width, depth, active: true, district: district.name, side, roof };
    this.world.add(mesh); this.meshes.push(mesh);
    const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width + 0.14, height + 0.14, depth + 0.14)), new THREE.LineBasicMaterial({ color: '#c56838', transparent: true, opacity: 0.84 }));
    highlight.position.y = height / 2; highlight.visible = false; mesh.add(highlight);
    const materials = new Set();
    mesh.traverse(object => { if (object.material) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) { mat.transparent = true; mat.userData.baseOpacity = mat.opacity; materials.add(mat); } });
    mesh.userData.materials = materials; mesh.userData.highlight = highlight;
    this.positions.set(file.id, { x: px, y: base + height + 0.35, z: pz, mesh }); this.maxHeight = Math.max(this.maxHeight, height);
  }

  load(repo) {
    if (repo !== this.repo) this.population = { count: 0, source: 'none' };
    this.clear(); this.repo = repo; this.selected = null; this.layout(repo.files);
    const game = this.style === 'game';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(this.size * 12, this.size * 12), new THREE.MeshStandardMaterial({ color: game ? '#e8e3d7' : '#e5e8e8', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.12; ground.receiveShadow = true; this.world.add(ground);
    this.box(this.cityWidth, 1.15, this.cityDepth, game ? '#c5bcaa' : '#cbd2d2', 0, -0.53, 0);
    this.box(this.cityWidth - 0.5, 0.12, this.cityDepth - 0.5, game ? '#717870' : '#d8dede', 0, 0.11, 0);
    if (!game) {
      const grid = new THREE.GridHelper(this.size, Math.max(4, Math.round(this.size / 6)), '#bdc7c7', '#cbd3d3');
      grid.scale.set(this.cityWidth / this.size, 1, this.cityDepth / this.size); grid.position.y = 0.185;
      grid.material.transparent = true; grid.material.opacity = 0.65; this.world.add(grid);
    }
    if (game) for (const z of this.streetRows) for (let x = -this.cityWidth / 2 + 4; x < this.cityWidth / 2 - 3; x += 4.8) this.box(1.6, 0.018, 0.1, '#c7c5ac', x, 0.181, z);
    this.districts.forEach((district, districtIndex) => {
      const sidewalk = this.box(district.width, 0.24, district.depth, game ? '#d2cbbb' : '#eef0eb', district.x, 0.3, district.z); sidewalk.receiveShadow = true;
      if (!game) {
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(sidewalk.geometry), new THREE.LineBasicMaterial({ color: '#adbabb', transparent: true, opacity: 0.46 })); outline.position.copy(sidewalk.position); this.world.add(outline);
      }
      district.files.forEach((file, i) => this.buildFile(file, district, i));
      const empty = district.cols * district.rows - district.files.length;
      if (game) {
        for (let i = 0; i < Math.min(empty, 3); i++) {
          const slot = district.files.length + i;
          const x = district.x - district.width / 2 + 1.15 + (slot % district.cols + 0.5) * 6.25;
          const z = district.z - district.depth / 2 + 1.15 + (Math.floor(slot / district.cols) + 0.5) * 6.25;
          this.box(4.5, 0.04, 4.5, '#a6ab8b', x, 0.441, z);
          this.tree(x - 0.75, z - 0.4, hash(district.name) + i); this.tree(x + 0.8, z + 0.65, hash(district.name) + i + 7);
          this.box(1.3, 0.2, 0.4, '#938670', x, 0.62, z + 1.55);
        }
        if (!empty && districtIndex % 2 === 0) this.tree(district.x - district.width / 2 + 0.62, district.z + district.depth / 2 - 0.8, districtIndex * 13);
        const cx = district.x + district.width / 2 + 1.65, cz = district.z + district.depth / 2 - 0.9;
        for (let stripe = 0; stripe < 5; stripe++) this.box(2.3, 0.018, 0.18, '#d5d1bc', cx, 0.18, cz - stripe * 0.35);
      }
      const element = document.createElement('button'); element.className = 'district-label'; element.type = 'button'; element.textContent = district.name;
      element.title = `Explore ${district.name}`; element.dataset.style = this.style; element.addEventListener('click', () => { this.focusDistrict(district.name); this.onMode?.('orbit'); }); this.container.append(element);
      this.labels.push({ element, position: new THREE.Vector3(district.x, 0.5, district.z + district.depth / 2 - 0.65) });
    });
    (repo.edges || []).slice(0, 1200).forEach((edge, i) => {
      const from = this.positions.get(edge.from), to = this.positions.get(edge.to); if (!from || !to) return;
      const a = new THREE.Vector3(from.x, from.y, from.z), b = new THREE.Vector3(to.x, to.y, to.z);
      const mid = a.clone().add(b).multiplyScalar(0.5); mid.y = Math.max(a.y, b.y) + Math.min(12, a.distanceTo(b) * 0.14) + 1;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)), new THREE.LineBasicMaterial({ color: '#b86b40', transparent: true, opacity: 0.55, depthWrite: false }));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: '#c66f36', transparent: true, depthWrite: false }));
      this.world.add(line, dot); this.links.push({ ...edge, line, dot, curve, phase: i * 0.17 });
    });
    const points = [-1, 1, 1, -1, -1].map((x, i) => new THREE.Vector3(x * 2.7, 0, [1, 1, -1, -1, 1][i] * 2.7));
    this.selectionRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#c66f36', transparent: true, opacity: 0.95, depthWrite: false }));
    this.selectionRing.visible = false; this.world.add(this.selectionRing);
    const extent = this.size * 0.78;
    Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: this.size * 5 + 200 });
    this.sun.position.set(-this.size * 0.8, this.size * 1.25 + 35, this.size * 0.7);
    this.sun.shadow.camera.updateProjectionMatrix(); this.sun.shadow.needsUpdate = true;
    this.rebuildPopulation(); this.fit(false); this.filter('', null, -1);
  }

  setPopulation(count, metadata = {}) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Resident count must be a non-negative whole number.');
    const next = this.repo && this.style === 'game' ? new ResidentCrowd(this.districts, count, { density: this.populationDensity }) : null;
    this.crowd?.dispose(); this.crowd = next;
    this.population = { ...metadata, count };
    if (next) this.world.add(next.object);
  }

  setPopulationDensity(density) {
    if (!Object.hasOwn(DENSITY_LEVELS, density)) throw new Error('Unknown crowd density.');
    this.populationDensity = density;
    this.crowd?.setDensity(density);
  }

  rebuildPopulation() {
    this.crowd?.dispose(); this.crowd = null;
    if (this.style === 'game' && this.population.count > 0) {
      this.crowd = new ResidentCrowd(this.districts, this.population.count, { density: this.populationDensity });
      this.world.add(this.crowd.object);
    }
  }

  fit(smooth = true) {
    if (!this.repo) return;
    this.resize(); this.mode = 'orbit'; this.controls.enabled = true;
    const target = new THREE.Vector3(0, this.maxHeight * 0.2, 0), direction = new THREE.Vector3(0.92, 1.03, 1.27).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize(), up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const vfov = THREE.MathUtils.degToRad(this.camera.fov) / 2, hfov = Math.atan(Math.tan(vfov) * this.camera.aspect);
    let distance = 0;
    for (const x of [-this.cityWidth / 2, this.cityWidth / 2]) for (const y of [-1.15, this.maxHeight + 1]) for (const z of [-this.cityDepth / 2, this.cityDepth / 2]) {
      const corner = new THREE.Vector3(x, y, z).sub(target), depth = corner.dot(direction);
      distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / Math.tan(hfov), depth + Math.abs(corner.dot(up)) / Math.tan(vfov));
    }
    distance *= this.style === 'game' ? 1.10 : 1.12;
    const pos = target.clone().addScaledVector(direction, distance);
    this.controls.maxDistance = Math.max(300, distance * 4); this.camera.far = Math.max(3000, distance * 8); this.camera.updateProjectionMatrix();
    if (smooth) this.targetCamera = { target, pos };
    else { this.targetCamera = null; this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); }
  }

  focus(file) {
    const p = this.positions.get(file.id); if (!p) return;
    this.mode = 'orbit'; this.controls.enabled = true;
    const h = p.mesh.userData.height, distance = Math.max(16, h * 1.75), target = new THREE.Vector3(p.x, h * 0.5, p.z);
    this.targetCamera = { target, pos: target.clone().add(new THREE.Vector3(0.75, 0.65, 1).normalize().multiplyScalar(distance)) }; this.select(file.id);
  }

  focusDistrict(name) {
    const district = this.districts.find(d => d.name === name); if (!district) return;
    this.mode = 'orbit'; this.controls.enabled = true;
    const maxHeight = Math.max(...district.files.map(file => this.positions.get(file.id)?.mesh.userData.height || 0));
    const size = Math.max(district.width, district.depth, maxHeight), target = new THREE.Vector3(district.x, maxHeight * 0.22, district.z), distance = size * 2.65 / Math.min(1, this.camera.aspect);
    this.targetCamera = { target, pos: target.clone().add(new THREE.Vector3(0.92, 1.03, 1.27).normalize().multiplyScalar(distance)) };
  }

  select(id) {
    this.selected = id;
    this.meshes.forEach(mesh => { mesh.userData.highlight.visible = mesh.userData.active && mesh.userData.file.id === id; }); this.updateLinks();
    const p = this.positions.get(id);
    if (p && p.mesh.userData.active) { this.selectionRing.position.set(p.x, 0.45, p.z); this.selectionRing.visible = true; }
    else if (this.selectionRing) this.selectionRing.visible = false;
  }

  filter(query = '', language = null, historyIndex = -1) {
    this.query = query.toLowerCase(); this.language = language; this.historyIndex = historyIndex;
    const commit = this.repo?.history?.[historyIndex], changed = new Set(commit?.files || []), date = commit ? new Date(commit.date).getTime() : Infinity;
    let visible = 0;
    this.meshes.forEach(mesh => {
      const file = mesh.userData.file, match = (!this.query || file.path.toLowerCase().includes(this.query)) && (!language || file.language === language);
      const future = commit && file.commits > 0 && file.createdAt && new Date(file.createdAt).getTime() > date, active = match && !future;
      mesh.userData.active = active; if (active) visible++;
      mesh.userData.materials.forEach(mat => {
        mat.opacity = mat.userData.baseOpacity * (active ? 1 : 0.085); mat.depthWrite = active;
        if (mat.isMeshStandardMaterial) { mat.emissive.set('#bd7e35'); mat.emissiveIntensity = active && changed.has(file.path) ? 0.28 : 0; }
      });
      mesh.traverse(object => { if (object.isMesh) object.castShadow = active; });
      mesh.userData.highlight.visible = active && file.id === this.selected;
    });
    this.updateLinks(); if (this.selectionRing) this.selectionRing.visible = !!this.positions.get(this.selected)?.mesh.userData.active; return visible;
  }

  updateLinks() {
    this.links.forEach(link => {
      const active = this.positions.get(link.from)?.mesh.userData.active && this.positions.get(link.to)?.mesh.userData.active;
      const selected = this.selected && (link.from === this.selected || link.to === this.selected);
      link.line.visible = !!active && (this.bridges || !!selected); link.line.material.color.set(selected ? '#bf642f' : '#6b8f91');
      link.line.material.opacity = selected ? 0.78 : this.selected ? 0.07 : 0.19;
      link.dot.visible = link.line.visible && !!selected; link.dot.material.opacity = 0.94;
    });
  }

  setMode(mode) {
    const previousMode = this.mode;
    this.mode = mode; this.controls.enabled = mode === 'orbit'; this.targetCamera = null;
    if (mode === 'fly') { this.controls.autoRotate = false; this.keys.clear(); }
    else if (previousMode === 'fly') { const direction = new THREE.Vector3(); this.camera.getWorldDirection(direction); this.controls.target.copy(this.camera.position).addScaledVector(direction, Math.max(15, this.size || 35)); this.controls.update(); }
  }

  async screenshot() {
    this.renderer.render(this.scene, this.camera); const source = this.renderer.domElement;
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0); const scale = canvas.width / this.container.clientWidth;
    ctx.font = `600 ${22 * scale}px system-ui`; ctx.fillStyle = this.style === 'game' ? '#3a4c40' : '#35454b'; ctx.fillText('GitScape', 28 * scale, 40 * scale);
    ctx.font = `${11 * scale}px monospace`; ctx.fillStyle = '#6b736a'; ctx.fillText(`${this.repo.name} / ${this.style === 'game' ? 'CITY EXPLORER' : 'REPOSITORY MAP'}`, 28 * scale, 60 * scale);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('This browser could not encode the screenshot.');
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.download = `${this.repo.name.replace(/[^\w-]/g, '-')}-gitscape-${this.style}.png`; a.href = url;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.05); this.elapsed += dt; this.frameCount++;
    if (this.targetCamera) {
      const rate = 1 - Math.exp(-dt * 5); this.camera.position.lerp(this.targetCamera.pos, rate); this.controls.target.lerp(this.targetCamera.target, rate);
      if (this.camera.position.distanceTo(this.targetCamera.pos) < 0.08) this.targetCamera = null;
    }
    if (this.mode === 'fly') {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const speed = dt * Math.max(12, (this.size || 100) * 0.18) * (this.keys.has('ShiftLeft') ? 3 : 1);
      if (this.keys.has('KeyW')) this.camera.position.addScaledVector(forward, speed); if (this.keys.has('KeyS')) this.camera.position.addScaledVector(forward, -speed);
      if (this.keys.has('KeyD')) this.camera.position.addScaledVector(right, speed); if (this.keys.has('KeyA')) this.camera.position.addScaledVector(right, -speed);
      if (this.keys.has('KeyE') || this.keys.has('Space')) this.camera.position.y += speed; if (this.keys.has('KeyQ')) this.camera.position.y -= speed;
      this.camera.position.y = Math.max(1.8, this.camera.position.y);
    } else { this.controls.autoRotate = this.rotation && !this.targetCamera; this.controls.update(); }
    this.links.forEach(link => { if (link.dot.visible) link.dot.position.copy(link.curve.getPoint((this.elapsed * 0.10 + link.phase) % 1)); });
    this.crowd?.update(this.elapsed, this.camera, this.renderer);
    const forward = new THREE.Vector3(); this.camera.getWorldDirection(forward);
    this.labels.forEach(label => {
      const p = label.position.clone().project(this.camera), facing = label.position.clone().sub(this.camera.position).dot(forward) > 0;
      label.element.style.display = facing && p.z < 1 && Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.93 ? '' : 'none';
      label.element.style.left = `${(p.x * 0.5 + 0.5) * this.container.clientWidth}px`; label.element.style.top = `${(-p.y * 0.5 + 0.5) * this.container.clientHeight}px`;
    });
    this.renderer.render(this.scene, this.camera);
    if (this.elapsed - this.lastFps > 1) { this.onFrame?.(Math.round(this.frameCount / (this.elapsed - this.lastFps))); this.lastFps = this.elapsed; this.frameCount = 0; }
  }
}
