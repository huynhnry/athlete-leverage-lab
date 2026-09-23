import * as THREE from 'three';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const degToRad = (d) => d * Math.PI / 180;
export const radToDeg = (r) => r * 180 / Math.PI;

export function solveTwoLink3D(a, b, lenA, lenB, bendHint) {
  const start = a.clone();
  const end = b.clone();
  const delta = end.clone().sub(start);
  let d = delta.length();
  const maxReach = Math.max(1e-6, lenA + lenB - 1e-5);
  const minReach = Math.abs(lenA - lenB) + 1e-5;
  d = clamp(d, minReach, maxReach);
  const e = delta.lengthSq() > 1e-10 ? delta.normalize() : new THREE.Vector3(0, 1, 0);

  const along = (lenA * lenA - lenB * lenB + d * d) / (2 * d);
  const radialSq = Math.max(0, lenA * lenA - along * along);
  const radial = Math.sqrt(radialSq);
  const center = start.clone().addScaledVector(e, along);

  let n = bendHint.clone();
  n.addScaledVector(e, -n.dot(e));
  if (n.lengthSq() < 1e-8) {
    n = Math.abs(e.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    n.addScaledVector(e, -n.dot(e));
  }
  n.normalize();
  return center.addScaledVector(n, radial);
}

export function angleBetween(a, b, c) {
  const ba = a.clone().sub(b).normalize();
  const bc = c.clone().sub(b).normalize();
  return radToDeg(Math.acos(clamp(ba.dot(bc), -1, 1)));
}

export function horizontalMomentArm(point, forceLineZ) {
  return Math.abs(point.z - forceLineZ);
}
