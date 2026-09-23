import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_URL } from './config.js';

const TARGET_BONES = [
  'Hips','Spine','Spine1','Spine2','Neck','Head',
  'LeftShoulder','RightShoulder','LeftArm','RightArm','LeftForeArm','RightForeArm','LeftHand','RightHand',
  'LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot'
];

const cleanName = (name) => String(name || '')
  .replace(/^mixamorig\d*[:_]?/i, '')
  .replace(/^CC_Base_/i, '')
  .replace(/[^a-z0-9]/gi, '')
  .toLowerCase();

const canonicalLookup = new Map(TARGET_BONES.map((n) => [cleanName(n), n]));

function findBones(root) {
  const out = new Map();
  root.traverse((node) => {
    if (!node.isBone && !node.name) return;
    const c = canonicalLookup.get(cleanName(node.name));
    if (c && !out.has(c)) out.set(c, node);
  });
  return out;
}

function captureRest(bones) {
  const rest = new Map();
  for (const [name, bone] of bones) {
    rest.set(name, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });
  }
  return rest;
}

function applyAthleticMorphs(root) {
  const desired = {
    bodyMasculine: 0.62,
    bodyMuscular: 0.56,
    chestPectorals: 0.35,
    armsMuscular: 0.42,
    thighsMuscular: 0.44,
    calvesMuscular: 0.32,
    gluteusBigger: 0.20,
    bellyToned: 0.25,
  };
  root.traverse((node) => {
    if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
    for (const [name, weight] of Object.entries(desired)) {
      const idx = node.morphTargetDictionary[name];
      if (idx !== undefined) node.morphTargetInfluences[idx] = weight;
    }
  });
}

function childDistance(parent, child) {
  parent.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  return parent.getWorldPosition(new THREE.Vector3()).distanceTo(child.getWorldPosition(new THREE.Vector3()));
}

function scaleOffset(rest, bones, childName, targetLength, parentName) {
  const child = bones.get(childName);
  const parent = bones.get(parentName);
  if (!child || !parent) return;
  const base = childDistance(parent, child);
  if (base < 1e-5) return;
  const r = targetLength / base;
  const src = rest.get(childName)?.position;
  if (src) child.position.copy(src).multiplyScalar(r);
}

function restoreRest(bones, rest) {
  for (const [name, bone] of bones) {
    const r = rest.get(name);
    if (!r) continue;
    bone.position.copy(r.position);
    bone.quaternion.copy(r.quaternion);
    bone.scale.copy(r.scale);
  }
}

function setLateralOffset(rest, bones, name, targetHalfWidth) {
  const bone = bones.get(name);
  const src = rest.get(name)?.position;
  if (!bone || !src) return;
  const p = src.clone();
  const sign = Math.sign(p.x || (name.startsWith('Left') ? -1 : 1));
  p.x = sign * targetHalfWidth;
  bone.position.copy(p);
}

function aimBoneAtWorld(bone, child, targetWorld) {
  if (!bone || !child) return;
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const parentQuat = new THREE.Quaternion();
  if (bone.parent) bone.parent.getWorldQuaternion(parentQuat); else parentQuat.identity();
  const invParent = parentQuat.clone().invert();
  const boneWorld = bone.getWorldPosition(new THREE.Vector3());
  const desiredWorld = targetWorld.clone().sub(boneWorld).normalize();
  const desiredParent = desiredWorld.applyQuaternion(invParent).normalize();
  const childLocalDir = child.position.clone().normalize();
  if (childLocalDir.lengthSq() < 1e-9) return;
  bone.quaternion.setFromUnitVectors(childLocalDir, desiredParent);
  bone.updateWorldMatrix(true, true);
}

function translateRigToHips(root, hips, target) {
  root.updateMatrixWorld(true);
  const current = hips.getWorldPosition(new THREE.Vector3());
  root.position.add(target.clone().sub(current));
  root.updateMatrixWorld(true);
}

function setTorsoChainTargets(j, bones) {
  const hips = bones.get('Hips');
  const spine = bones.get('Spine');
  const spine1 = bones.get('Spine1');
  const spine2 = bones.get('Spine2');
  const neck = bones.get('Neck');
  if (!hips || !spine || !spine1 || !spine2) return;
  const line = j.shoulderCenter.clone().sub(j.hipCenter);
  const targets = [0.24, 0.52, 0.78, 1.0].map((t) => j.hipCenter.clone().addScaledVector(line, t));
  aimBoneAtWorld(hips, spine, targets[0]);
  aimBoneAtWorld(spine, spine1, targets[1]);
  aimBoneAtWorld(spine1, spine2, targets[2]);
  if (neck) aimBoneAtWorld(spine2, neck, targets[3]);
}

export class AvatarRig {
  constructor(scene) {
    this.scene = scene;
    this.root = null;
    this.bones = null;
    this.rest = null;
    this.ready = false;
    this.lastMeasurements = null;
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);
    this.root = gltf.scene;
    this.root.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        if (node.material) {
          node.material.roughness = Math.max(0.52, node.material.roughness ?? 0.6);
          node.material.metalness = 0;
        }
      }
    });
    this.bones = findBones(this.root);
    this.rest = captureRest(this.bones);
    applyAthleticMorphs(this.root);
    this.scene.add(this.root);
    this.ready = true;
    return this;
  }

  applyMeasurements(m) {
    if (!this.ready) return;
    restoreRest(this.bones, this.rest);
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.setScalar(1);
    this.root.updateMatrixWorld(true);

    scaleOffset(this.rest, this.bones, 'LeftLeg', m.femur, 'LeftUpLeg');
    scaleOffset(this.rest, this.bones, 'RightLeg', m.femur, 'RightUpLeg');
    this.root.updateMatrixWorld(true);
    scaleOffset(this.rest, this.bones, 'LeftFoot', m.tibia, 'LeftLeg');
    scaleOffset(this.rest, this.bones, 'RightFoot', m.tibia, 'RightLeg');
    this.root.updateMatrixWorld(true);
    scaleOffset(this.rest, this.bones, 'LeftForeArm', m.upperArm, 'LeftArm');
    scaleOffset(this.rest, this.bones, 'RightForeArm', m.upperArm, 'RightArm');
    this.root.updateMatrixWorld(true);
    scaleOffset(this.rest, this.bones, 'LeftHand', m.forearm, 'LeftForeArm');
    scaleOffset(this.rest, this.bones, 'RightHand', m.forearm, 'RightForeArm');

    setLateralOffset(this.rest, this.bones, 'LeftUpLeg', m.hipWidth / 2);
    setLateralOffset(this.rest, this.bones, 'RightUpLeg', m.hipWidth / 2);

    const leftShoulder = this.bones.get('LeftShoulder') || this.bones.get('LeftArm');
    const rightShoulder = this.bones.get('RightShoulder') || this.bones.get('RightArm');
    if (leftShoulder && rightShoulder) {
      const lsrc = this.rest.get(this.bones.has('LeftShoulder') ? 'LeftShoulder' : 'LeftArm')?.position;
      const rsrc = this.rest.get(this.bones.has('RightShoulder') ? 'RightShoulder' : 'RightArm')?.position;
      if (lsrc && rsrc) {
        leftShoulder.position.copy(lsrc); rightShoulder.position.copy(rsrc);
        leftShoulder.position.x = -m.shoulderWidth / 2;
        rightShoulder.position.x = m.shoulderWidth / 2;
      }
    }

    // Torso length: distribute a single ratio over the authored spine offsets.
    const torsoBones = ['Spine', 'Spine1', 'Spine2'];
    const spineNodes = torsoBones.map((n) => this.bones.get(n)).filter(Boolean);
    if (spineNodes.length) {
      this.root.updateMatrixWorld(true);
      const hips = this.bones.get('Hips');
      const top = this.bones.get('Neck') || this.bones.get('Spine2');
      const base = hips && top ? childDistance(hips, top) : 0;
      const ratio = base > 1e-5 ? m.torso / base : 1;
      for (const name of torsoBones) {
        const node = this.bones.get(name); const src = this.rest.get(name)?.position;
        if (node && src) node.position.copy(src).multiplyScalar(ratio);
      }
    }
    this.root.updateMatrixWorld(true);
    this.lastMeasurements = m;
  }

  pose(pose) {
    if (!this.ready) return;
    const j = pose.joints;
    const hips = this.bones.get('Hips');
    if (!hips) return;

    // Restore rotations only; keep measurement-adjusted bone offsets.
    for (const [name, bone] of this.bones) {
      const r = this.rest.get(name);
      if (r) bone.quaternion.copy(r.quaternion);
    }
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    translateRigToHips(this.root, hips, j.hipCenter);
    setTorsoChainTargets(j, this.bones);

    const chain = [
      ['LeftUpLeg','LeftLeg', j.leftKnee], ['LeftLeg','LeftFoot', j.leftAnkle],
      ['RightUpLeg','RightLeg', j.rightKnee], ['RightLeg','RightFoot', j.rightAnkle],
    ];
    if (j.leftElbow && j.leftHand) {
      chain.push(['LeftArm','LeftForeArm', j.leftElbow], ['LeftForeArm','LeftHand', j.leftHand]);
      chain.push(['RightArm','RightForeArm', j.rightElbow], ['RightForeArm','RightHand', j.rightHand]);
    } else {
      // Squats: arms simply follow the upper torso rather than pretending to model a specific rack grip yet.
      const forward = j.shoulderCenter.clone().sub(j.hipCenter).normalize();
      const lHand = j.leftShoulder.clone().add(new THREE.Vector3(-0.10, -0.10, 0.12)).addScaledVector(forward, 0.10);
      const rHand = j.rightShoulder.clone().add(new THREE.Vector3(0.10, -0.10, 0.12)).addScaledVector(forward, 0.10);
      const lElbow = j.leftShoulder.clone().lerp(lHand, 0.48).add(new THREE.Vector3(-0.07, -0.05, 0));
      const rElbow = j.rightShoulder.clone().lerp(rHand, 0.48).add(new THREE.Vector3(0.07, -0.05, 0));
      chain.push(['LeftArm','LeftForeArm', lElbow], ['LeftForeArm','LeftHand', lHand]);
      chain.push(['RightArm','RightForeArm', rElbow], ['RightForeArm','RightHand', rHand]);
    }

    for (const [boneName, childName, target] of chain) {
      aimBoneAtWorld(this.bones.get(boneName), this.bones.get(childName), target);
    }
    this.root.updateMatrixWorld(true);
  }
}
