export const MODEL_URL = 'https://cdn.jsdelivr.net/gh/nirholas/three.ws@482a12381caeb4122e2444cf8727a476f2c4dfc2/public/avatars/parametric-base.glb';

export const DEFAULT_MEASUREMENTS = Object.freeze({
  height: 175,
  bodyMass: 92,
  torso: 48,
  femur: 44,
  tibia: 42,
  upperArm: 33,
  forearm: 29,
  shoulderWidth: 46,
  hipWidth: 33,
  barMass: 180,
});

export const MEASUREMENT_FIELDS = Object.freeze([
  { key: 'height', label: 'Height', unit: 'cm', min: 130, max: 220, step: 0.5 },
  { key: 'bodyMass', label: 'Body mass', unit: 'kg', min: 40, max: 220, step: 0.5 },
  { key: 'torso', label: 'Torso', unit: 'cm', min: 30, max: 70, step: 0.2 },
  { key: 'femur', label: 'Femur', unit: 'cm', min: 30, max: 65, step: 0.2 },
  { key: 'tibia', label: 'Tibia', unit: 'cm', min: 28, max: 60, step: 0.2 },
  { key: 'upperArm', label: 'Upper arm', unit: 'cm', min: 22, max: 45, step: 0.2 },
  { key: 'forearm', label: 'Forearm', unit: 'cm', min: 20, max: 40, step: 0.2 },
  { key: 'shoulderWidth', label: 'Shoulder width', unit: 'cm', min: 30, max: 65, step: 0.2 },
  { key: 'hipWidth', label: 'Hip width', unit: 'cm', min: 22, max: 50, step: 0.2 },
  { key: 'barMass', label: 'Bar load', unit: 'kg', min: 20, max: 500, step: 1 },
]);

export const MOVEMENTS = Object.freeze({
  highBar: { label: 'High-bar squat', subtitle: 'Vertical bar constraint · depth target: hip crease at knee' },
  lowBar: { label: 'Low-bar squat', subtitle: 'Lower bar position · greater modeled torso inclination' },
  deadlift: { label: 'Deadlift', subtitle: 'One continuous stance slider: conventional-like → sumo-like' },
  bench: { label: 'Bench press', subtitle: 'Grip width changes shoulder/elbow geometry around a fixed bench' },
});

export const G = 9.80665;
