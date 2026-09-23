import { DEFAULT_MEASUREMENTS, MEASUREMENT_FIELDS, MOVEMENTS } from './config.js';
import { consistencyNote, proportionSummary, sanitizeMeasurements, toMeters } from './anthropometry.js';
import { solveMovement } from './biomechanics.js';
import { AvatarRig } from './avatar.js';
import { LabScene } from './scene.js';

const $ = (sel) => document.querySelector(sel);
const state = {
  measurements: { ...DEFAULT_MEASUREMENTS },
  movement: 'highBar',
  controls: { stanceMult: 1.05, gripMult: 1.65 },
  progress: 0,
  playing: false,
  direction: 1,
  lastTs: performance.now(),
  showBarPath: true,
};

const viewport = $('#viewport');
const lab = new LabScene(viewport);
const avatar = new AvatarRig(lab.scene);

function renderMeasurements() {
  const grid = $('#measurementGrid');
  grid.innerHTML = MEASUREMENT_FIELDS.map((f) => `
    <div class="field">
      <label for="m-${f.key}">${f.label}</label>
      <div class="input-wrap">
        <input id="m-${f.key}" data-key="${f.key}" type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${state.measurements[f.key]}" />
        <span class="unit">${f.unit}</span>
      </div>
    </div>`).join('');
  grid.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
    state.measurements[input.dataset.key] = Number(input.value);
    state.measurements = sanitizeMeasurements(state.measurements);
    $('#measurementNote').textContent = consistencyNote(state.measurements);
    updateAll(true);
  }));
  $('#measurementNote').textContent = consistencyNote(state.measurements);
}

function renderMovementTabs() {
  const tabs = $('#movementTabs');
  tabs.innerHTML = Object.entries(MOVEMENTS).map(([key, cfg]) => `<button type="button" role="tab" class="tab-button ${key === state.movement ? 'active' : ''}" data-movement="${key}">${cfg.label}</button>`).join('');
  tabs.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    state.movement = btn.dataset.movement;
    state.progress = 0;
    state.playing = false;
    $('#playPause').textContent = 'Play';
    $('#scrubber').value = '0';
    renderMovementTabs(); renderMovementControls();
    lab.setMovement(state.movement); lab.resetCamera(state.movement);
    updateAll(false);
  }));
}

function renderMovementControls() {
  const host = $('#movementControls');
  if (state.movement === 'bench') {
    host.innerHTML = `
      <div class="slider-field">
        <div class="slider-heading"><span>Grip width</span><output id="gripOut"></output></div>
        <input id="gripSlider" type="range" min="1.05" max="2.15" step="0.01" value="${state.controls.gripMult}" />
        <div class="range-scale"><span>Narrow</span><span>Wide</span></div>
      </div>`;
    const slider = $('#gripSlider');
    const sync = () => {
      state.controls.gripMult = Number(slider.value);
      $('#gripOut').textContent = `${state.controls.gripMult.toFixed(2)}× shoulders`;
      updateAll(false);
    };
    slider.addEventListener('input', sync); sync();
  } else {
    const isDeadlift = state.movement === 'deadlift';
    host.innerHTML = `
      <div class="slider-field">
        <div class="slider-heading"><span>Stance width</span><output id="stanceOut"></output></div>
        <input id="stanceSlider" type="range" min="0.80" max="2.60" step="0.01" value="${state.controls.stanceMult}" />
        <div class="range-scale"><span>${isDeadlift ? 'Conventional-like' : 'Narrow'}</span><span>${isDeadlift ? 'Sumo-like' : 'Wide'}</span></div>
      </div>`;
    const slider = $('#stanceSlider');
    const sync = () => {
      state.controls.stanceMult = Number(slider.value);
      $('#stanceOut').textContent = `${state.controls.stanceMult.toFixed(2)}× hips`;
      updateAll(false);
    };
    slider.addEventListener('input', sync); sync();
  }
}

function formatNm(v) { return `${Math.round(v)} N·m`; }
function formatCm(m) { return `${(m * 100).toFixed(1)} cm`; }
function formatDeg(v) { return `${v.toFixed(1)}°`; }

function metricsFor(pose) {
  const m = pose.metrics;
  if (state.movement === 'highBar' || state.movement === 'lowBar') return [
    ['Hip ext. moment', formatNm(m.hipMoment), 'external moment proxy'],
    ['Knee ext. moment', formatNm(m.kneeMoment), 'external moment proxy'],
    ['Adduction demand', formatNm(m.adductionProxy), 'frontal-plane proxy'],
    ['Torso lean', formatDeg(m.trunkAngle), 'from vertical'],
    ['Hip vs knee', `${(m.depth * 100).toFixed(1)} cm`, '≤ 0 cm at target depth'],
    ['Stance', formatCm(m.stanceWidth), `${state.controls.stanceMult.toFixed(2)}× hip width`],
    ['Bar deviation', `${(m.barDeviation * 100).toFixed(1)} cm`, 'hard vertical constraint'],
  ];
  if (state.movement === 'deadlift') return [
    ['Hip ext. moment', formatNm(m.hipMoment), 'bar load only'],
    ['Knee ext. moment', formatNm(m.kneeMoment), 'bar load only'],
    ['Trunk demand', formatNm(m.trunkMoment), 'simplified external moment'],
    ['Torso lean', formatDeg(m.trunkAngle), 'from vertical'],
    ['Hip abduction', formatDeg(m.hipAbduction), 'geometry proxy'],
    ['Bar ROM', formatCm(m.barROM), 'floor → lockout'],
    ['Grip relation', m.handsInside ? 'Inside legs' : 'Outside legs', formatCm(m.gripWidth)],
  ];
  return [
    ['Shoulder moment', formatNm(m.shoulderMoment), 'per-side external moment'],
    ['Elbow moment', formatNm(m.elbowMoment), 'per-side external moment'],
    ['Elbow angle', formatDeg(m.elbowAngle), 'current frame'],
    ['Grip width', formatCm(m.gripWidth), `${state.controls.gripMult.toFixed(2)}× shoulders`],
    ['Vertical ROM', formatCm(m.barROM), 'touch → lockout'],
    ['Horizontal shift', formatCm(m.barHorizontalShift), 'touch point → lockout'],
  ];
}

function renderMetrics(pose) {
  $('#metricCards').innerHTML = metricsFor(pose).map(([label, value, sub]) => `<div class="metric-card"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`).join('');
  const summary = proportionSummary(state.measurements);
  const common = `<p><strong>Your proportions:</strong> femur/torso ${summary.femurTorso.toFixed(2)}, femur/tibia ${summary.femurTibia.toFixed(2)}, arm/torso ${summary.armTorso.toFixed(2)}. Those ratios feed the joint geometry rather than acting as labels.</p>`;
  let detail = '';
  if (state.movement === 'deadlift') {
    detail = `<p>Widening stance moves the feet laterally, abducts the femurs, and automatically transitions the grip from outside to inside the legs. Arm length changes shoulder height at a fixed bar height, which moves the hip and changes the hip moment arm.</p>`;
  } else if (state.movement === 'bench') {
    detail = `<p>Grip width and your upper-arm/forearm lengths determine the two-link arm solution. The shoulder and elbow moment readouts are recalculated from those joint positions at every frame.</p>`;
  } else {
    detail = `<p>The bar's fore-aft coordinate is fixed. Your torso length, femur length, tibia length, stance, and bar placement determine how the hips and knees must arrange underneath that vertical line while reaching the depth target.</p>`;
  }
  $('#explanation').innerHTML = common + detail;
}

function updateLabels() {
  const cfg = MOVEMENTS[state.movement];
  $('#movementTitle').textContent = cfg.label;
  $('#movementSubtitle').textContent = cfg.subtitle;
  $('#progressValue').textContent = `${Math.round(state.progress * 100)}%`;
  $('#poseReadout').textContent = state.progress < 0.08 ? (state.movement === 'bench' ? 'Touch position' : 'Bottom / start position') : state.progress > 0.92 ? 'Lockout / standing' : `${Math.round(state.progress * 100)}% through rep`;
}

function updateAll(reapplyMeasurements) {
  const m = toMeters(sanitizeMeasurements(state.measurements));
  if (avatar.ready && reapplyMeasurements) avatar.applyMeasurements(m);
  const pose = solveMovement(m, state.movement, state.controls, state.progress);
  if (avatar.ready) avatar.pose(pose);
  lab.updatePose(pose, state.showBarPath);
  renderMetrics(pose); updateLabels();
}

function bindStaticControls() {
  $('#resetMeasurements').addEventListener('click', () => {
    state.measurements = { ...DEFAULT_MEASUREMENTS };
    renderMeasurements(); updateAll(true);
  });
  $('#playPause').addEventListener('click', () => {
    state.playing = !state.playing;
    $('#playPause').textContent = state.playing ? 'Pause' : 'Play';
  });
  $('#scrubber').addEventListener('input', (e) => {
    state.progress = Number(e.target.value); state.playing = false; $('#playPause').textContent = 'Play'; updateAll(false);
  });
  $('#showBarPath').addEventListener('change', (e) => { state.showBarPath = e.target.checked; updateAll(false); });
  $('#resetCamera').addEventListener('click', () => lab.resetCamera(state.movement));
}

async function init() {
  renderMeasurements(); renderMovementTabs(); renderMovementControls(); bindStaticControls();
  lab.setMovement(state.movement); updateAll(false);
  try {
    await avatar.load();
    avatar.applyMeasurements(toMeters(state.measurements));
    $('#modelStatus').textContent = 'Rigged human model loaded';
    $('#modelStatus').classList.add('ready');
    updateAll(false);
  } catch (err) {
    console.error(err);
    $('#modelStatus').textContent = 'Human model failed to load';
    $('#modelStatus').classList.add('error');
  }

  function frame(ts) {
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000); state.lastTs = ts;
    if (state.playing) {
      state.progress += state.direction * dt * 0.55;
      if (state.progress >= 1) { state.progress = 1; state.direction = -1; }
      if (state.progress <= 0) { state.progress = 0; state.direction = 1; }
      $('#scrubber').value = String(state.progress);
      updateAll(false);
    }
    lab.render(); requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

init();
