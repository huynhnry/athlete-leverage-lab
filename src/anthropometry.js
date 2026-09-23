import { DEFAULT_MEASUREMENTS } from './config.js';
import { clamp } from './math.js';

const CM = 0.01;

export function sanitizeMeasurements(raw) {
  return {
    height: clamp(Number(raw.height) || DEFAULT_MEASUREMENTS.height, 130, 220),
    bodyMass: clamp(Number(raw.bodyMass) || DEFAULT_MEASUREMENTS.bodyMass, 40, 220),
    torso: clamp(Number(raw.torso) || DEFAULT_MEASUREMENTS.torso, 30, 70),
    femur: clamp(Number(raw.femur) || DEFAULT_MEASUREMENTS.femur, 30, 65),
    tibia: clamp(Number(raw.tibia) || DEFAULT_MEASUREMENTS.tibia, 28, 60),
    upperArm: clamp(Number(raw.upperArm) || DEFAULT_MEASUREMENTS.upperArm, 22, 45),
    forearm: clamp(Number(raw.forearm) || DEFAULT_MEASUREMENTS.forearm, 20, 40),
    shoulderWidth: clamp(Number(raw.shoulderWidth) || DEFAULT_MEASUREMEMENTS.shoulderWidth, 30, 65),
    hipWidth: clamp(Number(raw.hipWidth) || DEFAULT_MEASUREMENTS.hipWidth, 22, 50),
    barMass: clamp(Number(raw.barMass) || DEFAULT_MEASUREMENTS.barMass, 20, 500),
  };
}

export function toMeters(m) {
  return {
    ...m,
    height: m.height * CM,
    torso: m.torso * CM,
    femur: m.femur * CM,
    tibia: m.tibia * CM,
    upperArm: m.upperArm * CM,
    forearm: m.forearm * CM,
    shoulderWidth: m.shoulderWidth * CM,
    hipWidth: m.hipWidth * CM,
  };
}

export function proportionSummary(m) {
  return {
    femurTorso: m.femur / m.torso,
    femurTibia: m.femur / m.tibia,
    armTorso: (m.upperArm + m.forearm) / m.torso,
    shoulderHip: m.shoulderWidth / m.hipWidth,
  };
}

export function consistencyNote(m) {
  const estimatedSegmentStack = m.femur + m.tibia + m.torso;
  const ratio = estimatedSegmentStack / m.height;
  if (ratio > 0.88) return 'Your entered torso + femur + tibia are unusually large relative to height. Double-check landmark definitions before trusting the mechanics.';
  if (ratio < 0.62) return 'Your entered torso + femur + tibia are unusually small relative to height. Double-check landmark definitions before trusting the mechanics.';
  return 'Height is a reference/check measurement. The solver uses the more specific segment lengths directly.';
}
