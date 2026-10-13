import test from 'node:test';
import assert from 'node:assert/strict';
import { ResidentCrowd, streetRoutes, pedestrianRoutes, crowdBudget } from '../src/crowd.js';

const districts = [{ x: -10, z: 4, width: 18, depth: 22 }, { x: 12, z: -8, width: 14, depth: 16 }];

test('population keeps every star while the render pool stays bounded for huge repositories', () => {
  for (const count of [0, 1, 55_555, 50_000_000]) {
    const crowd = new ResidentCrowd(districts, count);
    assert.equal(crowd.count, count);
    assert.equal(crowd.object.userData.residents, count);
    assert.equal(crowd.geometry.getAttribute('aMotion').count, crowd.capacity);
    assert.equal(crowd.geometry.getAttribute('aRank').count, crowd.capacity);
    assert.ok(crowd.capacity <= 10000 && crowd.capacity <= count);
    assert.ok(crowd.geometry.drawRange.count <= crowd.capacity);
    if (count < 2) assert.equal(crowd.capacity, count);
    if (count > 10000) assert.ok(crowd.capacity < count);
    assert.equal(crowd.object.visible, count > 0);
    crowd.dispose();
  }
});

test('walking routes surround the sidewalk parcels and invalid counts are rejected', () => {
  const routes = streetRoutes(districts);
  routes.forEach((route, index) => {
    assert.ok(route.x - route.halfWidth < districts[index].x - districts[index].width / 2);
    assert.ok(route.x + route.halfWidth > districts[index].x + districts[index].width / 2);
    assert.ok(route.z - route.halfDepth < districts[index].z - districts[index].depth / 2);
    assert.ok(route.z + route.halfDepth > districts[index].z + districts[index].depth / 2);
  });
  for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => new ResidentCrowd(districts, count));
  assert.throws(() => new ResidentCrowd([], 1), /repository/);
  for (const density of ['invalid', 'toString', 'constructor']) assert.throws(() => new ResidentCrowd(districts, 1, { density }), /density/);
});

test('density budgets grow from calm to crowd and reveal more figures near the camera', () => {
  const routes = pedestrianRoutes(districts);
  const calm = crowdBudget(routes, 55_555, 'calm');
  const lively = crowdBudget(routes, 55_555, 'lively');
  const crowd = crowdBudget(routes, 55_555, 'crowd');
  assert.ok(calm.near < lively.near && lively.near < crowd.near);
  assert.ok(calm.far < lively.far && lively.far < crowd.far);
  for (const budget of [calm, lively, crowd]) assert.ok(budget.far < budget.near);
  assert.deepEqual(crowdBudget(routes, 1), { near: 1, far: 1 });
  assert.deepEqual(crowdBudget(routes, 0), { near: 0, far: 0 });
});

test('changing density fades the same figure pool without changing population or reallocating it', () => {
  const crowd = new ResidentCrowd(districts, 55_555, { density: 'calm' });
  const geometry = crowd.geometry;
  const motion = geometry.getAttribute('aMotion').array;
  const initialNear = crowd.material.uniforms.uNearCount.value;
  crowd.setDensity('crowd');
  const camera = { projectionMatrix: { elements: [0, 0, 0, 0, 0, 3] } };
  const renderer = { domElement: { height: 900 }, getPixelRatio: () => 1.5 };
  crowd.update(1, camera, renderer);
  crowd.update(1.05, camera, renderer);
  const fadedNear = crowd.material.uniforms.uNearCount.value;
  assert.ok(fadedNear > initialNear && fadedNear < crowd.budget.near);
  assert.equal(crowd.geometry, geometry);
  assert.equal(crowd.geometry.getAttribute('aMotion').array, motion);
  assert.equal(crowd.count, 55_555);
  assert.equal(crowd.object.userData.residents, 55_555);
  assert.equal(crowd.object.userData.density, 'crowd');
  assert.equal(crowd.material.uniforms.uPixelRatio.value, 1.5);
  crowd.setDensity('lively');
  assert.throws(() => crowd.setDensity('invalid'), /density/);
  assert.equal(crowd.density, 'lively');
  crowd.dispose();
});

test('interior routes use vacant lots and aisles without entering occupied building footprints', () => {
  const district = { x: 0, z: 0, cols: 3, rows: 3, width: 3 * 6.25 + 2.3, depth: 3 * 6.25 + 3.8, files: Array.from({ length: 7 }, () => ({})) };
  const routes = pedestrianRoutes([district]);
  for (const kind of ['street', 'promenade', 'courtyard', 'park', 'crossing']) assert.ok(routes.some(route => route.kind === kind), kind);
  const plots = district.files.map((_, slot) => ({
    x: -district.width / 2 + 1.15 + (slot % 3 + 0.5) * 6.25,
    z: -district.depth / 2 + 1.15 + (Math.floor(slot / 3) + 0.5) * 6.25,
  }));
  for (const route of routes) {
    for (const lane of [-route.lane, route.lane]) {
      const w = route.halfWidth + lane, d = route.halfDepth + lane;
      for (let t = 0; t <= 1; t += 0.05) {
        const points = [[-w + 2 * w * t, -d], [w, -d + 2 * d * t], [w - 2 * w * t, d], [-w, d - 2 * d * t]];
        for (const [x, z] of points) for (const plot of plots) {
          assert.ok(Math.abs(route.x + x - plot.x) > 2.7 + 0.28 || Math.abs(route.z + z - plot.z) > 2.7 + 0.28, `${route.kind} should keep a person clear of the widest building`);
        }
      }
    }
  }
  const vacant = pedestrianRoutes([{ ...district, files: [{}] }]);
  assert.ok(vacant.some(route => route.kind === 'square'));
});
