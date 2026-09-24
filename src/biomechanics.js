import * as THREE from 'three';
import { G } from './config.js';
import { angleBetween, clamp, degToRad, horizontalMomentArm, lerp, radToDeg, smoothstep, solveTwoLink3D } from './math.js';

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function sidePoints(centerHip, centerShoulder, hipWidth, shoulderWidth) {
  return {
    leftHip: centerHip.clone().add(v(-hipWidth / 2, 0, 0)),
    rightHip: centerHip.clone().add(v(hipWidth / 2, 0, 0)),
    leftShoulder: centerShoulder.clone().add(v(-shoulderWidth / 2, 0, 0)),
    rightShoulder: centerShoulder.clone().add(v(shoulderWidth / 2, 0, 0)),
  };
}

function legIK(hip, ankle, femur, tibia) {
  // Knee direction follows the actual hip-to-foot lateral offset. A narrow
  // stance therefore pulls the knees inward; a wide stance pushes them out.
  // The forward component keeps the knee from collapsing into the frontal
  // plane while still preserving both segment lengths exactly.
  const lateral = ankle.x - hip.x;
  const bend = v(lateral * 2.4, 0.06, Math.max(0.11, femur * 0.42));
  return solveTwoLink3D(ankle, hip, tibia, femur, bend);
}

function demandFromMoment(moment, force, referenceArm = 0.30) {
  return clamp(moment / Math.max(1, force * referenceArm), 0, 1);
}

function inactiveDemands() {
  return {
    quads: 0.035,
    glutes: 0.035,
    hamstrings: 0.035,
    adductors: 0.035,
    erectors: 0.035,
    pecs: 0.035,
    triceps: 0.035,
    frontDelts: 0.035,
  };
}

function armIK(shoulder, hand, upperArm, forearm, side, elbowFlare = 0.75) {
  const outward = side === 'left' ? -1 : 1;
  const bend = v(outward * elbowFlare, -0.15, 0.7);
  return solveTwoLink3D(shoulder, hand, upperArm, forearm, bend);
}

function squatLean(m, style, stanceMult) {
  const ratio = m.femur / m.torso;
  const stanceRelief = clamp((stanceMult - 1) * 6, -2, 8);
  const base = style === 'lowBar' ? 38 : 27;
  const proportionTerm = clamp((ratio - 0.92) * 24, -7, 12);
  return degToRad(clamp(base + proportionTerm - stanceRelief, style === 'lowBar' ? 26 : 14, style === 'lowBar' ? 58 : 46));
}

function solveSquatBottomBarY(m, style, stanceWidth, leanBottom, barZ) {
  const torsoAttach = m.torso * (style === 'lowBar' ? 0.88 : 1.0);
  const hipX = m.hipWidth / 2;
  const ankleX = stanceWidth / 2;
  const hipZ = barZ - torsoAttach * Math.sin(leanBottom);
  const f = (barY) => {
    const hipY = barY - torsoAttach * Math.cos(leanBottom);
    const hip = v(hipX, hipY, hipZ);
    const ankle = v(ankleX, 0.02, 0);
    const knee = legIK(hip, ankle, m.femur, m.tibia);
    return hipY - knee.y;
  };

  let lo = 0.55, hi = 1.8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > -0.005) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function squatPose(m, style, stanceMult, progress) {
  const s = smoothstep(progress);
  const stanceWidth = m.hipWidth * stanceMult;
  const barZ = 0.015;
  const leanBottom = squatLean(m, style, stanceMult);
  const leanTop = degToRad(style === 'lowBar' ? 10 : 4);
  const torsoAttach = m.torso * (style === 'lowBar' ? 0.88 : 1.0);

  const hipLateral = m.hipWidth / 2;
  const ankleLateral = stanceWidth / 2;
  const legMax = m.femur + m.tibia - 0.015;
  const topHorizontalSq = Math.pow(ankleLateral - hipLateral, 2) + Math.pow(torsoAttach * Math.sin(leanTop), 2);
  const hipYTop = Math.sqrt(Math.max(0.2, legMax * legMax - topHorizontalSq));
  const barYTop = hipYTop + torsoAttach * Math.cos(leanTop);
  const barYBottom = solveSquatBottomBarY(m, style, stanceWidth, leanBottom, barZ);
  const barY = lerp(barYTop, barYBottom, s);
  const lean = lerp(leanTop, leanBottom, s);

  const hipCenter = v(0, barY - torsoAttach * Math.cos(lean), barZ - torsoAttach * Math.sin(lean));
  const shoulderCenter = hipCenter.clone().add(v(0, m.torso * Math.cos(lean), m.torso * Math.sin(lean)));
  const sides = sidePoints(hipCenter, shoulderCenter, m.hipWidth, m.shoulderWidth);
  const ankles = {
    leftAnkle: v(-stanceWidth / 2, 0.02, 0),
    rightAnkle: v(stanceWidth / 2, 0.02, 0),
  };
  const knees = {
    leftKnee: legIK(sides.leftHip, ankles.leftAnkle, m.femur, m.tibia),
    rightKnee: legIK(sides.rightHip, ankles.rightAnkle, m.femur, m.tibia),
  };

  // Rack grip is solved from the same measured arm lengths used by bench and
  // deadlift. This removes the old visual-only hand pose that could never land
  // on the shaft.
  const squatGrip = Math.max(m.shoulderWidth * 1.55, m.shoulderWidth + 0.22);
  const hands = {
    leftHand: v(-squatGrip / 2, barY, barZ),
    rightHand: v(squatGrip / 2, barY, barZ),
  };
  const elbows = {
    leftElbow: armIK(sides.leftShoulder, hands.leftHand, m.upperArm, m.forearm, 'left', 0.62),
    rightElbow: armIK(sides.rightShoulder, hands.rightHand, m.upperArm, m.forearm, 'right', 0.62),
  };

  const bar = v(0, barY, barZ);
  const barForce = m.barMass * G;
  const upperBodyForce = m.bodyMass * G * 0.58;
  const trunkCom = hipCenter.clone().lerp(shoulderCenter, 0.48);
  const kneeMid = knees.leftKnee.clone().add(knees.rightKnee).multiplyScalar(0.5);
  const hipMoment = horizontalMomentArm(hipCenter, barZ) * barForce + horizontalMomentArm(hipCenter, trunkCom.z) * upperBodyForce;
  const kneeMoment = horizontalMomentArm(kneeMid, barZ) * barForce * 0.52 + horizontalMomentArm(kneeMid, trunkCom.z) * upperBodyForce * 0.44;
  const frontalHipOffset = Math.abs(stanceWidth - m.hipWidth) / 2;
  const adductionProxy = frontalHipOffset * (barForce + upperBodyForce) * (0.45 + 0.55 * s);

  const depth = hipCenter.y - kneeMid.y;
  const trunkAngle = radToDeg(lean);

  const totalForce = barForce + upperBodyForce;
  const hipD = demandFromMoment(hipMoment, totalForce);
  const kneeD = demandFromMoment(kneeMoment, totalForce);
  const adductorD = clamp(adductionProxy / Math.max(1, totalForce * 0.18), 0, 1);
  const demands = inactiveDemands();
  demands.quads = kneeD;
  demands.glutes = clamp(0.78 * hipD + 0.18 * adductorD, 0, 1);
  demands.hamstrings = clamp(0.56 * hipD + 0.10 * kneeD, 0, 1);
  demands.adductors = clamp(0.62 * adductorD + 0.28 * hipD, 0, 1);
  demands.erectors = clamp(0.58 * hipD + 0.42 * (trunkAngle / 55), 0, 1);

  return {
    movement: style,
    bar,
    barPath: { start: v(0, barYBottom, barZ), end: v(0, barYTop, barZ) },
    joints: { hipCenter, shoulderCenter, ...sides, ...ankles, ...knees, ...hands, ...elbows },
    demands,
    metrics: {
      hipMoment,
      kneeMoment,
      adductionProxy,
      trunkAngle,
      depth,
      stanceWidth,
      barDeviation: 0,
    },
  };
}

function deadliftGripWidth(m, stanceWidth) {
  const ratio = stanceWidth / m.hipWidth;
  if (ratio < 1.35) return Math.max(m.shoulderWidth * 1.02, stanceWidth + 0.12);
  if (ratio > 1.6) return Math.max(0.34, Math.min(m.shoulderWidth * 0.9, stanceWidth - 0.16));
  const t = (ratio - 1.35) / 0.25;
  const outside = Math.max(m.shoulderWidth * 1.02, stanceWidth + 0.12);
  const inside = Math.max(0.34, Math.min(m.shoulderWidth * 0.9, stanceWidth - 0.16));
  return lerp(outside, inside, t);
}

function deadliftPose(m, stanceMult, progress) {
  const s = smoothstep(progress);
  const stanceWidth = m.hipWidth * stanceMult;
  const gripWidth = deadliftGripWidth(m, stanceWidth);
  const styleT = clamp((stanceMult - 0.8) / 1.8, 0, 1);
  const bottomLean = degToRad(clamp(50 - styleT * 24 + (m.femur / m.torso - 0.92) * 14, 22, 58));
  const topLean = degToRad(1.5);
  const lean = lerp(bottomLean, topLean, s);
  const barZ = 0.035;
  const barYBottom = 0.225;

  const shoulderZOffset = lerp(0.045, 0.01, s);
  const dxArm = Math.abs(m.shoulderWidth - gripWidth) / 2;
  const availableVertical = Math.sqrt(Math.max(0.02, Math.pow(m.upperArm + m.forearm, 2) - dxArm * dxArm - shoulderZOffset * shoulderZOffset));
  const standingHipY = Math.sqrt(Math.max(0.25, Math.pow(m.femur + m.tibia - 0.015, 2) - Math.pow((stanceWidth - m.hipWidth) / 2, 2)));
  const shoulderYTop = standingHipY + m.torso;
  const barYTop = shoulderYTop - availableVertical;
  const barY = lerp(barYBottom, barYTop, s);

  const shoulderCenter = v(0, barY + availableVertical, barZ + shoulderZOffset);
  const hipCenter = shoulderCenter.clone().sub(v(0, m.torso * Math.cos(lean), m.torso * Math.sin(lean)));
  const sides = sidePoints(hipCenter, shoulderCenter, m.hipWidth, m.shoulderWidth);
  const ankles = {
    leftAnkle: v(-stanceWidth / 2, 0.02, 0),
    rightAnkle: v(stanceWidth / 2, 0.02, 0),
  };
  const knees = {
    leftKnee: legIK(sides.leftHip, ankles.leftAnkle, m.femur, m.tibia),
    rightKnee: legIK(sides.rightHip, ankles.rightAnkle, m.femur, m.tibia),
  };
  const hands = {
    leftHand: v(-gripWidth / 2, barY, barZ),
    rightHand: v(gripWidth / 2, barY, barZ),
  };
  const elbows = {
    leftElbow: armIK(sides.leftShoulder, hands.leftHand, m.upperArm, m.forearm, 'left', 0.15),
    rightElbow: armIK(sides.rightShoulder, hands.rightHand, m.upperArm, m.forearm, 'right', 0.15),
  };
  const bar = v(0, barY, barZ);
  const barForce = m.barMass * G;
  const kneeMid = knees.leftKnee.clone().add(knees.rightKnee).multiplyScalar(0.5);
  const hipMoment = horizontalMomentArm(hipCenter, barZ) * barForce;
  const kneeMoment = horizontalMomentArm(kneeMid, barZ) * barForce;
  const trunkMoment = Math.abs(shoulderCenter.z - hipCenter.z) * (m.bodyMass * G * 0.46) + hipMoment;
  const frontalHipOffset = Math.abs(stanceWidth - m.hipWidth) / 2;
  const hipAbduction = radToDeg(Math.atan2(frontalHipOffset, Math.max(0.05, m.femur)));
  const totalForce = barForce + m.bodyMass * G * 0.46;
  const hipD = demandFromMoment(hipMoment, totalForce);
  const kneeD = demandFromMoment(kneeMoment, totalForce);
  const trunkD = demandFromMoment(trunkMoment, totalForce);
  const adductorD = clamp((hipAbduction / 42) * 0.62 + hipD * 0.28, 0, 1);
  const demands = inactiveDemands();
  demands.quads = kneeD;
  demands.glutes = clamp(0.86 * hipD + 0.10 * adductorD, 0, 1);
  demands.hamstrings = clamp(0.76 * hipD + 0.08 * kneeD, 0, 1);
  demands.adductors = adductorD;
  demands.erectors = clamp(0.90 * trunkD, 0, 1);

  return {
    movement: 'deadlift',
    bar,
    barPath: { start: v(0, barYBottom, barZ), end: v(0, barYTop, barZ) },
    joints: { hipCenter, shoulderCenter, ...sides, ...ankles, ...knees, ...hands, ...elbows },
    demands,
    metrics: {
      hipMoment,
      kneeMoment,
      trunkMoment,
      stanceWidth,
      gripWidth,
      hipAbduction,
      trunkAngle: radToDeg(lean),
      barROM: barYTop - barYBottom,
      handsInside: gripWidth < stanceWidth,
    },
  };
}

function benchPose(m, gripMult, progress) {
  const s = smoothstep(progress);
  const gripWidth = m.shoulderWidth * gripMult;
  const benchTop = 0.47;
  const shoulderCenter = v(0, benchTop + 0.17, -0.22);
  const hipCenter = v(0, benchTop + 0.13, 0.26);
  const sides = sidePoints(hipCenter, shoulderCenter, m.hipWidth, m.shoulderWidth);

  // Put the shaft on the surface of the modeled chest rather than through the
  // ribcage. The torso mesh is thicker than the shoulder-joint center.
  const touchY = benchTop + 0.34;
  const touchZ = -0.08;
  const lockZ = shoulderCenter.z + 0.015;
  const dx = Math.abs(gripWidth - m.shoulderWidth) / 2;
  const totalArm = m.upperArm + m.forearm;
  const maxVertical = Math.sqrt(Math.max(0.04, totalArm * totalArm - dx * dx));
  const lockY = Math.min(touchY + 0.52, shoulderCenter.y + maxVertical * 0.96);
  const barY = lerp(touchY, lockY, s);
  const barZ = lerp(touchZ, lockZ, s);
  const hands = {
    leftHand: v(-gripWidth / 2, barY, barZ),
    rightHand: v(gripWidth / 2, barY, barZ),
  };
  const elbows = {
    leftElbow: armIK(sides.leftShoulder, hands.leftHand, m.upperArm, m.forearm, 'left', 0.95),
    rightElbow: armIK(sides.rightShoulder, hands.rightHand, m.upperArm, m.forearm, 'right', 0.95),
  };

  const footWidth = Math.max(m.hipWidth * 1.25, 0.42);
  const ankles = {
    leftAnkle: v(-footWidth / 2, 0.03, 0.48),
    rightAnkle: v(footWidth / 2, 0.03, 0.48),
  };
  const knees = {
    leftKnee: legIK(sides.leftHip, ankles.leftAnkle, m.femur, m.tibia),
    rightKnee: legIK(sides.rightHip, ankles.rightAnkle, m.femur, m.tibia),
  };
  const bar = v(0, barY, barZ);
  const halfForce = m.barMass * G / 2;
  const shoulderMoment = sides.rightShoulder.clone().sub(hands.rightHand).cross(v(0, -halfForce, 0)).length();
  const elbowMoment = elbows.rightElbow.clone().sub(hands.rightHand).cross(v(0, -halfForce, 0)).length();
  const elbowAngle = angleBetween(sides.rightShoulder, elbows.rightElbow, hands.rightHand);
  const shoulderD = demandFromMoment(shoulderMoment, halfForce, 0.26);
  const elbowD = demandFromMoment(elbowMoment, halfForce, 0.24);
  const gripBias = clamp((gripMult - 1.05) / 1.10, 0, 1);
  const demands = inactiveDemands();
  demands.pecs = clamp(0.80 * shoulderD + 0.12 * gripBias, 0, 1);
  demands.triceps = clamp(0.90 * elbowD + 0.10 * (1 - gripBias), 0, 1);
  demands.frontDelts = clamp(0.62 * shoulderD + 0.16 * (1 - gripBias), 0, 1);

  return {
    movement: 'bench',
    bar,
    barPath: { start: v(0, touchY, touchZ), end: v(0, lockY, lockZ) },
    joints: { hipCenter, shoulderCenter, ...sides, ...ankles, ...knees, ...hands, ...elbows },
    demands,
    metrics: {
      shoulderMoment,
      elbowMoment,
      elbowAngle,
      gripWidth,
      barROM: lockY - touchY,
      barHorizontalShift: Math.abs(lockZ - touchZ),
    },
  };
}

export function solveMovement(m, movement, controls, progress) {
  if (movement === 'highBar' || movement === 'lowBar') return squatPose(m, movement, controls.stanceMult, progress);
  if (movement === 'deadlift') return deadliftPose(m, controls.stanceMult, progress);
  return benchPose(m, controls.gripMult, progress);
}
