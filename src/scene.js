import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function mat(color, roughness = 0.65, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(scene, size, pos, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
}

export class LabScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.85, 0);

    const hemi = new THREE.HemisphereLight(0xd9e8ff, 0x1a2028, 1.65);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(2.5, 4.5, 3.5); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fc8ff, 1.0);
    rim.position.set(-3, 2.5, -3); this.scene.add(rim);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), mat(0x0d1218, 0.92, 0));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const grid = new THREE.GridHelper(8, 32, 0x263341, 0x18222c); grid.position.y = 0.001; this.scene.add(grid);

    this.barGroup = new THREE.Group(); this.scene.add(this.barGroup);
    this.pathGroup = new THREE.Group(); this.scene.add(this.pathGroup);
    this.benchGroup = new THREE.Group(); this.scene.add(this.benchGroup);
    this.makeBar();
    this.makeBench();
    this.resetCamera('highBar');
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  makeBar() {
    this.barGroup.clear();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.2, 20), mat(0xc9d2da, 0.35, 0.7));
    shaft.rotation.z = Math.PI / 2; shaft.castShadow = true; this.barGroup.add(shaft);
    const plateMat = mat(0x303944, 0.6, 0.15);
    for (const x of [-0.76, 0.76]) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.055, 40), plateMat);
      plate.rotation.z = Math.PI / 2; plate.position.x = x; plate.castShadow = true; this.barGroup.add(plate);
    }
  }

  makeBench() {
    const padMat = mat(0x20262e, 0.9, 0);
    const steel = mat(0x65717d, 0.45, 0.45);
    box(this.benchGroup, [0.30, 0.075, 1.22], [0, 0.445, 0], padMat);
    box(this.benchGroup, [0.08, 0.40, 0.10], [0, 0.22, 0.28], steel);
    box(this.benchGroup, [0.72, 0.06, 0.10], [0, 0.05, 0.28], steel);
    for (const x of [-0.48, 0.48]) {
      box(this.benchGroup, [0.055, 1.05, 0.055], [x, 0.53, -0.46], steel);
      box(this.benchGroup, [0.14, 0.045, 0.10], [x, 0.93, -0.40], steel);
    }
    this.benchGroup.visible = false;
  }

  setMovement(movement) {
    this.benchGroup.visible = movement === 'bench';
  }

  updatePose(pose, showPath) {
    this.barGroup.position.copy(pose.bar);
    this.pathGroup.clear();
    if (showPath && pose.barPath) {
      const pts = [pose.barPath.start, pose.barPath.end];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x67b7ff, transparent: true, opacity: 0.95 }));
      this.pathGroup.add(line);
      for (const p of pts) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0x67b7ff }));
        dot.position.copy(p); this.pathGroup.add(dot);
      }
    }
  }

  resetCamera(movement) {
    if (movement === 'bench') {
      this.camera.position.set(2.25, 1.65, 2.1);
      this.controls.target.set(0, 0.48, 0.02);
    } else {
      this.camera.position.set(2.35, 1.55, 3.1);
      this.controls.target.set(0, 0.9, 0);
    }
    this.controls.update();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false);
  }

  render() {
    this.controls.update(); this.renderer.render(this.scene, this.camera);
  }
}

// Allow box() to accept a Group as a scene-like parent.
THREE.Group.prototype.addBox = undefined;
