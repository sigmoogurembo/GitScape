import * as THREE from 'three';

export const DENSITY_LEVELS = Object.freeze({
  calm: Object.freeze({ label: 'Calm', spacing: 5.5, overview: 0.34, maximum: 1800 }),
  lively: Object.freeze({ label: 'Lively', spacing: 3.2, overview: 0.38, maximum: 4200 }),
  crowd: Object.freeze({ label: 'Crowd', spacing: 1.4, overview: 0.52, maximum: 10000 }),
});

// The outer street has several walking lanes instead of one crowded centerline.
export function streetRoutes(districts) {
  return districts.map(district => ({
    x: district.x,
    z: district.z,
    halfWidth: district.width / 2 + 0.82,
    halfDepth: district.depth / 2 + 0.82,
    height: 0.84, lane: 0.32, kind: 'street', weight: 1,
  }));
}

export function pedestrianRoutes(districts) {
  const routes = streetRoutes(districts);
  for (const district of districts) {
    const { cols, rows, files } = district;
    // Interior routes require the same lot layout used by the building renderer.
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || !Array.isArray(files)) continue;
    const pitch = 6.25;
    const left = district.x - district.width / 2 + 1.15;
    const top = district.z - district.depth / 2 + 1.15;
    const centerX = left + cols * pitch / 2;
    const centerZ = top + rows * pitch / 2;
    routes.push({ x: centerX, z: centerZ, halfWidth: cols * pitch / 2, halfDepth: rows * pitch / 2, height: 1.08, lane: 0.055, kind: 'promenade', weight: 0.55 });
    for (let row = 1; row < rows; row++) {
      routes.push({ x: centerX, z: top + (row + 0.5) * pitch, halfWidth: cols * pitch / 2, halfDepth: pitch / 2, height: 1.08, lane: 0.055, kind: 'courtyard', weight: 0.30 });
    }
    for (let slot = files.length; slot < cols * rows; slot++) {
      const garden = slot - files.length < 3;
      routes.push({
        x: left + (slot % cols + 0.5) * pitch, z: top + (Math.floor(slot / cols) + 0.5) * pitch,
        halfWidth: garden ? 2.65 : 2.15, halfDepth: garden ? 2.65 : 2.15,
        height: 1.08, lane: garden ? 0.035 : 0.16, kind: garden ? 'park' : 'square', weight: 0.85,
      });
    }
    routes.push({ x: district.x + district.width / 2 + 1.65, z: district.z + district.depth / 2 - 1.60, halfWidth: 1.05, halfDepth: 0.72, height: 0.84, lane: 0.04, kind: 'crossing', weight: 0.40 });
  }
  return routes;
}

function validateCount(count) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Resident count must be a non-negative whole number.');
}

export function crowdBudget(routes, count, density = 'lively') {
  validateCount(count);
  const profile = DENSITY_LEVELS[density];
  if (!Object.hasOwn(DENSITY_LEVELS, density)) throw new Error('Unknown crowd density.');
  const length = routes.reduce((total, route) => total + 4 * (route.halfWidth + route.halfDepth) * route.weight, 0);
  const space = Math.min(profile.maximum, Math.max(24, Math.floor(length / profile.spacing)));
  return { near: Math.min(count, space), far: Math.min(count, Math.max(12, Math.floor(space * profile.overview))) };
}

const vertexShader = `
  attribute vec4 aRoute;
  attribute vec4 aMotion;
  attribute float aRank;
  uniform float uTime;
  uniform float uPointScale;
  uniform float uMaxPointSize;
  uniform float uPixelRatio;
  uniform float uNearCount;
  uniform float uFarCount;
  varying float vStride;
  varying float vPerson;
  varying float vVisible;

  void main() {
    float w = aRoute.z * 2.0;
    float d = aRoute.w * 2.0;
    float perimeter = 2.0 * (w + d);
    float progress = mod(aMotion.x + uTime * aMotion.y * aMotion.z, perimeter);
    vec2 foot;
    if (progress < w) foot = vec2(-aRoute.z + progress, -aRoute.w);
    else if (progress < w + d) foot = vec2(aRoute.z, -aRoute.w + progress - w);
    else if (progress < 2.0 * w + d) foot = vec2(aRoute.z - progress + w + d, aRoute.w);
    else foot = vec2(-aRoute.z, aRoute.w - progress + 2.0 * w + d);
    vec3 worldPosition = vec3(aRoute.x + foot.x, position.y, aRoute.y + foot.y);
    vec4 mvPosition = modelViewMatrix * vec4(worldPosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float size = min(uMaxPointSize, uPointScale / max(0.01, -mvPosition.z));
    gl_PointSize = max(1.0, size);
    float detail = smoothstep(3.5, 16.0, size / uPixelRatio);
    float limit = mix(uFarCount, uNearCount, detail);
    vVisible = step(0.05, -mvPosition.z) * (1.0 - smoothstep(limit, limit + 12.0, aRank));
    if (vVisible < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vStride = sin(uTime * aMotion.y * 7.0 + aMotion.x * 1.8);
    vPerson = aMotion.w;
  }
`;

const fragmentShader = `
  uniform vec3 uShirtA;
  uniform vec3 uShirtB;
  uniform vec3 uShirtC;
  uniform vec3 uSkinA;
  uniform vec3 uSkinB;
  varying float vStride;
  varying float vPerson;
  varying float vVisible;

  float rect(vec2 p, vec2 center, vec2 halfSize) {
    vec2 q = abs(p - center) - halfSize;
    return 1.0 - step(0.0, max(q.x, q.y));
  }
  void main() {
    if (vVisible < 0.01) discard;
    vec2 p = vec2(gl_PointCoord.x * 2.0 - 1.0, 1.0 - gl_PointCoord.y * 2.0);
    float leftFoot = -0.15 + vStride * 0.10;
    float rightFoot = 0.15 - vStride * 0.10;
    float head = 1.0 - step(1.0, length((p - vec2(0.0, 0.60)) / vec2(0.22, 0.23)));
    float hair = head * step(0.71, p.y);
    float neck = rect(p, vec2(0.0, 0.35), vec2(0.09, 0.11));
    float torso = rect(p, vec2(0.0, 0.07), vec2(0.27 - max(0.0, p.y) * 0.09, 0.29));
    float armL = rect(p, vec2(-0.33, 0.02 + vStride * 0.08), vec2(0.065, 0.29));
    float armR = rect(p, vec2(0.33, 0.02 - vStride * 0.08), vec2(0.065, 0.29));
    float handL = rect(p, vec2(-0.33, -0.28 + vStride * 0.08), vec2(0.065, 0.065));
    float handR = rect(p, vec2(0.33, -0.28 - vStride * 0.08), vec2(0.065, 0.065));
    float legL = rect(p, vec2(leftFoot, -0.51), vec2(0.09, 0.30));
    float legR = rect(p, vec2(rightFoot, -0.51), vec2(0.09, 0.30));
    float shoeL = rect(p, vec2(leftFoot - 0.035, -0.84), vec2(0.13, 0.055));
    float shoeR = rect(p, vec2(rightFoot + 0.035, -0.84), vec2(0.13, 0.055));
    float skin = max(max(head, neck), max(handL, handR));
    float shirt = max(torso, max(armL, armR));
    float legs = max(legL, legR);
    float shoes = max(shoeL, shoeR);
    float mask = max(max(skin, shirt), max(legs, shoes));
    if (mask < 0.5) discard;
    vec3 shirtColor = vPerson < 0.5 ? mix(uShirtA, uShirtB, vPerson * 2.0) : mix(uShirtB, uShirtC, (vPerson - 0.5) * 2.0);
    vec3 skinColor = mix(uSkinA, uSkinB, fract(vPerson * 5.71));
    vec3 color = vec3(0.13, 0.17, 0.18);
    if (shirt > 0.5) color = shirtColor;
    if (skin > 0.5) color = skinColor;
    if (hair > 0.5 || shoes > 0.5) color = vec3(0.085, 0.07, 0.055);
    color *= 0.88 + 0.12 * step(0.0, p.x);
    gl_FragColor = vec4(color, vVisible);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class ResidentCrowd {
  constructor(districts, count, { density = 'lively' } = {}) {
    validateCount(count);
    this.count = count;
    const routes = pedestrianRoutes(districts);
    this.routes = routes;
    this.capacity = crowdBudget(routes, count, 'crowd').near;
    this.budget = crowdBudget(routes, count, density);
    this.density = density;
    this.lastTime = null;
    const routeData = new Float32Array(this.capacity * 4);
    const motionData = new Float32Array(this.capacity * 4);
    const positions = new Float32Array(this.capacity * 3);
    const ranks = new Float32Array(this.capacity);
    const lengths = routes.map(route => 4 * (route.halfWidth + route.halfDepth));
    const cumulative = [];
    let total = 0;
    lengths.forEach((length, index) => { total += length * routes[index].weight; cumulative.push(total); });
    if (count && !routes.length) throw new Error('Load a repository before adding residents.');
    let state = 0x7f4a7c15;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let index = 0; index < this.capacity; index++) {
      const choice = random() * total;
      let ri = 0;
      while (ri < cumulative.length - 1 && choice > cumulative[ri]) ri++;
      const route = routes[ri];
      const lane = (random() * 2 - 1) * route.lane;
      routeData.set([route.x, route.z, route.halfWidth + lane, route.halfDepth + lane], index * 4);
      motionData.set([random() * lengths[ri], 0.62 + random() * 0.58, random() > 0.5 ? 1 : -1, random()], index * 4);
      positions.set([route.x, route.height, route.z], index * 3);
      ranks[index] = index + 0.5;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aRoute', new THREE.BufferAttribute(routeData, 4));
    this.geometry.setAttribute('aMotion', new THREE.BufferAttribute(motionData, 4));
    this.geometry.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
    this.geometry.setDrawRange(0, Math.min(this.capacity, this.budget.near + 12));
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uTime: { value: 0 }, uPointScale: { value: 600 }, uMaxPointSize: { value: 128 },
        uPixelRatio: { value: 1 }, uNearCount: { value: this.budget.near }, uFarCount: { value: this.budget.far },
        uShirtA: { value: new THREE.Color('#547785') },
        uShirtB: { value: new THREE.Color('#aa7754') },
        uShirtC: { value: new THREE.Color('#64704f') },
        uSkinA: { value: new THREE.Color('#d8b594') },
        uSkinB: { value: new THREE.Color('#856448') },
      },
      transparent: true, depthWrite: false, depthTest: true,
    });
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.name = 'star-residents';
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
    this.object.userData = { residents: count, figureCapacity: this.capacity, density, adaptiveDensity: true, animatedOnGPU: true };
    this.object.visible = count > 0;
  }

  setDensity(density) {
    this.budget = crowdBudget(this.routes, this.count, density);
    this.density = density;
    this.object.userData.density = density;
  }

  update(time, camera, renderer) {
    const uniforms = this.material.uniforms;
    const delta = this.lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    const blend = 1 - Math.exp(-delta * 7);
    uniforms.uNearCount.value += (this.budget.near - uniforms.uNearCount.value) * blend;
    uniforms.uFarCount.value += (this.budget.far - uniforms.uFarCount.value) * blend;
    uniforms.uTime.value = time;
    uniforms.uPointScale.value = renderer.domElement.height * camera.projectionMatrix.elements[5] * 0.71;
    uniforms.uPixelRatio.value = renderer.getPixelRatio();
    this.geometry.setDrawRange(0, Math.min(this.capacity, Math.ceil(uniforms.uNearCount.value + 12)));
  }

  dispose() {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
