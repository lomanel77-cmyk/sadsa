import * as THREE from 'three';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const rand = THREE.MathUtils.randFloat;

const ui = {
  game: $('#game'), hud: $('#hud'), controls: $('#officeControls'), threatPanel: $('#threatPanel'),
  clock: $('#clock'), nightLabel: $('#nightLabel'), power: $('#power'), systemStatus: $('#systemStatus'),
  usage: $$('#usage i'), threatText: $('#threatText'), threatFill: $('#threatFill'),
  leftDoor: $('#leftDoor'), rightDoor: $('#rightDoor'), leftLight: $('#leftLight'), rightLight: $('#rightLight'), ventSeal: $('#ventSeal'),
  monitorButton: $('#monitorButton'), closeMonitor: $('#closeMonitor'), monitor: $('#monitor'),
  cameraName: $('#cameraName'), cameraMeta: $('#cameraMeta'), cameraNoise: $('#cameraNoise'), signalLoss: $('#signalLoss'),
  motionWarning: $('#motionWarning'), cameraButtons: $$('#cameraMap button[data-cam]'), recordTimer: $('#recordTimer'),
  startScreen: $('#startScreen'), loadingScreen: $('#loadingScreen'), loadingText: $('#loadingText'), pauseScreen: $('#pauseScreen'),
  endScreen: $('#endScreen'), endEyebrow: $('#endEyebrow'), endTitle: $('#endTitle'), endText: $('#endText'), endStats: $('#endStats'),
  jumpscare: $('#jumpscare'), toast: $('#toast'), fatalError: $('#fatalError'), difficulty: $('#difficulty'), quality: $('#quality')
};

const DIFFICULTY = {
  training: { label: 'VÝCVIK', nightLength: 240, aggression: .72, drain: .82, outageDelay: 7.5 },
  standard: { label: 'STANDARD', nightLength: 210, aggression: 1, drain: 1, outageDelay: 5.8 },
  nightmare: { label: 'NOČNÍ MŮRA', nightLength: 175, aggression: 1.38, drain: 1.12, outageDelay: 4.4 }
};

const state = {
  running: false, paused: false, monitor: false, gameOver: false, powerOut: false,
  cam: 0, power: 100, elapsed: 0, yaw: 0, targetYaw: 0, pitch: -.035,
  leftDoor: false, rightDoor: false, leftLight: false, rightLight: false, ventSeal: false,
  difficulty: DIFFICULTY.standard, usage: 1, signal: 96, signalBlackout: 0, glitch: 0,
  pointerLocked: false, moves: 0, doorUses: 0, cameraUses: 0, maxThreat: 0, lastHour: -1,
  outageTimer: 0, sessionStart: 0, toastTimer: 0, touchX: null, quality: 'auto'
};

let renderer, scene, camera, world, office, clock;
let officeLight, emergencyLight, leftHallLight, rightHallLight, ventLight;
let leftDoorMesh, rightDoorMesh, ventShutter, fanRotor;
let audio;
const animatedLights = [];
const tempV = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

function showFatalError(error) {
  console.error(error);
  ui.fatalError.classList.remove('hidden');
  ui.loadingScreen.classList.remove('visible');
}

window.addEventListener('error', (event) => {
  if (!renderer) showFatalError(event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => showFatalError(event.reason));

function createCanvasTexture(draw, width = 512, height = 512, repeat = [1, 1]) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 4;
  return texture;
}

function makeConcreteTexture() {
  return createCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#3a403e'; ctx.fillRect(0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = Math.random() * 34 - 17;
      image.data[i] = clamp(image.data[i] + n, 0, 255);
      image.data[i + 1] = clamp(image.data[i + 1] + n, 0, 255);
      image.data[i + 2] = clamp(image.data[i + 2] + n, 0, 255);
    }
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = 'rgba(10,15,14,.22)'; ctx.lineWidth = 3;
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      const x = Math.random() * w, y = Math.random() * h;
      ctx.moveTo(x, y); ctx.lineTo(x + rand(-50, 50), y + rand(10, 100)); ctx.stroke();
    }
  }, 512, 512, [3, 3]);
}

function makeFloorTexture() {
  return createCanvasTexture((ctx, w, h) => {
    const size = 64;
    for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
      const odd = ((x / size) + (y / size)) % 2;
      ctx.fillStyle = odd ? '#252a29' : '#151a19'; ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = 'rgba(110,130,122,.14)'; ctx.strokeRect(x, y, size, size);
    }
    for (let i = 0; i < 130; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * .12})`;
      ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, rand(2, 18), 0, Math.PI * 2); ctx.fill();
    }
  }, 512, 512, [5, 5]);
}

function makeMetalTexture() {
  return createCanvasTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#2b3232'); grad.addColorStop(.5, '#4b5553'); grad.addColorStop(1, '#252b2b');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 5) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * .025})`; ctx.fillRect(0, y, w, 1); }
    for (let i = 0; i < 30; i++) { ctx.fillStyle = 'rgba(92,47,25,.15)'; ctx.fillRect(Math.random() * w, Math.random() * h, rand(2, 9), rand(10, 50)); }
  }, 512, 512, [2, 2]);
}

function makePosterTexture(title, subtitle, accent = '#9fffc4', symbol = '◈') {
  return createCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#101817'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent; ctx.lineWidth = 8; ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.fillStyle = accent; ctx.font = 'bold 132px monospace'; ctx.textAlign = 'center'; ctx.fillText(symbol, w / 2, 170);
    ctx.fillStyle = '#dbe7e2'; ctx.font = 'bold 42px monospace'; ctx.fillText(title, w / 2, 260);
    ctx.fillStyle = '#7f918a'; ctx.font = '22px monospace';
    const words = subtitle.split(' '); let line = '', y = 315;
    words.forEach((word) => { const test = `${line}${word} `; if (ctx.measureText(test).width > w - 80) { ctx.fillText(line, w / 2, y); line = `${word} `; y += 30; } else line = test; });
    ctx.fillText(line, w / 2, y);
    ctx.fillStyle = accent; ctx.fillRect(55, h - 72, w - 110, 4);
    ctx.fillStyle = '#52635d'; ctx.font = '16px monospace'; ctx.fillText('NULL STATION // SAFETY DIRECTIVE', w / 2, h - 40);
  }, 512, 640);
}

function makeScreenTexture(text = 'SYSTEM ONLINE') {
  return createCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#03100d'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120,255,196,.08)';
    for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 1);
    ctx.strokeStyle = '#295d4c'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#8dffc1'; ctx.font = 'bold 26px monospace'; ctx.fillText(text, 28, 48);
    ctx.fillStyle = '#3b8069'; ctx.font = '15px monospace';
    ['CORE TEMP  31.8 C', 'CAM NET    STABLE', 'POWER BUS  ARMED', 'SECTOR B1  SEALED'].forEach((line, i) => ctx.fillText(line, 28, 86 + i * 26));
    ctx.fillStyle = '#8dffc1'; ctx.fillRect(28, 205, 140, 6);
  }, 360, 240);
}

function material(color, roughness = .8, metalness = .08, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...options });
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = scene) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cylinder(r, h, mat, x = 0, y = 0, z = 0, parent = scene, segments = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function sphere(r, mat, x = 0, y = 0, z = 0, parent = scene, segments = 18) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, segments, Math.max(8, segments / 2)), mat);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function plane(w, h, mat, x, y, z, parent = scene) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); mesh.position.set(x, y, z); mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function pipePath(points, radius, mat, parent = scene) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 8, false), mat);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function addPointLamp(x, y, z, intensity = 1, color = 0xc7e3d7, distance = 10, flicker = 0) {
  const light = new THREE.PointLight(color, intensity, distance, 2);
  light.position.set(x, y, z); light.castShadow = true; light.shadow.mapSize.set(512, 512); light.shadow.bias = -.001; scene.add(light);
  box(.55, .08, .28, material(0x57625f, .4, .6), x, y + .05, z);
  const glow = box(.45, .035, .18, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85 }), x, y - .005, z);
  if (flicker) animatedLights.push({ light, base: intensity, speed: flicker, phase: Math.random() * 10, glow });
  return light;
}

function addCeilingStrip(x, z, width = 2.4, intensity = 1.1, color = 0xc6ddd3, flicker = .15) {
  box(width, .09, .55, material(0x242c2a, .5, .6), x, 4.62, z);
  box(width * .88, .025, .4, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .72 }), x, 4.565, z);
  const light = new THREE.PointLight(color, intensity, 8, 2); light.position.set(x, 4.25, z); scene.add(light);
  animatedLights.push({ light, base: intensity, speed: flicker, phase: Math.random() * 10 });
  return light;
}

function addWallPanel(x, y, z, rotationY = 0) {
  const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = rotationY; scene.add(group);
  box(1.15, 1.55, .13, material(0x202827, .55, .55), 0, 0, 0, group);
  box(.86, .42, .04, material(0x07100e, .5, .15, { emissive: 0x123b2f, emissiveIntensity: .6 }), 0, .38, .09, group);
  for (let i = 0; i < 3; i++) {
    const c = i === 0 ? 0x89ffc0 : i === 1 ? 0xffd465 : 0xff5c51;
    sphere(.055, new THREE.MeshBasicMaterial({ color: c }), -.3 + i * .3, -.23, .1, group, 10);
  }
  for (let i = 0; i < 4; i++) box(.1, .22, .04, material(0x4e5d58, .55, .45), -.33 + i * .22, -.57, .1, group);
}

function addCrate(x, y, z, scale = 1, parent = scene) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(scale); parent.add(g);
  const crateMat = material(0x454c49, .72, .4);
  box(1.5, 1.1, 1.3, crateMat, 0, .55, 0, g);
  for (const sy of [-.48, .48]) box(1.55, .11, 1.36, material(0x252d2b, .6, .7), 0, .55 + sy, 0, g);
  for (const sx of [-.68, .68]) box(.12, 1.16, 1.36, material(0x252d2b, .6, .7), sx, .55, 0, g);
  plane(.66, .34, new THREE.MeshBasicMaterial({ map: makePosterTexture('B1', 'SERVICE PARTS', '#ffd66b', '⚠'), side: THREE.DoubleSide }), 0, .62, .656, g);
  return g;
}

function addCableBundle(points, colors = [0x1f2423, 0x47241c, 0x162a2b]) {
  colors.forEach((color, i) => {
    const offset = (i - 1) * .05;
    pipePath(points.map(([x, y, z]) => [x + offset, y, z + offset]), .025, material(color, .6, .25));
  });
}

function buildOffice(mats) {
  office = new THREE.Group(); scene.add(office);
  box(12.4, .35, 10.5, mats.floor, 0, -.18, 2, office);
  box(12.4, 5.1, .35, mats.wall, 0, 2.35, -3.1, office);
  box(.35, 5.1, 10.5, mats.wall, -6.05, 2.35, 2, office);
  box(.35, 5.1, 10.5, mats.wall, 6.05, 2.35, 2, office);
  box(12.4, .25, 10.5, mats.ceiling, 0, 4.92, 2, office);

  for (const side of [-1, 1]) {
    const x = side * 4.35;
    box(.28, 4.65, .5, mats.darkMetal, x - 1.18, 2.15, -2.84, office);
    box(.28, 4.65, .5, mats.darkMetal, x + 1.18, 2.15, -2.84, office);
    box(2.65, .3, .5, mats.darkMetal, x, 4.34, -2.84, office);
    for (let i = 0; i < 6; i++) {
      const stripe = box(.34, .17, .03, i % 2 ? mats.hazardDark : mats.hazard, x - 1.02 + i * .41, 4.05, -2.55, office);
      stripe.rotation.z = -.45;
    }
  }

  box(7.4, .26, 2.25, mats.desk, 0, 1.02, 2.1, office);
  box(.32, 1.3, 2.05, mats.darkMetal, -2.85, .42, 2.1, office);
  box(.32, 1.3, 2.05, mats.darkMetal, 2.85, .42, 2.1, office);
  box(2.1, .14, .58, mats.darkMetal, 0, 1.32, 1.7, office);
  box(2.5, 1.3, .17, mats.monitorShell, 0, 1.88, 1.64, office);
  plane(2.15, .98, new THREE.MeshBasicMaterial({ map: makeScreenTexture(), toneMapped: false }), 0, 1.9, 1.54, office);
  box(.65, .08, .38, mats.darkMetal, 0, 1.14, 1.87, office);

  for (const [x, rot] of [[-1.75, .12], [1.72, -.15]]) {
    const g = new THREE.Group(); g.position.set(x, 1.48, 1.72); g.rotation.y = rot; office.add(g);
    box(1.25, .78, .13, mats.monitorShell, 0, .3, 0, g);
    plane(1.05, .58, new THREE.MeshBasicMaterial({ map: makeScreenTexture(x < 0 ? 'CAM NET' : 'POWER BUS'), toneMapped: false }), 0, .31, -.071, g);
    box(.09, .48, .3, mats.darkMetal, 0, -.22, .04, g);
  }

  box(1.05, .07, .42, mats.darkMetal, -.35, 1.2, 2.25, office).rotation.x = -.07;
  for (let i = 0; i < 10; i++) box(.07, .025, .05, mats.key, -.72 + i * .085, 1.245, 2.1 + (i % 2) * .08, office);
  box(.72, .45, .45, mats.darkMetal, 2.25, 1.36, 2.0, office);
  for (let i = 0; i < 4; i++) box(.06, .17, .03, new THREE.MeshBasicMaterial({ color: i === 0 ? 0x8dffc1 : 0xffd66b }), 2.02 + i * .14, 1.38, 1.765, office);
  cylinder(.21, .43, material(0x6b3d26, .75, .12), -2.25, 1.27, 2.12, office, 20);
  cylinder(.16, .03, material(0x22140f), -2.25, 1.5, 2.12, office, 20);
  for (let i = 0; i < 4; i++) { const paper = box(.72, .012, .5, material(0xa8a68f, 1), .9 + i * .035, 1.18 + i * .012, 2.3 - i * .018, office); paper.rotation.y = .15 - i * .04; }

  const fan = new THREE.Group(); fan.position.set(-1.35, 1.7, 1.55); office.add(fan);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(.62, .025, 8, 32), mats.darkMetal); cage.rotation.x = Math.PI / 2; cage.castShadow = true; fan.add(cage);
  fanRotor = new THREE.Group(); fan.add(fanRotor);
  for (let i = 0; i < 5; i++) {
    const blade = box(.7, .045, .18, mats.fan, .31, 0, 0, fanRotor); blade.rotation.z = i * Math.PI * 2 / 5; blade.rotation.y = .12;
  }
  cylinder(.12, .28, mats.darkMetal, 0, 0, 0, fanRotor, 16).rotation.x = Math.PI / 2;
  box(.12, .65, .15, mats.darkMetal, 0, -.58, .14, fan);
  box(.75, .08, .35, mats.darkMetal, 0, -.9, .16, fan);

  const posters = [
    ['STAY ALERT', 'Report all autonomous movement after lockout.', '#ffcf65', '⚠'],
    ['SECTOR B1', 'Authorized maintenance personnel only.', '#8dffc1', 'B1'],
    ['NO SIGNAL', 'Do not enter during network isolation.', '#ff665d', '×']
  ];
  posters.forEach((p, i) => {
    const tex = makePosterTexture(...p);
    const poster = plane(1.25, 1.58, new THREE.MeshStandardMaterial({ map: tex, roughness: .88, metalness: 0 }), -2.45 + i * 2.45, 2.66, -2.91, office);
    poster.rotation.y = 0; poster.rotation.z = (i - 1) * .025;
  });

  pipePath([[-5.75,4.25,4.8],[-5.75,4.25,-1.9],[-5.3,4.25,-2.7]], .07, mats.pipe, office);
  pipePath([[5.72,4.02,4.9],[5.72,4.02,-1.8],[5.2,4.02,-2.7]], .06, mats.pipe2, office);
  for (let z = -1; z < 5; z += 1.4) cylinder(.11, .35, mats.rust, -5.7, 4.25, z, office, 12).rotation.x = Math.PI / 2;
  addWallPanel(-5.84, 2.3, .6, Math.PI / 2); addWallPanel(5.84, 2.1, 1.7, -Math.PI / 2);
  addCableBundle([[-2.8,4.75,4.7],[-2.8,4.75,-1.5],[-1.8,4.65,-2.7]]);
  box(2.15, .16, 1.4, mats.darkMetal, 0, 4.73, -1.7, office);
  for (let x = -.8; x <= .8; x += .2) box(.1, .035, 1.15, mats.vent, x, 4.63, -1.7, office);

  box(2.25, 1.15, .22, mats.darkMetal, 0, .72, -2.92, office);
  box(1.85, .78, .08, material(0x050707, 1), 0, .75, -2.79, office);
  for (let x = -.78; x <= .78; x += .22) box(.075, .72, .05, mats.vent, x, .75, -2.72, office);

  officeLight = addPointLamp(0, 4.42, 1.1, 1.65, 0xd5e9df, 13, .08);
  emergencyLight = new THREE.PointLight(0xff2418, 0, 9, 2); emergencyLight.position.set(0, 3.7, 2.1); scene.add(emergencyLight);
}

function buildHalls(mats) {
  for (const side of [-1, 1]) {
    const x = side * 4.35;
    box(2.5, .25, 24, mats.floor, x, -.08, -14, world);
    box(.24, 4.7, 24, mats.wall, x - 1.22, 2.25, -14, world);
    box(.24, 4.7, 24, mats.wall, x + 1.22, 2.25, -14, world);
    box(2.5, .2, 24, mats.ceiling, x, 4.65, -14, world);
    for (let z = -6; z >= -24; z -= 5.5) addCeilingStrip(x, z, 1.35, z % 11 === 0 ? .5 : .74, 0xaecdc0, .3);
    for (let z = -6; z >= -24; z -= 4) {
      box(.12, 1.15, .08, mats.pipe, x + side * .96, 3.35, z, world);
      box(.15, .15, .08, mats.rust, x + side * .96, 3.9, z, world);
    }
    for (let z = -8; z >= -24; z -= 8) addCrate(x - side * .45, 0, z, .65, world);
  }

  leftDoorMesh = box(2.08, 4.35, .24, mats.door, -4.35, 6.55, -2.6, world);
  rightDoorMesh = box(2.08, 4.35, .24, mats.door, 4.35, 6.55, -2.6, world);
  for (const door of [leftDoorMesh, rightDoorMesh]) {
    for (let y = -1.7; y <= 1.7; y += .45) box(1.88, .055, .06, mats.doorRib, 0, y, .145, door);
    box(.5, .65, .08, mats.hazard, 0, 0, .16, door).rotation.z = .78;
  }

  leftHallLight = new THREE.SpotLight(0xffe9a1, 0, 14, Math.PI / 3.2, .52, 1.3);
  leftHallLight.position.set(-3.45, 2.8, -1.75); leftHallLight.target.position.set(-4.35, 1.2, -7); scene.add(leftHallLight, leftHallLight.target);
  rightHallLight = new THREE.SpotLight(0xffe9a1, 0, 14, Math.PI / 3.2, .52, 1.3);
  rightHallLight.position.set(3.45, 2.8, -1.75); rightHallLight.target.position.set(4.35, 1.2, -7); scene.add(rightHallLight, rightHallLight.target);
}

function buildRemoteRooms(mats) {
  box(15, .3, 12, mats.floor, 0, -.12, -29, world);
  box(15, 5, .3, mats.wall, 0, 2.3, -35, world);
  box(15, 5, .3, mats.wall, 0, 2.3, -23, world);
  box(.3, 5, 12, mats.wall, -7.5, 2.3, -29, world);
  box(.3, 5, 12, mats.wall, 7.5, 2.3, -29, world);
  box(15, .25, 12, mats.ceiling, 0, 4.8, -29, world);
  addCeilingStrip(0, -29, 3.2, 1.4, 0xc2dfd3, .22);
  addCeilingStrip(-4.7, -29, 2.1, .8, 0xb4d4c7, .3);
  addCeilingStrip(4.7, -29, 2.1, .8, 0xb4d4c7, .3);

  box(5.6, .35, 3.3, mats.darkMetal, 0, .08, -30, world);
  box(4.8, .2, 2.55, mats.hazardDark, 0, .35, -30, world);
  for (let x = -2; x <= 2; x += 1) cylinder(.08, 2.6, mats.rail, x, 1.5, -28.55, world, 12);
  pipePath([[-2.1,2.75,-28.55],[2.1,2.75,-28.55]], .07, mats.rail, world);

  addCrate(-5.7, 0, -31.8, .9, world); addCrate(-4.2, 0, -31.7, .72, world); addCrate(-5.8, 1, -33.2, .62, world);
  addCrate(5.6, 0, -31.5, .88, world); addCrate(4.2, 0, -33, .72, world); addCrate(6.1, 1, -33.2, .62, world);
  addWallPanel(-7.31, 2.35, -28, Math.PI / 2); addWallPanel(7.31, 2.35, -30, -Math.PI / 2);

  for (const x of [-2.2, 0, 2.2]) {
    const machine = new THREE.Group(); machine.position.set(x, 0, -33.55); world.add(machine);
    box(1.35, 2.15, 1.1, mats.machine, 0, 1.08, 0, machine);
    box(1.0, .55, .07, mats.screenGlow, 0, 1.45, .56, machine);
    for (let i = 0; i < 4; i++) cylinder(.08, .2, i % 2 ? mats.hazard : mats.pipe2, -.38 + i * .25, .72, .58, machine, 12).rotation.x = Math.PI / 2;
  }

  box(1.8, 1.45, 31, material(0x151b1a, .9, .45), 0, 3.65, -14.5, world);
  box(1.45, 1.08, 31.2, material(0x050807, 1), 0, 3.65, -14.5, world);
  for (let z = 0; z >= -29; z -= 1.6) box(1.52, .07, .1, mats.vent, 0, 3.65, z, world);
  ventShutter = box(1.5, 1.05, .13, mats.door, 0, 5.2, -1.25, world);
  ventLight = new THREE.PointLight(0x8ce9e0, 0, 7, 2); ventLight.position.set(0, 3.6, -2); scene.add(ventLight);

  pipePath([[-7.15,4.1,-34],[-7.15,4.1,-25],[0,4.1,-23.3],[7.15,4.1,-25],[7.15,4.1,-34]], .07, mats.pipe2, world);
  addCableBundle([[-6.8,4.45,-34],[-2.5,4.45,-34],[0,4.2,-32],[2.5,4.45,-34],[6.8,4.45,-34]]);
}

function makeRobot(config) {
  const root = new THREE.Group(); root.userData.parts = {};
  const body = material(config.color, .46, .62);
  const bodyDark = material(config.dark || 0x171b1a, .5, .76);
  const worn = material(config.accent || 0x8dffc1, .55, .4);
  const eye = new THREE.MeshStandardMaterial({ color: config.eye, emissive: config.eye, emissiveIntensity: 5, roughness: .3 });

  box(1.15, .55, .72, bodyDark, 0, 1.18, 0, root);
  const torso = box(1.42, 1.48, .86, body, 0, 2.15, 0, root); root.userData.parts.torso = torso;
  box(1.12, .25, .9, bodyDark, 0, 2.65, 0, root);
  box(.82, .48, .08, worn, 0, 2.15, .48, root);
  for (let i = 0; i < 4; i++) box(.09, .28, .055, bodyDark, -.27 + i * .18, 2.15, .535, root);

  const headPivot = new THREE.Group(); headPivot.position.set(0, 3.15, 0); root.add(headPivot); root.userData.parts.head = headPivot;
  box(1.05, .75, .78, body, 0, 0, 0, headPivot);
  const jaw = box(.88, .3, .72, bodyDark, 0, -.47, .04, headPivot); root.userData.parts.jaw = jaw;
  for (const x of [-.25, .25]) {
    box(.24, .12, .07, bodyDark, x, .07, .43, headPivot);
    sphere(.085, eye, x, .07, .48, headPivot, 12);
  }
  for (let i = 0; i < 5; i++) box(.09, .17, .05, material(0xc4baa0, .65, .25), -.28 + i * .14, -.43, .43, headPivot);

  if (config.style === 'antenna') {
    for (const x of [-.3, .3]) {
      cylinder(.055, .75, bodyDark, x, .7, 0, headPivot, 10).rotation.z = x < 0 ? -.18 : .18;
      sphere(.11, eye, x + (x < 0 ? -.07 : .07), 1.05, 0, headPivot, 10);
    }
  } else if (config.style === 'horn') {
    for (const x of [-.42, .42]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(.16, .72, 8), bodyDark); horn.position.set(x, .72, 0); horn.rotation.z = x < 0 ? -.4 : .4; headPivot.add(horn);
    }
  } else {
    box(1.3, .18, .85, bodyDark, 0, .52, 0, headPivot);
    box(.18, .58, .18, bodyDark, 0, .82, 0, headPivot);
  }

  root.userData.parts.arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * .9, 2.5, 0); root.add(arm); root.userData.parts.arms.push(arm);
    sphere(.2, bodyDark, 0, 0, 0, arm, 12);
    box(.32, 1.05, .34, body, 0, -.58, 0, arm);
    sphere(.16, bodyDark, 0, -1.13, 0, arm, 12);
    box(.28, .9, .28, body, 0, -1.65, .02, arm);
    const hand = sphere(.2, bodyDark, 0, -2.15, .05, arm, 12);
    for (let i = -1; i <= 1; i++) box(.06, .35, .06, bodyDark, i * .09, -2.38, .08, arm).rotation.z = i * .12;
    arm.rotation.z = side * .08; hand.rotation.z = side * .1;
  }

  root.userData.parts.legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * .38, 1.05, 0); root.add(leg); root.userData.parts.legs.push(leg);
    box(.42, .86, .42, body, 0, -.43, 0, leg);
    sphere(.16, bodyDark, 0, -.9, 0, leg, 12);
    box(.35, .82, .36, body, 0, -1.38, 0, leg);
    box(.48, .24, .72, bodyDark, 0, -1.9, .12, leg);
  }

  pipePath([[-.45,2.68,.1],[-.55,2.95,.25],[-.3,3.05,.35]], .025, material(0x25120e, .7, .2), root);
  pipePath([[.45,2.68,.1],[.55,2.95,.25],[.3,3.05,.35]], .025, material(0x102729, .7, .2), root);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.scale.setScalar(config.scale || 1);
  return root;
}

const cameraViews = [
  { name: 'CAM 01 — ATRIUM', pos: [0, 3.9, -24.2], look: [0, 1.5, -31] },
  { name: 'CAM 02 — ZÁPADNÍ SKLAD', pos: [-6.65, 3.65, -33.6], look: [-4.3, 1.2, -29.2] },
  { name: 'CAM 03 — VÝCHODNÍ SKLAD', pos: [6.65, 3.65, -33.6], look: [4.2, 1.2, -29.2] },
  { name: 'CAM 04 — LEVÁ CHODBA', pos: [-4.35, 3.8, -20.5], look: [-4.35, 1.1, -5.5] },
  { name: 'CAM 05 — PRAVÁ CHODBA', pos: [4.35, 3.8, -20.5], look: [4.35, 1.1, -5.5] },
  { name: 'CAM 06 — SERVISNÍ MŮSTEK', pos: [0, 4.25, -33.9], look: [0, 1.5, -29] },
  { name: 'CAM 07 — VENTILAČNÍ ŠACHTA', pos: [.62, 3.8, -21], look: [0, 3.6, -7] },
  { name: 'CAM 08 — VSTUP DO VENTILACE', pos: [0, 3.7, -2.2], look: [0, 3.65, -14] }
];

const enemies = [];
function createEnemies() {
  const configs = [
    {
      name: 'WARDEN-7', short: 'WARDEN', side: 'left', color: 0x5e6749, dark: 0x172019, accent: 0xaab974, eye: 0x9dffc3, style: 'antenna', scale: 1,
      aggression: .33, wait: [4.4, 8.2], doorWait: 1.65,
      route: [
        { p: [-2.4, 0, -30.2], cam: 0 }, { p: [-5.2, 0, -30.5], cam: 1 }, { p: [-4.35, 0, -20], cam: 3 }, { p: [-4.35, 0, -11], cam: 3 }, { p: [-4.35, 0, -4.2], cam: -1 }
      ]
    },
    {
      name: 'VEIL-3', short: 'VEIL', side: 'right', color: 0x604954, dark: 0x21151c, accent: 0x9b687e, eye: 0xff3c28, style: 'horn', scale: 1.04,
      aggression: .28, wait: [3.8, 7.7], doorWait: 1.35,
      route: [
        { p: [2.5, 0, -30.1], cam: 0 }, { p: [5.4, 0, -31.2], cam: 2 }, { p: [4.35, 0, -21], cam: 4 }, { p: [4.35, 0, -12.5], cam: 4 }, { p: [4.35, 0, -4.2], cam: -1 }
      ]
    },
    {
      name: 'MITE-12', short: 'MITE', side: 'vent', color: 0x3e5857, dark: 0x101d1e, accent: 0x5d9995, eye: 0x8ce9e0, style: 'plate', scale: .54,
      aggression: .24, wait: [5.2, 9.4], doorWait: 1.15,
      route: [
        { p: [0, 3.65, -31], cam: 5 }, { p: [0, 3.65, -26], cam: 6 }, { p: [0, 3.65, -18], cam: 6 }, { p: [0, 3.65, -9], cam: 6 }, { p: [0, 3.65, -2.5], cam: 7 }
      ]
    }
  ];

  configs.forEach((config, index) => {
    const mesh = makeRobot(config); mesh.position.set(...config.route[0].p); mesh.rotation.y = Math.PI; if (config.side === 'vent') mesh.rotation.x = Math.PI / 2; world.add(mesh);
    enemies.push({ ...config, mesh, index, step: 0, waitTimer: rand(...config.wait), attackTimer: 0, moving: false, blockedCount: 0 });
  });
}

class AudioSystem {
  constructor() { this.ctx = null; this.master = null; this.hum = null; this.humGain = null; this.noiseBuffer = null; this.ambientTimer = 0; }
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain(); this.master.gain.value = .72; this.master.connect(this.ctx.destination);
    this.hum = this.ctx.createOscillator(); this.hum.type = 'sawtooth'; this.hum.frequency.value = 48;
    this.humGain = this.ctx.createGain(); this.humGain.gain.value = .016;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 125;
    this.hum.connect(filter).connect(this.humGain).connect(this.master); this.hum.start();
    this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  tone(freq = 180, duration = .08, volume = .06, type = 'square', endFreq = null) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(Math.max(1, freq), now); if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), now + duration);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain).connect(this.master); osc.start(now); osc.stop(now + duration + .02);
  }
  noise(duration = .12, volume = .08, filterFreq = 1200) {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime, src = this.ctx.createBufferSource(), gain = this.ctx.createGain(), filter = this.ctx.createBiquadFilter();
    src.buffer = this.noiseBuffer; filter.type = 'bandpass'; filter.frequency.value = filterFreq; filter.Q.value = .8;
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    src.connect(filter).connect(gain).connect(this.master); src.start(now); src.stop(now + duration);
  }
  door(close) { this.tone(close ? 78 : 120, .24, .11, 'sawtooth', close ? 48 : 170); this.noise(.18, .055, 280); }
  light() { this.tone(260, .04, .035, 'square'); this.tone(1100, .025, .015, 'sine'); }
  camera(open) { this.noise(.09, .05, 1900); this.tone(open ? 520 : 310, .07, .035, 'square'); }
  step(index = 0) { this.tone(44 + index * 8, .17, .04, 'sine', 30); this.noise(.08, .025, 180); }
  blocked() { this.tone(62, .35, .09, 'sawtooth', 34); this.noise(.28, .08, 220); }
  staticBurst() { this.noise(.22, .12, 2700); this.tone(1300, .055, .028, 'square'); }
  warning() { this.tone(760, .08, .045, 'square'); setTimeout(() => this.tone(760, .08, .045, 'square'), 120); }
  scare() { this.noise(.8, .34, 1400); this.tone(70, .8, .38, 'sawtooth', 1700); this.tone(120, .65, .2, 'square', 800); }
  win() { [0, .18, .36].forEach((delay, i) => setTimeout(() => this.tone([440, 660, 880][i], .42, .08, 'sine'), delay * 1000)); }
  update(dt) {
    if (!this.ctx) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0 && state.running && !state.paused) {
      this.ambientTimer = rand(7, 15);
      if (Math.random() < .5) this.noise(rand(.2, .6), .012, rand(150, 500));
      else this.tone(rand(38, 62), rand(.3, .7), .014, 'sine');
    }
    if (this.humGain) this.humGain.gain.setTargetAtTime(state.powerOut ? .002 : .016, this.ctx.currentTime, .2);
  }
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
  if (!renderer.capabilities.isWebGL2) console.warn('WebGL2 unavailable; using compatibility mode.');
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', '3D pohled do bezpečnostní kanceláře');
  ui.game.appendChild(renderer.domElement);

  scene = new THREE.Scene(); scene.background = new THREE.Color(0x030606); scene.fog = new THREE.FogExp2(0x030606, .032);
  camera = new THREE.PerspectiveCamera(63, innerWidth / innerHeight, .08, 120); camera.position.set(0, 2.28, 5.9); camera.rotation.order = 'YXZ';
  clock = new THREE.Clock(false);
  world = new THREE.Group(); scene.add(world);

  const concrete = makeConcreteTexture(), floor = makeFloorTexture(), metalTex = makeMetalTexture();
  const mats = {
    wall: material(0x3a4140, .94, .06, { map: concrete }), floor: material(0x282d2c, .98, .05, { map: floor }),
    ceiling: material(0x161b1b, .94, .18), desk: material(0x3b4442, .56, .58, { map: metalTex }), darkMetal: material(0x202727, .52, .72),
    door: material(0x3f4847, .44, .78, { map: metalTex }), doorRib: material(0x171d1d, .45, .82), hazard: material(0xc09326, .76, .2),
    hazardDark: material(0x40300e, .85, .12), rust: material(0x734526, .85, .18), pipe: material(0x303938, .38, .78), pipe2: material(0x4b5e58, .4, .72),
    rail: material(0x717b77, .42, .7), vent: material(0x4c5754, .48, .7), monitorShell: material(0x101616, .48, .7),
    screenGlow: material(0x2d5f50, .45, .25, { emissive: 0x143b31, emissiveIntensity: .75 }), machine: material(0x333d3b, .55, .62),
    fan: material(0x59625f, .48, .68), key: material(0x57615e, .65, .35)
  };

  buildOffice(mats); buildHalls(mats); buildRemoteRooms(mats); createEnemies();
  scene.add(new THREE.HemisphereLight(0x61766d, 0x080a09, .23));

  applyQuality();
  setupEvents();
  audio = new AudioSystem();
  renderer.setAnimationLoop(render);
}

function applyQuality() {
  if (!renderer) return;
  const requested = ui.quality?.value || state.quality;
  state.quality = requested;
  const autoLow = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 || innerWidth < 700;
  const low = requested === 'low' || (requested === 'auto' && autoLow);
  renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.65));
  renderer.shadowMap.enabled = !low;
  animatedLights.forEach(({ light }) => { if (light.isPointLight) light.castShadow = !low; });
}

function setButtonState(button, active) { button.classList.toggle('active', active); }
function toast(message, duration = 1500) {
  clearTimeout(state.toastTimer); ui.toast.textContent = message; ui.toast.classList.add('show');
  state.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), duration);
}

function setDoor(side, value = !state[`${side}Door`]) {
  if (!canControl()) return;
  state[`${side}Door`] = value; setButtonState(ui[`${side}Door`], value); state.doorUses++; audio.door(value);
}
function setLight(side, value = !state[`${side}Light`]) {
  if (!canControl()) return;
  state[`${side}Light`] = value; setButtonState(ui[`${side}Light`], value); audio.light();
}
function setVent(value = !state.ventSeal) {
  if (!canControl()) return;
  state.ventSeal = value; setButtonState(ui.ventSeal, value); audio.door(value); if (value) toast('VENTILACE UZAVŘENA');
}
function canControl() { return state.running && !state.paused && !state.gameOver && !state.powerOut; }

function setMonitor(value = !state.monitor) {
  if (!canControl()) return;
  state.monitor = value; ui.monitor.classList.toggle('hidden', !value); state.cameraUses += value ? 1 : 0; audio.camera(value);
  if (value) { activateCamera(state.cam, false); document.exitPointerLock?.(); }
}

function activateCamera(index, sound = true) {
  if (!state.monitor) return;
  state.cam = clamp(index, 0, cameraViews.length - 1);
  ui.cameraName.textContent = cameraViews[state.cam].name;
  ui.cameraButtons.forEach((button, i) => button.classList.toggle('active', i === state.cam));
  if (sound) audio.staticBurst();
  triggerGlitch(.12);
}

function triggerGlitch(duration = .28, blackout = false) {
  state.glitch = Math.max(state.glitch, duration); ui.cameraNoise.classList.add('glitching');
  if (blackout) { state.signalBlackout = Math.max(state.signalBlackout, duration); ui.signalLoss.classList.remove('hidden'); }
}

function resetGameState() {
  Object.assign(state, {
    running: false, paused: false, monitor: false, gameOver: false, powerOut: false, cam: 0, power: 100, elapsed: 0,
    yaw: 0, targetYaw: 0, leftDoor: false, rightDoor: false, leftLight: false, rightLight: false, ventSeal: false,
    usage: 1, signal: 96, signalBlackout: 0, glitch: 0, moves: 0, doorUses: 0, cameraUses: 0, maxThreat: 0, lastHour: -1, outageTimer: 0
  });
  enemies.forEach((enemy) => {
    enemy.step = 0; enemy.waitTimer = rand(...enemy.wait); enemy.attackTimer = 0; enemy.moving = false; enemy.blockedCount = 0;
    enemy.mesh.position.set(...enemy.route[0].p); enemy.mesh.rotation.y = Math.PI;
  });
  document.body.classList.remove('power-low', 'power-out');
  [ui.leftDoor, ui.rightDoor, ui.leftLight, ui.rightLight, ui.ventSeal].forEach((button) => button.classList.remove('active', 'jammed'));
  ui.monitor.classList.add('hidden'); ui.signalLoss.classList.add('hidden'); ui.motionWarning.classList.add('hidden');
  ui.endScreen.classList.remove('visible'); ui.pauseScreen.classList.remove('visible'); ui.jumpscare.classList.add('hidden');
}

async function startGame() {
  resetGameState();
  state.difficulty = DIFFICULTY[ui.difficulty.value] || DIFFICULTY.standard;
  state.quality = ui.quality.value; applyQuality(); audio.init();
  ui.startScreen.classList.remove('visible'); ui.loadingScreen.classList.add('visible');
  const steps = ['Kalibrace bezpečnostních kamer…', 'Spouštím energetickou sběrnici…', 'Načítám diagnostiku jednotek…', 'Uzamykám sektor B1…'];
  for (const text of steps) { ui.loadingText.textContent = text; await new Promise((resolve) => setTimeout(resolve, 180)); }
  ui.loadingScreen.classList.remove('visible');
  [ui.hud, ui.controls, ui.threatPanel].forEach((el) => el.classList.remove('hidden-ui'));
  state.running = true; state.sessionStart = performance.now(); clock.start();
  toast(`${state.difficulty.label} · PŘEŽIJ DO 6:00`, 2200);
}

function togglePause(force) {
  if (!state.running || state.gameOver) return;
  state.paused = typeof force === 'boolean' ? force : !state.paused;
  ui.pauseScreen.classList.toggle('visible', state.paused);
  if (state.paused) { clock.stop(); document.exitPointerLock?.(); } else { clock.start(); audio.ctx?.resume?.(); }
}

function setupEvents() {
  ui.leftDoor.addEventListener('click', () => setDoor('left'));
  ui.rightDoor.addEventListener('click', () => setDoor('right'));
  ui.leftLight.addEventListener('click', () => setLight('left'));
  ui.rightLight.addEventListener('click', () => setLight('right'));
  ui.ventSeal.addEventListener('click', () => setVent());
  ui.monitorButton.addEventListener('click', () => setMonitor()); ui.closeMonitor.addEventListener('click', () => setMonitor(false));
  ui.cameraButtons.forEach((button, i) => button.addEventListener('click', () => activateCamera(i)));
  $('#startButton').addEventListener('click', startGame); $('#resumeButton').addEventListener('click', () => togglePause(false));
  $('#restartButton').addEventListener('click', () => { ui.startScreen.classList.add('visible'); resetGameState(); [ui.hud, ui.controls, ui.threatPanel].forEach((el) => el.classList.add('hidden-ui')); });
  ui.quality.addEventListener('change', applyQuality);
  $('#lookLeft').addEventListener('pointerdown', () => state.targetYaw = .82); $('#lookRight').addEventListener('pointerdown', () => state.targetYaw = -.82);
  $('#lookLeft').addEventListener('pointerup', () => state.targetYaw = state.yaw); $('#lookRight').addEventListener('pointerup', () => state.targetYaw = state.yaw);

  addEventListener('keydown', (event) => {
    if (event.repeat && !['KeyA', 'KeyD'].includes(event.code)) return;
    if (event.code === 'KeyP' || event.code === 'Escape' && !state.pointerLocked) togglePause();
    if (state.paused) return;
    if (event.code === 'KeyC') setMonitor();
    if (event.code === 'KeyZ') setDoor('left'); if (event.code === 'KeyX') setLight('left');
    if (event.code === 'KeyN') setDoor('right'); if (event.code === 'KeyM') setLight('right'); if (event.code === 'KeyV') setVent();
    if (event.code === 'KeyA' || event.code === 'ArrowLeft') state.targetYaw = clamp(state.targetYaw + .18, -.84, .84);
    if (event.code === 'KeyD' || event.code === 'ArrowRight') state.targetYaw = clamp(state.targetYaw - .18, -.84, .84);
    if (/^Digit[1-8]$/.test(event.code) && state.monitor) activateCamera(Number(event.code.at(-1)) - 1);
  });

  addEventListener('mousemove', (event) => {
    if (!state.running || state.monitor || state.paused || !state.pointerLocked) return;
    state.targetYaw = clamp(state.targetYaw - event.movementX * .00155, -.84, .84);
  });
  renderer.domElement.addEventListener('click', () => { if (canControl() && !state.monitor) renderer.domElement.requestPointerLock?.(); });
  document.addEventListener('pointerlockchange', () => { state.pointerLocked = document.pointerLockElement === renderer.domElement; });

  renderer.domElement.addEventListener('pointerdown', (event) => { if (event.pointerType === 'touch') state.touchX = event.clientX; });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' || state.touchX === null || state.monitor) return;
    const dx = event.clientX - state.touchX; state.targetYaw = clamp(state.targetYaw - dx * .004, -.84, .84); state.touchX = event.clientX;
  });
  renderer.domElement.addEventListener('pointerup', () => state.touchX = null); renderer.domElement.addEventListener('pointercancel', () => state.touchX = null);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); applyQuality();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.running && !state.gameOver) togglePause(true); });
}

function updateDoors(dt) {
  leftDoorMesh.position.y = damp(leftDoorMesh.position.y, state.leftDoor ? 2.08 : 6.55, 9, dt);
  rightDoorMesh.position.y = damp(rightDoorMesh.position.y, state.rightDoor ? 2.08 : 6.55, 9, dt);
  ventShutter.position.y = damp(ventShutter.position.y, state.ventSeal ? 3.65 : 5.2, 9, dt);
  leftHallLight.intensity = damp(leftHallLight.intensity, state.leftLight && !state.powerOut ? 4.4 : 0, 12, dt);
  rightHallLight.intensity = damp(rightHallLight.intensity, state.rightLight && !state.powerOut ? 4.4 : 0, 12, dt);
  ventLight.intensity = damp(ventLight.intensity, state.ventSeal && !state.powerOut ? 1.5 : 0, 10, dt);
}

function enemyBlocked(enemy) {
  if (enemy.side === 'left') return state.leftDoor;
  if (enemy.side === 'right') return state.rightDoor;
  return state.ventSeal;
}

function currentEnemyCamera(enemy) { return enemy.route[enemy.step]?.cam ?? -1; }
function isEnemyObserved(enemy) { return state.monitor && state.cam === currentEnemyCamera(enemy) && state.signalBlackout <= 0; }

function moveEnemy(enemy, direction = 1) {
  const oldCam = currentEnemyCamera(enemy);
  enemy.step = clamp(enemy.step + direction, 0, enemy.route.length - 1);
  enemy.moving = true; enemy.waitTimer = rand(...enemy.wait);
  state.moves++; audio.step(enemy.index);
  const newCam = currentEnemyCamera(enemy);
  if (state.monitor && (state.cam === oldCam || state.cam === newCam)) { triggerGlitch(rand(.18, .42), Math.random() < .24); audio.staticBurst(); }
  setTimeout(() => { enemy.moving = false; }, 550);
}

function updateEnemies(dt) {
  const hour = Math.floor((state.elapsed / state.difficulty.nightLength) * 6);
  const hourBoost = 1 + hour * .14;
  const highUsageBoost = 1 + Math.max(0, state.usage - 3) * .055;

  enemies.forEach((enemy) => {
    const routeNode = enemy.route[enemy.step]; tempV.set(...routeNode.p);
    const speed = enemy.side === 'vent' ? 1.25 : 1.75;
    enemy.mesh.position.lerp(tempV, 1 - Math.exp(-dt * speed));
    enemy.mesh.position.y = routeNode.p[1] + Math.sin(state.elapsed * 2.2 + enemy.index) * .018;
    const parts = enemy.mesh.userData.parts;
    const walk = enemy.moving ? Math.sin(state.elapsed * 9) : Math.sin(state.elapsed * 1.4) * .08;
    parts.head.rotation.y = Math.sin(state.elapsed * .7 + enemy.index) * .12;
    parts.head.rotation.x = isEnemyObserved(enemy) ? -.08 : Math.sin(state.elapsed * .6) * .035;
    parts.jaw.rotation.x = .08 + Math.max(0, Math.sin(state.elapsed * 1.2 + enemy.index)) * .08;
    parts.arms.forEach((arm, i) => arm.rotation.x = walk * (i ? -1 : 1) * .22);
    parts.legs.forEach((leg, i) => leg.rotation.x = walk * (i ? 1 : -1) * .18);

    const atFinal = enemy.step === enemy.route.length - 1 && enemy.mesh.position.distanceTo(tempV) < .28;
    if (atFinal) {
      if (enemyBlocked(enemy)) {
        enemy.attackTimer = 0; enemy.waitTimer -= dt;
        if (enemy.waitTimer <= 0) {
          enemy.blockedCount++; audio.blocked(); triggerGlitch(.25, state.monitor && Math.random() < .2); moveEnemy(enemy, enemy.step > 2 ? -2 : -1);
        }
      } else {
        enemy.attackTimer += dt;
        const illuminated = enemy.side === 'left' ? state.leftLight : enemy.side === 'right' ? state.rightLight : state.ventSeal;
        if (illuminated && enemy.attackTimer < enemy.doorWait * .55) toast(`${enemy.short}: KONTAKT U ${enemy.side === 'vent' ? 'VENTILACE' : enemy.side === 'left' ? 'LEVÝCH DVEŘÍ' : 'PRAVÝCH DVEŘÍ'}`, 800);
        if (enemy.attackTimer >= enemy.doorWait) triggerGameOver(enemy);
      }
      return;
    }

    enemy.attackTimer = 0; enemy.waitTimer -= dt;
    if (enemy.waitTimer > 0 || enemy.mesh.position.distanceTo(tempV) > .28) return;

    let behaviorModifier = 1;
    if (enemy.side === 'left' && isEnemyObserved(enemy)) behaviorModifier *= .42;
    if (enemy.side === 'right' && state.monitor) behaviorModifier *= 1.32;
    if (enemy.side === 'vent') behaviorModifier *= highUsageBoost * (state.monitor && state.cam === 6 ? .55 : 1.12);
    const chance = enemy.aggression * state.difficulty.aggression * hourBoost * behaviorModifier;
    if (Math.random() < chance) moveEnemy(enemy, 1); else enemy.waitTimer = rand(...enemy.wait) * .72;
  });
}

function updatePower(dt) {
  if (state.powerOut) {
    state.outageTimer -= dt;
    if (state.outageTimer <= 0) triggerGameOver({ name: 'VÝPADEK SÍTĚ', short: 'BLACKOUT', index: 1 });
    return;
  }
  const active = Number(state.monitor) + Number(state.leftDoor) + Number(state.rightDoor) + Number(state.leftLight) + Number(state.rightLight) + Number(state.ventSeal) * 2;
  state.usage = clamp(1 + active, 1, 6);
  const drainPerSecond = (.095 + active * .118) * state.difficulty.drain;
  state.power = Math.max(0, state.power - dt * drainPerSecond);
  if (state.power <= 0) beginPowerOutage();

  ui.power.textContent = `${Math.ceil(state.power)}%`;
  ui.usage.forEach((bar, i) => {
    bar.classList.toggle('on', i < state.usage); bar.classList.toggle('warning', state.usage >= 4); bar.classList.toggle('danger', state.usage >= 6);
  });
  const low = state.power <= 20; document.body.classList.toggle('power-low', low);
  if (low) ui.systemStatus.textContent = state.power <= 8 ? 'KRITICKÁ ENERGIE' : 'NÍZKÁ ENERGIE';
  else ui.systemStatus.textContent = state.signalBlackout > 0 ? 'CHYBA KAMEROVÉ SÍTĚ' : 'SYSTÉMY ONLINE';
}

function beginPowerOutage() {
  if (state.powerOut) return;
  state.powerOut = true; state.monitor = false; state.leftDoor = state.rightDoor = state.leftLight = state.rightLight = state.ventSeal = false;
  state.outageTimer = state.difficulty.outageDelay; document.body.classList.add('power-out'); ui.monitor.classList.add('hidden');
  [ui.leftDoor, ui.rightDoor, ui.leftLight, ui.rightLight, ui.ventSeal].forEach((button) => button.classList.remove('active'));
  officeLight.intensity = 0; emergencyLight.intensity = .25; ui.systemStatus.textContent = 'NAPÁJENÍ ODPOJENO'; audio.warning(); toast('VÝPADEK NAPÁJENÍ', 3000);
}

function updateClockAndHud() {
  const progress = clamp(state.elapsed / state.difficulty.nightLength, 0, 1);
  const hour = Math.min(6, Math.floor(progress * 6)); ui.clock.textContent = `${hour === 0 ? 12 : hour} AM`;
  if (hour !== state.lastHour) {
    state.lastHour = hour;
    if (hour > 0 && hour < 6) { audio.tone(520 + hour * 45, .22, .055, 'sine'); toast(`${hour}:00 AM`, 1100); }
  }
  if (state.elapsed >= state.difficulty.nightLength) winGame();

  const closest = Math.max(...enemies.map((enemy) => enemy.step / (enemy.route.length - 1)));
  const threat = Math.round(closest * 100); state.maxThreat = Math.max(state.maxThreat, threat);
  ui.threatFill.style.width = `${Math.max(3, threat)}%`;
  ui.threatFill.style.background = threat > 78 ? 'var(--red)' : threat > 48 ? 'var(--amber)' : 'var(--green)';
  ui.threatText.textContent = threat > 88 ? 'BEZPROSTŘEDNÍ HROZBA' : threat > 62 ? 'POHYB V BLÍZKOSTI' : threat > 28 ? 'POHYB V SEKTORU' : 'BEZ POHYBU';
}

function updateCameraSystem(dt) {
  state.glitch = Math.max(0, state.glitch - dt); state.signalBlackout = Math.max(0, state.signalBlackout - dt);
  if (state.glitch <= 0) ui.cameraNoise.classList.remove('glitching');
  if (state.signalBlackout <= 0) ui.signalLoss.classList.add('hidden');
  const motionHere = enemies.some((enemy) => currentEnemyCamera(enemy) === state.cam && enemy.moving);
  const enemyHere = enemies.some((enemy) => currentEnemyCamera(enemy) === state.cam);
  ui.motionWarning.classList.toggle('hidden', !motionHere);
  ui.cameraButtons.forEach((button, i) => button.classList.toggle('motion', enemies.some((enemy) => currentEnemyCamera(enemy) === i && enemy.moving)));
  state.signal = clamp(94 + Math.sin(state.elapsed * 1.3 + state.cam) * 3 - (enemyHere ? 7 : 0) - state.glitch * 18, 51, 99);
  ui.cameraMeta.textContent = `SIGNÁL ${Math.round(state.signal)}% · ${enemyHere ? 'AUDIO AKTIVNÍ' : 'AUDIO PASIVNÍ'}`;
  const totalSeconds = Math.floor(state.elapsed), h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0'), m = String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0'), s = String(totalSeconds % 60).padStart(2, '0');
  ui.recordTimer.textContent = `${h}:${m}:${s}`;
}

function updateLighting(time) {
  animatedLights.forEach((item) => {
    const noise = Math.sin(time * (7 + item.speed * 8) + item.phase) * .035 + (Math.random() < item.speed * .006 ? -.65 : 0);
    item.light.intensity = state.powerOut ? 0 : Math.max(0, item.base + noise);
    if (item.glow) item.glow.material.opacity = state.powerOut ? 0 : .72 + noise;
  });
  if (!state.powerOut) officeLight.intensity = 1.65 + Math.sin(time * 17) * .025;
  emergencyLight.intensity = damp(emergencyLight.intensity, state.powerOut ? .34 + Math.sin(time * 4) * .18 : 0, 4, 1 / 60);
}

function triggerGameOver(enemy) {
  if (state.gameOver) return;
  state.gameOver = true; state.running = false; state.monitor = false; document.exitPointerLock?.(); ui.monitor.classList.add('hidden');
  ui.jumpscare.classList.remove('hidden'); audio.scare();
  setTimeout(() => {
    ui.jumpscare.classList.add('hidden');
    ui.endEyebrow.textContent = 'SIGNÁL ZTRACEN'; ui.endTitle.textContent = 'KONEC SMĚNY';
    ui.endText.textContent = enemy.name === 'VÝPADEK SÍTĚ' ? 'Stanice se ponořila do tmy. Něco našlo cestu dovnitř.' : `Jednotka ${enemy.name} pronikla do kanceláře.`;
    renderStats(false); ui.endScreen.classList.add('visible');
  }, 1050);
}

function winGame() {
  if (state.gameOver) return;
  state.gameOver = true; state.running = false; document.exitPointerLock?.(); audio.win();
  ui.endEyebrow.textContent = 'SMĚNA DOKONČENA'; ui.endTitle.textContent = '6:00'; ui.endText.textContent = 'Nouzová blokace stanice byla obnovena. Přežil jsi noc.';
  renderStats(true); ui.endScreen.classList.add('visible');
}

function renderStats(win) {
  ui.endStats.innerHTML = `
    <div><span>VÝSLEDEK</span><strong>${win ? 'PŘEŽITÍ' : 'SELHÁNÍ'}</strong></div>
    <div><span>ZBÝVAJÍCÍ ENERGIE</span><strong>${Math.ceil(state.power)}%</strong></div>
    <div><span>POHYBY JEDNOTEK</span><strong>${state.moves}</strong></div>
    <div><span>POUŽITÍ DVEŘÍ</span><strong>${state.doorUses}</strong></div>
    <div><span>OTEVŘENÍ KAMER</span><strong>${state.cameraUses}</strong></div>
    <div><span>MAX. HROZBA</span><strong>${state.maxThreat}%</strong></div>`;
}

function updateCamera(dt, time) {
  if (state.monitor) {
    const view = cameraViews[state.cam];
    tempV.set(...view.pos); tempV.x += Math.sin(time * .72 + state.cam) * .045; tempV.y += Math.sin(time * .95) * .025;
    camera.position.lerp(tempV, 1 - Math.exp(-dt * 11));
    lookTarget.set(...view.look); lookTarget.x += Math.sin(time * .65) * .04; camera.lookAt(lookTarget);
    camera.rotation.z += Math.sin(time * 1.2 + state.cam) * .00025;
    scene.fog.density = .047;
  } else {
    state.yaw = damp(state.yaw, state.targetYaw, 10, dt);
    const bob = Math.sin(time * 1.25) * .006;
    camera.position.lerp(tempV.set(0, 2.28 + bob, 5.9), 1 - Math.exp(-dt * 8));
    camera.rotation.y = damp(camera.rotation.y, state.yaw, 12, dt);
    camera.rotation.x = damp(camera.rotation.x, state.pitch + Math.sin(time * .7) * .003, 10, dt);
    camera.rotation.z = damp(camera.rotation.z, -state.yaw * .012, 8, dt);
    scene.fog.density = .032;
  }
}

function render() {
  const dt = Math.min(.05, clock.running ? clock.getDelta() : 1 / 60);
  const time = performance.now() * .001;
  fanRotor.rotation.z -= dt * (state.powerOut ? 1.2 : 7.2);
  updateLighting(time); updateDoors(dt); audio?.update(dt);

  if (state.running && !state.paused) {
    state.elapsed += dt; updateEnemies(dt); updatePower(dt); updateClockAndHud(); updateCameraSystem(dt);
  }
  updateCamera(dt, time);
  renderer.render(scene, camera);
}

try { initRenderer(); } catch (error) { showFatalError(error); }
