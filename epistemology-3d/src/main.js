import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  BRANCHES,
  EDGES,
  KIND,
  LADDER,
  NODES,
  SPINE,
  YEAR_MARKS,
  layoutY,
  tierName,
} from "./data.js";

const view = document.getElementById("view");
const panel = document.getElementById("panel");
const modesEl = document.getElementById("modes");
const branchesEl = document.getElementById("branches");
const queryEl = document.getElementById("q");
const resetBtn = document.getElementById("reset");

const ENGLISH = {
  plato: "Plato",
  descartes: "Descartes",
  locke: "Locke",
  berkeley: "Berkeley",
  hume: "Hume",
  kant: "Kant",
  mach: "Mach",
  husserl: "Husserl",
  "russell-problems": "Russell",
  "russell-external": "Russell",
  "carnap-aufbau": "Carnap",
  "carnap-syntax": "Carnap",
  quine: "Quine",
  sellars: "Sellars",
  gettier: "Gettier",
  goldman: "Goldman",
  nozick: "Nozick",
  williamson: "Williamson",
};
const DEPTH = 1.15;
const LABEL_NUDGE = {
  plato: [0, 0.85],
  descartes: [-3.1, 0.35],
  locke: [3.0, -0.35],
  berkeley: [-2.4, 0.15],
  hume: [-2.7, 0.55],
  kant: [2.1, 0.75],
  gettier: [2.5, 0.2],
  goldman: [-2.9, 0.2],
  nozick: [2.7, 0.25],
  williamson: [0.4, 0.9],
  "russell-problems": [-2.5, 0.3],
  "russell-external": [2.5, 0.15],
  "carnap-aufbau": [0.2, 0.9],
  sellars: [2.3, 0.35],
};
const HOME = {
  pos: new THREE.Vector3(22, 16.5, 29),
  target: new THREE.Vector3(-1.2, 8, 0),
};

const state = {
  selected: null,
  branch: "all",
  mode: "all",
  query: "",
};

const branchOf = Object.fromEntries(BRANCHES.map((b) => [b.id, b]));
const nodeOf = Object.fromEntries(NODES.map((n) => [n.id, n]));

assignHeights(NODES);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101216);
scene.fog = new THREE.Fog(0x101216, 42, 96);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 220);
camera.position.copy(HOME.pos);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
view.appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.domElement.style.position = "absolute";
labels.domElement.style.inset = "0";
labels.domElement.style.pointerEvents = "none";
view.appendChild(labels.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = false;
controls.minDistance = 6;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.92;
controls.update();

scene.add(new THREE.HemisphereLight(0xf4ecdf, 0x242830, 0.85));
const key = new THREE.DirectionalLight(0xfff6e8, 1.35);
key.position.set(12, 24, 16);
scene.add(key);
const fill = new THREE.DirectionalLight(0x8ea4b8, 0.45);
fill.position.set(-16, 8, -10);
scene.add(fill);

const grid = new THREE.GridHelper(54, 12, 0x3a4048, 0x2c3138);
grid.position.y = -7.1;
for (const material of [].concat(grid.material)) {
  material.transparent = true;
  material.opacity = 0.45;
}
scene.add(grid);

const runtimeNodes = new Map();
const runtimeEdges = [];
const ladderMeshes = [];
let ladderGroup;
let ladderCaption;

buildAxis();
buildNodes();
buildEdges();
buildLadder();

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(1, 0.018, 8, 64),
  new THREE.MeshBasicMaterial({ color: 0xf4e7c4 }),
);
ring.visible = false;
scene.add(ring);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragging = false;
let press = { x: 0, y: 0 };
let lastPick = { id: null, time: 0 };
let hovered = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
  press = { x: event.clientX, y: event.clientY };
  dragging = false;
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (event.buttons) {
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) dragging = true;
  }
  hoverAt(event);
});
renderer.domElement.addEventListener("pointerup", (event) => {
  if (dragging) return;
  const hit = pick(event);
  if (!hit) {
    state.selected = null;
    lastPick = { id: null, time: 0 };
    renderPanel();
    return;
  }
  const now = performance.now();
  const again = lastPick.id === hit.id && now - lastPick.time < 360;
  lastPick = { id: hit.id, time: now };
  state.selected = hit.id;
  renderPanel();
  if (again) focusOn(hit.position);
});
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
renderer.domElement.addEventListener("pointerleave", () => {
  hovered = null;
  renderer.domElement.style.cursor = "default";
});

controls.addEventListener("start", () => {
  controls.autoRotate = false;
  flight.active = false;
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    state.selected = null;
    renderPanel();
  }
});
window.addEventListener("resize", resize);
queryEl.addEventListener("input", () => {
  state.query = queryEl.value.trim();
  state.selected = null;
  renderPanel();
});
resetBtn.addEventListener("click", () => {
  controls.autoRotate = false;
  flyTo(HOME.pos, HOME.target);
});

renderModes();
renderPanel();
resize();

const flight = {
  active: false,
  pos: new THREE.Vector3(),
  target: new THREE.Vector3(),
};

function flyTo(pos, target) {
  flight.pos.copy(pos);
  flight.target.copy(target);
  flight.active = true;
}

function focusOn(position) {
  const offset = new THREE.Vector3(4.2, 2.1, 8.4);
  flyTo(position.clone().add(offset), position);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labels.setSize(w, h);
}

function assignHeights(list) {
  for (const node of list) node.y = layoutY(node.year);
  const groups = new Map();
  for (const node of list) {
    if (!groups.has(node.branch)) groups.set(node.branch, []);
    groups.get(node.branch).push(node);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.y - b.y || a.year - b.year);
    for (let i = 1; i < group.length; i += 1) {
      const min = group[i - 1].y + 1.05;
      if (group[i].y < min) group[i].y = min;
    }
    for (let i = 0; i < group.length; i += 1) {
      const prevClose = i > 0 && group[i].y - group[i - 1].y < 3.4;
      const nextClose = i < group.length - 1 && group[i + 1].y - group[i].y < 3.4;
      group[i].labelSide = prevClose || nextClose ? (i % 2 === 0 ? -1 : 1) : 0;
    }
  }
}

function buildAxis() {
  const railX = -17.4;
  const bottom = -6.4;
  const top = 23.2;
  const rail = line([railX, bottom, 0], [railX, top, 0], 0x3c4148);
  scene.add(rail);

  for (const branch of BRANCHES) {
    scene.add(line([branch.x, bottom, 0], [branch.x, top, 0], branch.color, 0.28));
    const el = document.createElement("div");
    el.className = "branch-label";
    el.innerHTML = `<div class="bn"></div><div class="bq"></div>`;
    el.querySelector(".bn").textContent = branch.name;
    el.querySelector(".bq").textContent = branch.hint;
    const obj = new CSS2DObject(el);
    obj.position.set(branch.x, 24.1, 0);
    scene.add(obj);
  }

  for (const mark of YEAR_MARKS) {
    const y = layoutY(mark.year);
    const span = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-16.2, y, 0),
      new THREE.Vector3(16.2, y, 0),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0x8d887c, transparent: true, opacity: 0.16 });
    scene.add(new THREE.Line(span, mat));
    const el = document.createElement("div");
    el.className = "year-label";
    el.textContent = mark.label;
    const obj = new CSS2DObject(el);
    obj.position.set(railX - 0.2, y, 0);
    scene.add(obj);
  }
}

function line(a, b, color, opacity = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a[0], a[1], a[2]),
    new THREE.Vector3(b[0], b[1], b[2]),
  ]);
  return new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );
}

function buildNodes() {
  for (const node of NODES) {
    const branch = branchOf[node.branch];
    const radius = node.hero ? 0.5 : node.tier === "core" ? 0.4 : node.tier === "supplement" ? 0.32 : 0.26;
    const color = new THREE.Color(branch.color);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: node.hero ? 0.55 : 0.32,
      roughness: 0.42,
      metalness: 0.16,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), material);
    const displayZ = node.z * DEPTH;
    mesh.position.set(branch.x, node.y, displayZ);
    mesh.userData.pick = node.id;
    scene.add(mesh);
    if (Math.abs(displayZ) > 0.35) {
      scene.add(line([branch.x, node.y, 0], [branch.x, node.y, displayZ], branch.color, 0.38));
    }

    const el = document.createElement("div");
    el.className = "node-label";
    const inner = document.createElement("div");
    inner.innerHTML = `<span class="name"></span><span class="sub"></span>`;
    inner.querySelector(".name").textContent = node.thinker;
    inner.querySelector(".sub").textContent = node.yearLabel;
    el.appendChild(inner);
    const nudge = LABEL_NUDGE[node.id];
    const label = new CSS2DObject(el);
    label.position.set(
      nudge ? nudge[0] : (node.labelSide || 0) * 2.15,
      nudge ? nudge[1] : node.labelSide ? 0.05 : radius + 0.55,
      0,
    );
    mesh.add(label);

    runtimeNodes.set(node.id, {
      data: node,
      mesh,
      material,
      labelEl: el,
      inner,
      radius,
      position: mesh.position,
    });
  }
}

function buildEdges() {
  for (const edge of EDGES) {
    const a = runtimeNodes.get(edge.from).position.clone();
    const b = runtimeNodes.get(edge.to).position.clone();
    const mid = a.clone().lerp(b, 0.5);
    const delta = new THREE.Vector3().subVectors(b, a);
    const flat = new THREE.Vector3(delta.x, 0, delta.z);
    let side = new THREE.Vector3(-flat.z, 0, flat.x);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    side.normalize();
    const mag = THREE.MathUtils.clamp(flat.length() * 0.16, 0.45, 2.4);
    mid.add(side.multiplyScalar(mag * (edge.bend || 1)));
    mid.y += Math.min(1.1, flat.length() * 0.04);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const radius = edge.spine ? 0.045 : edge.kind === "critique" ? 0.03 : 0.02;
    const geo = new THREE.TubeGeometry(curve, 28, radius, 5, false);
    const color = edge.spine && edge.kind !== "critique" ? 0xf4e7c4 : new THREE.Color(KIND[edge.kind].color);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.raycast = () => {};
    scene.add(mesh);
    runtimeEdges.push({ data: edge, mesh, material });
  }
}

function buildLadder() {
  ladderGroup = new THREE.Group();
  ladderGroup.visible = false;
  LADDER.forEach((step, index) => {
    const color = new THREE.Color().setHSL(0.1, 0.35, 0.45 + index * 0.04);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
    });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), material);
    mesh.position.set(10.5, 3.4 + index * 1.55, 9 + index * 0.48);
    mesh.userData.pick = step.id;
    mesh.visible = false;
    ladderGroup.add(mesh);

    const el = document.createElement("div");
    el.className = "ladder-label";
    el.style.display = "none";
    el.innerHTML = `<div class="step"></div><div class="name"></div>`;
    el.querySelector(".step").textContent = String(index + 1).padStart(2, "0");
    el.querySelector(".name").textContent = step.name;
    const label = new CSS2DObject(el);
    label.position.set(0.7, 0.15, 0);
    mesh.add(label);

    if (index > 0) {
      const prev = ladderMeshes[index - 1].mesh.position;
      const curve = new THREE.LineCurve3(prev.clone(), mesh.position.clone());
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 1, 0.035, 5, false),
        new THREE.MeshBasicMaterial({ color: 0xf0d78c, transparent: true, opacity: 0.85 }),
      );
      tube.raycast = () => {};
      ladderGroup.add(tube);
    }
    ladderMeshes.push({ step, mesh, material, labelEl: el });
  });
  const caption = document.createElement("div");
  caption.className = "year-label";
  caption.textContent = "《构造》的上升阶梯";
  caption.style.display = "none";
  ladderCaption = caption;
  const captionObj = new CSS2DObject(caption);
  captionObj.position.set(10.5, 2.35, 8.5);
  ladderGroup.add(captionObj);
  scene.add(ladderGroup);
}

function renderModes() {
  const modes = [
    ["all", "全部"],
    ["core", "必读主干"],
    ["spine", "最短阅读链"],
    ["ladder", "构造阶梯"],
  ];
  modesEl.replaceChildren();
  for (const [id, label] of modes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(state.mode === id));
    btn.addEventListener("click", () => {
      state.mode = id;
      state.selected = null;
      if (id === "ladder") focusLadder();
      renderModes();
      renderPanel();
    });
    modesEl.appendChild(btn);
  }

  branchesEl.replaceChildren();
  const chips = [{ id: "all", name: "全部问题" }, ...BRANCHES];
  for (const branch of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = branch.name;
    btn.setAttribute("aria-pressed", String(state.branch === branch.id));
    btn.addEventListener("click", () => {
      state.branch = branch.id;
      state.selected = null;
      renderModes();
      renderPanel();
    });
    branchesEl.appendChild(btn);
  }
}

function nodeActive(node) {
  if (state.branch !== "all" && node.branch !== state.branch) return false;
  if (state.mode === "core" && node.tier !== "core") return false;
  if (state.query) {
    const blob = `${node.thinker} ${node.work} ${node.original} ${node.claim} ${ENGLISH[node.id] || ""}`;
    if (!blob.toLowerCase().includes(state.query.toLowerCase())) return false;
  }
  return true;
}

function visuals() {
  const selected = state.selected;
  const neighbors = new Set();
  if (selected && nodeOf[selected]) {
    neighbors.add(selected);
    for (const edge of EDGES) {
      if (edge.from === selected) neighbors.add(edge.to);
      if (edge.to === selected) neighbors.add(edge.from);
    }
  }

  const ladderOn = state.mode === "ladder" || (selected && selected.startsWith("L"));
  ladderGroup.visible = ladderOn;

  for (const item of runtimeNodes.values()) {
    let target = 1;
    if (!nodeActive(item.data)) target = 0;
    else if (selected && nodeOf[selected]) target = neighbors.has(item.data.id) ? 1 : 0.08;
    else if (state.mode === "spine") target = item.data.spine ? 1 : 0.14;
    else if (state.mode === "ladder" && !selected) target = 0.07;
    if (hovered === item.data.id && target > 0) target = 1;
    item.target = target;
  }

  for (const edge of runtimeEdges) {
    const a = runtimeNodes.get(edge.data.from).target;
    const b = runtimeNodes.get(edge.data.to).target;
    let target = Math.min(a, b);
    if (state.mode === "spine" && edge.data.spine && a > 0 && b > 0) target = Math.max(target, 0.95);
    if (selected && (edge.data.from === selected || edge.data.to === selected) && a > 0 && b > 0) {
      target = 1;
    }
    edge.target = target;
  }

  for (const item of ladderMeshes) {
    item.target = !ladderOn ? 0 : selected && selected.startsWith("L") ? (selected === item.step.id ? 1 : 0.28) : 1;
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (flight.active) {
    camera.position.lerp(flight.pos, 0.08);
    controls.target.lerp(flight.target, 0.08);
    if (camera.position.distanceTo(flight.pos) < 0.04) flight.active = false;
  }
  controls.update();
  visuals();

  for (const item of runtimeNodes.values()) {
    const material = item.material;
    material.opacity = damp(material.opacity, item.target, 0.16);
    material.emissiveIntensity = item.data.hero ? 0.45 + material.opacity * 0.25 : 0.18 + material.opacity * 0.22;
    item.mesh.visible = material.opacity > 0.03;
    item.labelEl.style.opacity = String(Math.min(1, material.opacity * 1.15));
    const dist = camera.position.distanceTo(item.position);
    const scale = THREE.MathUtils.clamp(30 / dist, 0.82, 1.08);
    item.inner.style.transform = `scale(${scale})`;
    const grow = hovered === item.data.id ? 1.08 : 1;
    item.mesh.scale.setScalar(damp(item.mesh.scale.x, grow, 0.2));
  }

  for (const edge of runtimeEdges) {
    edge.material.opacity = damp(edge.material.opacity, edge.target * 0.92, 0.16);
    edge.mesh.visible = edge.material.opacity > 0.03;
  }

  for (const item of ladderMeshes) {
    item.material.opacity = damp(item.material.opacity ?? 1, item.target, 0.16);
    item.mesh.visible = ladderGroup.visible;
    item.labelEl.style.opacity = ladderGroup.visible ? "1" : "0";
  }

  if (state.selected && runtimeNodes.has(state.selected)) {
    const item = runtimeNodes.get(state.selected);
    ring.visible = item.mesh.visible;
    ring.position.copy(item.position);
    ring.lookAt(camera.position);
    const s = item.radius + 0.16;
    ring.scale.setScalar(s);
  } else if (state.selected && state.selected.startsWith("L")) {
    const item = ladderMeshes.find((entry) => entry.step.id === state.selected);
    ring.visible = Boolean(item);
    if (item) {
      ring.position.copy(item.mesh.position);
      ring.lookAt(camera.position);
      ring.scale.setScalar(0.55);
    }
  } else {
    ring.visible = false;
  }

  labels.render(scene, camera);
  if (!ladderGroup.visible) {
    for (const item of ladderMeshes) item.labelEl.style.display = "none";
    if (ladderCaption) ladderCaption.style.display = "none";
  }
  renderer.render(scene, camera);
}

function damp(current, target, amount) {
  return current + (target - current) * amount;
}

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const meshes = [];
  for (const item of runtimeNodes.values()) {
    if (item.target > 0.05) meshes.push(item.mesh);
  }
  if (ladderGroup.visible) {
    for (const item of ladderMeshes) {
      if (item.target > 0.05) meshes.push(item.mesh);
    }
  }
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  const id = hits[0].object.userData.pick;
  if (id.startsWith("L")) {
    return { id, position: hits[0].object.position };
  }
  return { id, position: runtimeNodes.get(id).position };
}

function hoverAt(event) {
  const hit = pick(event);
  const next = hit ? hit.id : null;
  if (next !== hovered) hovered = next;
  renderer.domElement.style.cursor = next ? "pointer" : "default";
}

function renderPanel() {
  const selected = state.selected;
  if (selected && nodeOf[selected]) {
    panel.innerHTML = personPanel(nodeOf[selected]);
    bindPanel();
    return;
  }
  if (selected && selected.startsWith("L")) {
    const index = LADDER.findIndex((step) => step.id === selected);
    panel.innerHTML = ladderPanel(LADDER[index], index);
    bindPanel();
    return;
  }
  panel.innerHTML = homePanel();
  bindPanel();
}

function bindPanel() {
  panel.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-open");
      state.selected = id;
      const item = runtimeNodes.get(id);
      if (item) focusOn(item.position);
      if (id.startsWith("L")) state.mode = "ladder";
      renderModes();
      renderPanel();
    });
  });
  panel.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.getAttribute("data-mode");
      state.selected = null;
      if (state.mode === "ladder") focusLadder();
      renderModes();
      renderPanel();
    });
  });
  const close = panel.querySelector("[data-close]");
  if (close) {
    close.addEventListener("click", () => {
      state.selected = null;
      renderPanel();
    });
  }
}

function focusLadder() {
  const anchor = ladderMeshes[4].mesh.position;
  flyTo(anchor.clone().add(new THREE.Vector3(7, 2.4, 13)), anchor.clone());
}

function homePanel() {
  const chain = SPINE.map((id) => {
    const node = nodeOf[id];
    return `<button type="button" data-open="${id}">${esc(node.thinker)}</button>`;
  });
  const chainHtml = `${chain.slice(0, 6).join(" → ")}<br />然后分成 ${chain[6]} 与 ${chain[7]}`;
  const matches = state.query ? NODES.filter((node) => nodeActive(node)) : [];
  const found = state.query
    ? `<h3>搜索</h3><div class="chain">${matches.length ? matches.map((node) => `<button type="button" data-open="${node.id}">${esc(node.thinker)} · ${esc(node.work)}</button>`).join("<br />") : "没有对上的节点。"}</div>`
    : "";
  return `
    <p class="year">怎么读</p>
    <h2>一张问题的地图</h2>
    <p class="claim">五条竖列是五个还在追问的问题。时间自下而上，从《泰阿泰德篇》走到 2000 年。转到侧面，能看见怀疑和现象学分叉落在后面，批判与新理论来到前面。</p>
    <h3>最短阅读链</h3>
    <p class="chain">${chainHtml}</p>
    <h3>《构造》在做什么</h3>
    <p>从最基础的经验出发，用逻辑关系把日常对象、他人心灵和科学世界逐层搭出来。打开「构造阶梯」，或点开卡尔纳普。</p>
    ${found}
  `;
}

function personPanel(node) {
  const branch = branchOf[node.branch];
  const incoming = EDGES.filter((edge) => edge.to === node.id);
  const outgoing = EDGES.filter((edge) => edge.from === node.id);
  const rel = [...incoming.map((edge) => ({ edge, other: edge.from, dir: "from" })), ...outgoing.map((edge) => ({ edge, other: edge.to, dir: "to" }))];
  const relHtml = rel.length
    ? `<ul>${rel.map(({ edge, other, dir }) => {
        const name = nodeOf[other].thinker;
        const verb = KIND[edge.kind].name;
        const sentence = dir === "from"
          ? `${esc(name)} ${esc(verb)}：${esc(edge.via)}`
          : `${esc(verb)} ${esc(name)}：${esc(edge.via)}`;
        return `<li><button type="button" data-open="${other}">${sentence}</button></li>`;
      }).join("")}</ul>`
    : `<p>这一节点是问题的起点。</p>`;
  const bridge = node.bridge ? `<h3>和书名的距离</h3><p>${esc(node.bridge)}</p>` : "";
  return `
    <button class="close" type="button" data-close>关闭</button>
    <p class="year">${esc(node.yearLabel)}</p>
    <h2>${esc(node.thinker)}</h2>
    <p class="work">${esc(node.work)}</p>
    <p class="original">${esc(node.original)}</p>
    <div class="meta">
      <span class="tag">${esc(branch.name)}</span>
      <span class="tag">${esc(tierName(node.tier))}</span>
      ${node.spine ? `<span class="tag">阅读链</span>` : ""}
    </div>
    <p class="claim">${esc(node.claim)}</p>
    <h3>这一步</h3>
    <p>${esc(node.move)}</p>
    <h3>放在哪</h3>
    <p>${esc(node.place)}</p>
    ${bridge}
    ${node.id === "carnap-aufbau" ? `<p style="margin-top:14px"><button type="button" class="chip" data-mode="ladder">看构造阶梯</button></p>` : ""}
    <h3>上下游</h3>
    ${relHtml}
  `;
}

function ladderPanel(step, index) {
  const prev = index > 0 ? LADDER[index - 1] : null;
  const next = index < LADDER.length - 1 ? LADDER[index + 1] : null;
  return `
    <button class="close" type="button" data-close>关闭</button>
    <p class="year">构造阶梯 · ${String(index + 1).padStart(2, "0")} / 09</p>
    <h2>${esc(step.name)}</h2>
    <p class="claim">${esc(step.text)}</p>
    <h3>前后</h3>
    <ul>
      ${prev ? `<li><button type="button" data-open="${prev.id}">上一步 · ${esc(prev.name)}</button></li>` : ""}
      ${next ? `<li><button type="button" data-open="${next.id}">下一步 · ${esc(next.name)}</button></li>` : ""}
      <li><button type="button" data-open="carnap-aufbau">回到卡尔纳普《世界的逻辑构造》</button></li>
    </ul>
    <h3>这架梯子的方向</h3>
    <p>经验，相似关系，概念，对象，然后才是科学世界。它说明的是概念体系如何被搭起来。</p>
  `;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

animate();
