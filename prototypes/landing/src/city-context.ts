import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A quiet, fixed city block. Batch its furniture by material to keep phone draw calls low. */
export function createCityContext() {
  const group = new THREE.Group(); group.name = 'city-context';
  const materials: THREE.MeshStandardMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const batches = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
  function material(color: number, roughness = .85) {
    const value = new THREE.MeshStandardMaterial({ color, roughness }); materials.push(value); return value;
  }
  const chalk = material(0xe5e7e3), facade = material(0xd5dbd5), facadeLight = material(0xe1e4df);
  const window = material(0xa7b5ad, .55), trim = material(0xc4cdc5), pavement = material(0xe8eae5);
  const asphalt = material(0xcbd2ce), white = material(0xf9faf7), dark = material(0x58675f);
  const foliage = material(0xa6b4a3), trunk = material(0xaeb4a8), carPaint = material(0xb9c5bd, .55);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const rounded = new RoundedBoxGeometry(1, 1, 1, 2, .1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const crown = new THREE.IcosahedronGeometry(1, 1);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  function part(shape: THREE.BufferGeometry, paint: THREE.MeshStandardMaterial, size: number[], xyz: number[], angle = 0, axis = 'y') {
    position.set(xyz[0], xyz[1], xyz[2]); scale.set(size[0], size[1], size[2]);
    rotation.setFromAxisAngle(axis === 'z' ? new THREE.Vector3(0, 0, 1) : axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), angle);
    matrix.compose(position, rotation, scale);
    const geometry = (shape.index ? shape.toNonIndexed() : shape.clone()).applyMatrix4(matrix);
    const batch = batches.get(paint) ?? []; batch.push(geometry); batches.set(paint, batch);
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, paint: THREE.MeshStandardMaterial) { part(cube, paint, [w, h, d], [x, y, z]); }
  function building(x: number, z: number, w: number, d: number, h: number, paint: THREE.MeshStandardMaterial) {
    box(w, h, d, x, h / 2 + .1, z, paint);
    box(w + .15, .16, d + .15, x, h + .18, z, chalk);
    box(w - .4, .08, d - .4, x, h + .29, z, trim);
    for (let y = 1.1; y < h - .5; y += 1.35) {
      for (let dx = -w / 2 + .65; dx < w / 2 - .4; dx += 1.15) box(.6, .8, .035, x + dx, y, z + d / 2 + .025, window);
      for (let dz = -d / 2 + .7; dz < d / 2 - .4; dz += 1.2) box(.035, .8, .6, x + w / 2 + .025, y, z + dz, window);
    }
    box(.85, 1.3, .055, x, .75, z + d / 2 + .04, trim);
    box(w + .1, .1, .6, x, .14, z + d / 2 + .2, pavement);
  }
  function tree(x: number, z: number, size = 1) {
    part(cylinder, trunk, [.1, 1.45, .1], [x, .8, z]);
    part(crown, foliage, [.8 * size, 1.2 * size, .8 * size], [x, 1.7 * size, z]);
    box(1.25, .1, 1.25, x, .11, z, trim);
  }
  function car(x: number, z: number, paint: THREE.MeshStandardMaterial) {
    // Travel along the street's X axis; every wheel rests on the road.
    part(rounded, paint, [3, .48, 1.35], [x, .55, z]);
    part(rounded, window, [1.6, .5, 1.2], [x - .1, 1.01, z]);
    box(1.4, .06, 1.2, x - .1, 1.29, z, paint);
    for (const dx of [-.95, .95]) for (const dz of [-.69, .69]) {
      part(cylinder, dark, [.25, .13, .25], [x + dx, .34, z + dz], Math.PI / 2, 'x');
    }
    for (const dz of [-.44, .44]) box(.04, .13, .22, x + 1.52, .57, z + dz, white);
  }
  function lamp(x: number, z: number) {
    part(cylinder, trim, [.055, 3.2, .055], [x, 1.72, z]);
    box(.6, .055, .08, x + .27, 3.32, z, trim);
    box(.35, .07, .2, x + .43, 3.25, z, chalk);
    part(cylinder, trim, [.15, .14, .15], [x, .19, z]);
  }
  // Sidewalk and road are separate planes; none crosses the entrance approach.
  box(34, .25, 28, 0, -.25, .5, chalk);
  box(32, .06, 4.1, 0, .04, 9.55, asphalt);
  box(32, .11, 2, 0, .06, 12.7, pavement);
  box(32, .14, .14, 0, .09, 11.66, trim);
  box(32, .14, .14, 0, .09, 7.43, trim);
  for (let x = -15; x <= 15; x += 2.5) box(1.15, .015, .08, x, .079, 9.55, white);
  // Crossing terminates at the existing pedestrian approach, leaving the accessible bay empty.
  for (let z = 7.75; z < 11.6; z += .6) box(1.7, .016, .3, -4.8, .081, z, white);
  building(-12.2, -1.6, 5, 6.3, 4.9, facadeLight);
  building(12, -5.9, 4.6, 5.6, 6.0, facade);
  building(-2.5, -10.1, 6.4, 3.7, 5.0, facadeLight);
  building(6.2, -11, 4.7, 3.9, 6.7, facade);
  car(4.5, 8.4, carPaint); car(-10.8, 10.6, chalk); car(12, 10.6, carPaint);
  for (const [x, z] of [[-14,6.6],[8.8,6.6],[-8,12.6],[11,12.6]]) lamp(x, z);
  for (const [x,z,s] of [[-12,5.5,1],[-15,-7,1.1],[12,2.3,1],[14.5,-1,1.2],[-7.2,-10.5,.85],[5,12.7,.8]]) tree(x,z,s);
  // Short pavement joints give scale without a busy texture or tiny labels.
  for (let x = -15; x < 16; x += 2) box(.025, .01, 1.8, x, .12, 12.7, chalk);
  for (const [paint, parts] of batches) {
    const geometry = mergeGeometries(parts, false)!;
    parts.forEach(part => part.dispose()); geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, paint); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  cube.dispose(); rounded.dispose(); cylinder.dispose(); crown.dispose();
  return { group, materials, geometries };
}
