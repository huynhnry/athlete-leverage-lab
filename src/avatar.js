import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_URL } from './config.js';

// CC0 Quaternius "Superhero Male" rig.
// We map the source names into the canonical names used by the app so the
// biomechanics layer stays independent of whichever visual mesh we use.
const SOURCE_BONES = Object.freeze({
  Hips: 'pelvis',
  Spine: 'spine_01',
  Spine1: 'spine_02',
  Spine2: 'spine_03',
  Neck: 'neck_01',
  Head: 'Head',

  LeftShoulder: 'clavicle_l',
  LeftArm: 'upperarm_l',
  LeftForeArm: 'lowerarm_l',
  LeftHand: 'hand_l',

  RightShoulder: 'clavicle_r',
  RightArm: 'upperarm_r',
  RightForeArm: 'lowerarm_r',
  RightHand: 'hand_r',

  LeftUpLeg: 'thigh_l',
  LeftLeg: 'calf_l',
  LeftFoot: 'foot_l',

  RightUpLeg: 'thigh_r',
  RightLeg: 'calf_r',
  RightFoot: 'foot_r',
});

const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();

const MUSCLE = Object.freeze({
  none: 0,
  quads: 1,
  glutes: 2,
  hamstrings: 3,
  adductors: 4,
  erectors: 5,
  pecs: 6,
  triceps: 7,
  frontDelts: 8,
});

const MUSCLE_NAME = Object.freeze([
  null, 'quads', 'glutes', 'hamstrings', 'adductors',
  'erectors', 'pecs', 'triceps', 'frontDelts',
]);

const BASE_COLOR = new THREE.Color(0x667789);
const HEAT_GREEN = new THREE.Color(0x35c76f);
const HEAT_YELLOW = new THREE.Color(0xf4d35e);
const HEAT_RED = new THREE.Color(0xff4d4f);

function demandColor(value, target = new THREE.Color()) {
  const x = THREE.MathUtils.clamp(value ?? 0, 0, 1);
  if (x <= 0.5) return target.copy(HEAT_GREEN).lerp(HEAT_YELLOW, x * 2);
  return target.copy(HEAT_YELLOW).lerp(HEAT_RED, (x - 0.5) * 2);
}

function findBones(root) {
  const bySource = new Map();
  root.traverse((node) => {
    if (node.isBone && node.name) bySource.set(node.name, node);
  });

  const out = new Map();
  for (const [canonical, source] of Object.entries(SOURCE_BONES)) {
    const bone = bySource.get(source);
    if (!bone) throw new Error(`Model is missing required bone: ${source}`);
    out.set(canonical, bone);
  }
  return out;
}

function captureRest(root, bones) {
  root.updateMatrixWorld(true);
  const local = new Map();
  const worldQ = new Map();

  for (const [name, bone] of bones) {
    local.set(name, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });
    worldQ.set(name, bone.getWorldQuaternion(Q()));
  }
  return { local, worldQ };
}

function restoreLocal(bones, rest) {
  for (const [name, bone] of bones) {
    const r = rest.local.get(name);
    if (!r) continue;
    bone.position.copy(r.position);
    bone.quaternion.copy(r.quaternion);
    bone.scale.copy(r.scale);
  }
}

function worldPosition(bone) {
  return bone.getWorldPosition(V());
}

function rotateToward(bone, child, targetWorld) {
  if (!bone || !child || !targetWorld) return;

  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);

  const origin = worldPosition(bone);
  const from = worldPosition(child).sub(origin);
  const to = targetWorld.clone().sub(origin);
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;

  from.normalize();
  to.normalize();

  // Robust world-space solve: rotate the CURRENT child direction onto the
  // desired direction, then convert that world orientation back to bone-local.
  // This avoids assumptions about bone axes/rest quaternions.
  const delta = Q().setFromUnitVectors(from, to);
  const world = bone.getWorldQuaternion(Q()).premultiply(delta);
  const parentWorld = bone.parent
    ? bone.parent.getWorldQuaternion(Q())
    : Q().identity();

  bone.quaternion.copy(parentWorld.invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}

function setBoneWorldPosition(bone, targetWorld) {
  if (!bone?.parent) return;
  bone.parent.updateWorldMatrix(true, false);
  const local = bone.parent.worldToLocal(targetWorld.clone());
  bone.position.copy(local);
  bone.updateWorldMatrix(false, true);
}

function moveBoneByWorldDelta(bone, deltaWorld) {
  if (!bone?.parent) return;
  bone.parent.updateWorldMatrix(true, false);
  const parentQ = bone.parent.getWorldQuaternion(Q());
  const localDelta = deltaWorld.clone().applyQuaternion(parentQ.invert());
  bone.position.add(localDelta);
  bone.updateWorldMatrix(false, true);
}

function scaleLink(root, bones, childName, parentName, targetLength) {
  const child = bones.get(childName);
  const parent = bones.get(parentName);
  if (!child || !parent) return;

  root.updateMatrixWorld(true);
  const current = worldPosition(parent).distanceTo(worldPosition(child));
  if (current < 1e-6) return;

  child.position.multiplyScalar(targetLength / current);
  root.updateMatrixWorld(true);
}

function setHipWidth(root, bones, width) {
  root.updateMatrixWorld(true);

  // Source rig convention: anatomical Left is +X, Right is -X.
  for (const [name, sign] of [['LeftUpLeg', 1], ['RightUpLeg', -1]]) {
    const bone = bones.get(name);
    const p = worldPosition(bone);
    moveBoneByWorldDelta(bone, new THREE.Vector3(sign * width / 2 - p.x, 0, 0));
  }
  root.updateMatrixWorld(true);
}

function setShoulderWidth(root, bones, width) {
  root.updateMatrixWorld(true);

  // Move the clavicles so the humeral heads land at the requested biacromial
  // width. This changes the whole arm location without scaling the humerus.
  const pairs = [
    ['LeftShoulder', 'LeftArm', 1],
    ['RightShoulder', 'RightArm', -1],
  ];

  for (const [clavicleName, armName, sign] of pairs) {
    const clavicle = bones.get(clavicleName);
    const arm = bones.get(armName);
    if (!clavicle || !arm) continue;
    const p = worldPosition(arm);
    moveBoneByWorldDelta(clavicle, new THREE.Vector3(sign * width / 2 - p.x, 0, 0));
  }
  root.updateMatrixWorld(true);
}

function setTorsoLength(root, bones, targetLength) {
  const hips = bones.get('Hips');
  const neck = bones.get('Neck');
  if (!hips || !neck) return;

  root.updateMatrixWorld(true);
  const current = worldPosition(hips).distanceTo(worldPosition(neck));
  if (current < 1e-6) return;

  const ratio = targetLength / current;
  for (const name of ['Spine', 'Spine1', 'Spine2', 'Neck']) {
    const bone = bones.get(name);
    if (bone) bone.position.multiplyScalar(ratio);
  }
  root.updateMatrixWorld(true);
}

function translateRigToHips(root, hips, target) {
  root.updateMatrixWorld(true);
  const current = worldPosition(hips);
  root.position.add(target.clone().sub(current));
  root.updateMatrixWorld(true);
}

function placeTorso(pose, bones) {
  const j = pose.joints;
  const hips = bones.get('Hips');
  const spine = bones.get('Spine');
  const spine1 = bones.get('Spine1');
  const spine2 = bones.get('Spine2');
  const neck = bones.get('Neck');

  if (!hips || !spine || !spine1 || !spine2 || !neck) return;

  // Keep the pelvis level so moving the torso never drags both femurs with it.
  // The first spine joint is translated along the desired torso line; the
  // remaining segments rotate toward successive points on that same line.
  const line = j.shoulderCenter.clone().sub(j.hipCenter);
  const p1 = j.hipCenter.clone().addScaledVector(line, 0.22);
  const p2 = j.hipCenter.clone().addScaledVector(line, 0.50);
  const p3 = j.hipCenter.clone().addScaledVector(line, 0.78);
  const p4 = j.shoulderCenter.clone();

  setBoneWorldPosition(spine, p1);
  rotateToward(spine, spine1, p2);
  rotateToward(spine1, spine2, p3);
  rotateToward(spine2, neck, p4);
}

function restoreWorldOrientation(bone, desiredWorldQ) {
  if (!bone || !desiredWorldQ) return;
  const parentWorld = bone.parent
    ? bone.parent.getWorldQuaternion(Q())
    : Q().identity();
  bone.quaternion.copy(parentWorld.invert().multiply(desiredWorldQ));
  bone.updateWorldMatrix(false, true);
}

function alignChildRoot(parentBone, childBone, targetWorld) {
  if (!parentBone || !childBone || !targetWorld) return;
  parentBone.updateWorldMatrix(true, true);
  const current = worldPosition(childBone);
  moveBoneByWorldDelta(parentBone, targetWorld.clone().sub(current));
}

function classifyMuscleVertex(mesh, vertexIndex, position, skinIndex, skinWeight) {
  if (!mesh.isSkinnedMesh || !mesh.skeleton || !skinIndex || !skinWeight) return MUSCLE.none;

  let slot = 0;
  let best = -1;
  const read = (attr, index, component) => {
    if (component === 0) return attr.getX(index);
    if (component === 1) return attr.getY(index);
    if (component === 2) return attr.getZ(index);
    return attr.getW(index);
  };

  for (let k = 0; k < 4; k++) {
    const w = read(skinWeight, vertexIndex, k);
    if (w > best) { best = w; slot = k; }
  }

  const boneIndex = read(skinIndex, vertexIndex, slot);
  const bone = mesh.skeleton.bones[boneIndex];
  if (!bone) return MUSCLE.none;

  const name = bone.name;
  const local = V().fromBufferAttribute(position, vertexIndex);
  const p = mesh.localToWorld(local.clone());
  const b = worldPosition(bone);
  const dz = p.z - b.z;
  const dy = p.y - b.y;
  const dx = p.x - b.x;

  if (name === 'thigh_l' || name === 'thigh_r') {
    const left = name.endsWith('_l');
    const inner = left ? dx < -0.018 : dx > 0.018;
    const proximal = dy > -0.12;
    if (inner && proximal) return MUSCLE.adductors;
    return dz >= -0.004 ? MUSCLE.quads : MUSCLE.hamstrings;
  }

  if (name === 'pelvis') {
    if (dz < -0.015 && dy < 0.08) return MUSCLE.glutes;
    return MUSCLE.none;
  }

  if (name === 'spine_01' || name === 'spine_02' || name === 'spine_03') {
    if (dz < -0.012) return MUSCLE.erectors;
    if ((name === 'spine_02' || name === 'spine_03') && dz > 0.010) return MUSCLE.pecs;
    return MUSCLE.none;
  }

  if (name === 'upperarm_l' || name === 'upperarm_r') {
    const shoulder = bone;
    const distance = p.distanceTo(worldPosition(shoulder));
    if (distance < 0.12 && dz > -0.005) return MUSCLE.frontDelts;
    if (dz < -0.005) return MUSCLE.triceps;
  }

  return MUSCLE.none;
}

function prepareHeatmap(root) {
  const heatMeshes = [];
  root.updateMatrixWorld(true);

  root.traverse((node) => {
    if (!node.isSkinnedMesh || !node.geometry) return;

    const geometry = node.geometry;
    const position = geometry.getAttribute('position');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) return;

    const groups = new Uint8Array(position.count);
    const colors = new Float32Array(position.count * 3);

    for (let i = 0; i < position.count; i++) {
      groups[i] = classifyMuscleVertex(node, i, position, skinIndex, skinWeight);
      colors[i * 3] = BASE_COLOR.r;
      colors[i * 3 + 1] = BASE_COLOR.g;
      colors[i * 3 + 2] = BASE_COLOR.b;
    }

    const attr = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', attr);

    node.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.02,
    });

    heatMeshes.push({ mesh: node, groups, colors: attr });
  });

  return heatMeshes;
}

export class AvatarRig {
  constructor(scene) {
    this.scene = scene;
    this.root = null;
    this.bones = null;
    this.rest = null;
    this.measurementPose = null;
    this.ready = false;
    this.lastMeasurements = null;
    this.heatMeshes = [];
    this.heatmapEnabled = true;
    this.lastDemands = null;
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);

    this.root = gltf.scene;
    this.root.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
    });

    this.bones = findBones(this.root);
    this.rest = captureRest(this.root, this.bones);
    this.scene.add(this.root);
    this.heatMeshes = prepareHeatmap(this.root);
    this.ready = true;
    return this;
  }

  applyMeasurements(m) {
    if (!this.ready) return;

    restoreLocal(this.bones, this.rest);
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.scale.setScalar(1);
    this.root.updateMatrixWorld(true);

    setTorsoLength(this.root, this.bones, m.torso);
    setHipWidth(this.root, this.bones, m.hipWidth);
    setShoulderWidth(this.root, this.bones, m.shoulderWidth);

    scaleLink(this.root, this.bones, 'LeftLeg', 'LeftUpLeg', m.femur);
    scaleLink(this.root, this.bones, 'RightLeg', 'RightUpLeg', m.femur);
    scaleLink(this.root, this.bones, 'LeftFoot', 'LeftLeg', m.tibia);
    scaleLink(this.root, this.bones, 'RightFoot', 'RightLeg', m.tibia);

    scaleLink(this.root, this.bones, 'LeftForeArm', 'LeftArm', m.upperArm);
    scaleLink(this.root, this.bones, 'RightForeArm', 'RightArm', m.upperArm);
    scaleLink(this.root, this.bones, 'LeftHand', 'LeftForeArm', m.forearm);
    scaleLink(this.root, this.bones, 'RightHand', 'RightForeArm', m.forearm);

    this.root.updateMatrixWorld(true);

    // Capture the measurement-adjusted neutral locals. Every animation frame
    // resets to THIS state, not to the original asset proportions.
    this.measurementPose = captureRest(this.root, this.bones);
    this.lastMeasurements = m;
  }

  resetFrame() {
    if (!this.measurementPose) return;
    restoreLocal(this.bones, this.measurementPose);
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.updateMatrixWorld(true);
  }

  pose(pose) {
    if (!this.ready || !this.measurementPose) return;

    const j = pose.joints;
    const hips = this.bones.get('Hips');

    this.resetFrame();
    translateRigToHips(this.root, hips, j.hipCenter);
    placeTorso(pose, this.bones);

    // Make the rig's actual joint origins match the analytic skeleton before
    // solving segment rotations. Without this, an elbow/hand target can be
    // mathematically valid but unreachable from the mesh's shoulder location.
    setBoneWorldPosition(this.bones.get('LeftUpLeg'), j.rightHip);
    setBoneWorldPosition(this.bones.get('RightUpLeg'), j.leftHip);

    alignChildRoot(this.bones.get('LeftShoulder'), this.bones.get('LeftArm'), j.rightShoulder);
    alignChildRoot(this.bones.get('RightShoulder'), this.bones.get('RightArm'), j.leftShoulder);
    this.root.updateMatrixWorld(true);

    // Source rig uses anatomical Left=+X and Right=-X. Our solver names
    // world -X "left" and world +X "right", so map them explicitly.
    const legTargets = [
      ['LeftUpLeg', 'LeftLeg', j.rightKnee],
      ['LeftLeg', 'LeftFoot', j.rightAnkle],
      ['RightUpLeg', 'RightLeg', j.leftKnee],
      ['RightLeg', 'RightFoot', j.leftAnkle],
    ];

    for (const [boneName, childName, target] of legTargets) {
      rotateToward(this.bones.get(boneName), this.bones.get(childName), target);
    }

    // Keep feet flat/neutral instead of inheriting the full calf rotation.
    restoreWorldOrientation(
      this.bones.get('LeftFoot'),
      this.measurementPose.worldQ.get('LeftFoot'),
    );
    restoreWorldOrientation(
      this.bones.get('RightFoot'),
      this.measurementPose.worldQ.get('RightFoot'),
    );

    // All movements now supply exact two-link arm targets from the
    // biomechanics solver. No visual-only arm pose is allowed here.
    const rigLeftElbow = j.rightElbow;
    const rigLeftHand = j.rightHand;
    const rigRightElbow = j.leftElbow;
    const rigRightHand = j.leftHand;

    const armTargets = [
      ['LeftArm', 'LeftForeArm', rigLeftElbow],
      ['LeftForeArm', 'LeftHand', rigLeftHand],
      ['RightArm', 'RightForeArm', rigRightElbow],
      ['RightForeArm', 'RightHand', rigRightHand],
    ];

    for (const [boneName, childName, target] of armTargets) {
      rotateToward(this.bones.get(boneName), this.bones.get(childName), target);
    }

    this.root.updateMatrixWorld(true);
    this.updateMuscleDemand(pose.demands);
  }

  setHeatmapEnabled(enabled) {
    this.heatmapEnabled = Boolean(enabled);
    this.updateMuscleDemand(this.lastDemands);
  }

  updateMuscleDemand(demands) {
    this.lastDemands = demands || this.lastDemands || {};
    const temp = new THREE.Color();

    for (const entry of this.heatMeshes) {
      const array = entry.colors.array;
      for (let i = 0; i < entry.groups.length; i++) {
        const group = entry.groups[i];
        let color = BASE_COLOR;

        if (this.heatmapEnabled && group !== MUSCLE.none) {
          const key = MUSCLE_NAME[group];
          color = demandColor(this.lastDemands[key] ?? 0.035, temp);
        }

        const o = i * 3;
        array[o] = color.r;
        array[o + 1] = color.g;
        array[o + 2] = color.b;
      }
      entry.colors.needsUpdate = true;
    }
  }
}
