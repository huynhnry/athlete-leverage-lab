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

export class AvatarRig {
  constructor(scene) {
    this.scene = scene;
    this.root = null;
    this.bones = null;
    this.rest = null;
    this.measurementPose = null;
    this.ready = false;
    this.lastMeasurements = null;
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

      // Keep this as a clean biomechanics mannequin. The source is already an
      // athletic male mesh; one matte material keeps attention on movement.
      node.material = new THREE.MeshStandardMaterial({
        color: 0x667789,
        roughness: 0.72,
        metalness: 0.02,
      });
    });

    this.bones = findBones(this.root);
    this.rest = captureRest(this.root, this.bones);
    this.scene.add(this.root);
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

    let rigLeftElbow;
    let rigRightElbow;
    let rigLeftHand;
    let rigRightHand;

    if (j.leftElbow && j.leftHand) {
      // Bench/deadlift already provide solved elbow + hand targets.
      rigLeftElbow = j.rightElbow;
      rigLeftHand = j.rightHand;
      rigRightElbow = j.leftElbow;
      rigRightHand = j.leftHand;
    } else {
      // Squat rack position: hands are constrained to the bar shaft.
      const shoulderWidth = this.lastMeasurements?.shoulderWidth || 0.46;
      const gripWidth = Math.max(0.72, shoulderWidth * 1.65);

      rigLeftHand = pose.bar.clone().add(new THREE.Vector3(gripWidth / 2, 0, 0));
      rigRightHand = pose.bar.clone().add(new THREE.Vector3(-gripWidth / 2, 0, 0));

      const rigLeftShoulder = j.rightShoulder;
      const rigRightShoulder = j.leftShoulder;

      rigLeftElbow = rigLeftShoulder
        .clone()
        .lerp(rigLeftHand, 0.55)
        .add(new THREE.Vector3(0.07, -0.10, 0.10));

      rigRightElbow = rigRightShoulder
        .clone()
        .lerp(rigRightHand, 0.55)
        .add(new THREE.Vector3(-0.07, -0.10, 0.10));
    }

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
  }
}
