import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDING_KINDS, createBuilding } from '../src/buildings.js';
import { demoRepository } from '../server/demo.mjs';

const hash = text => {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
};

function inspect(building) {
  const bounds = new THREE.Box3().setFromObject(building.root);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(bounds.min.y >= -0.00001, 'geometry stays above the pavement');
  assert.ok(size.x <= 5.4 && size.z <= 5.4, 'ornaments stay inside a city lot');
  assert.ok(Math.abs(bounds.max.y - building.height) < 0.00001, 'camera and link anchors include the roof');
  assert.ok(Math.abs(size.x - building.width) < 0.00001);
  assert.ok(Math.abs(size.z - building.depth) < 0.00001);
  building.root.traverse(object => {
    const vertices = object.geometry?.attributes.position?.array;
    if (vertices) assert.ok(vertices.every(Number.isFinite), 'all vertices are finite');
    if (object.material) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
      if (mat.isMeshStandardMaterial) assert.equal(mat.emissiveIntensity, 0, 'daylight materials do not emit by default');
    }
  });
}

function dispose(building) {
  const materials = new Set([building.side, building.roof]);
  building.root.traverse(object => {
    object.geometry?.dispose();
    if (object.material) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat);
  });
  materials.forEach(mat => mat.dispose());
}

test('all building types fit their lots and report complete bounds at tiny and huge file sizes', () => {
  for (const seed of BUILDING_KINDS.keys()) for (const lines of [0, 1, 31, 100000, Infinity]) for (const style of ['game', 'tool']) {
    const building = createBuilding({ file: { path: 'project/code.ts', lines }, seed, style, width: 4.7, depth: 4.6 });
    inspect(building);
    dispose(building);
  }
});

test('City and Workbench keep the same file height, and file size grows within each type', () => {
  for (const seed of BUILDING_KINDS.keys()) {
    const small = createBuilding({ file: { path: 'project/code.ts', lines: 8 }, seed });
    const big = createBuilding({ file: { path: 'project/code.ts', lines: 600 }, seed });
    const tool = createBuilding({ file: { path: 'project/code.ts', lines: 600 }, seed, style: 'tool' });
    assert.ok(big.height > small.height);
    assert.equal(big.kind, tool.kind);
    assert.ok(Math.abs(big.height - tool.height) < 0.00001);
    for (const item of [small, big, tool]) dispose(item);
  }
});

test('the sample city has all nine silhouettes and keeps them across deterministic rebuilds', async () => {
  const repo = await demoRepository(), kinds = new Set();
  for (const file of repo.files) {
    const config = { file, seed: hash(file.path) };
    const first = createBuilding(config), again = createBuilding(config);
    kinds.add(first.kind);
    assert.deepEqual([first.kind, first.height, first.width, first.depth], [again.kind, again.height, again.width, again.depth]);
    inspect(first); dispose(first); dispose(again);
  }
  assert.equal(kinds.size, BUILDING_KINDS.length);
});

test('merged decoration meshes still raycast to the owning file', () => {
  for (const seed of BUILDING_KINDS.keys()) {
    const file = { path: 'project/code.ts', lines: 40, id: 'selected-file' };
    const building = createBuilding({ file, seed });
    building.root.userData.file = file;
    assert.ok(building.geometryStats.after < building.geometryStats.before, 'repeated decorations share draw calls');
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.8, 20), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObject(building.root, true);
    assert.ok(hits.length > 0);
    let picked = hits[0].object;
    while (picked && !picked.userData.file) picked = picked.parent;
    assert.equal(picked?.userData.file, file);
    dispose(building);
  }
});
