/* ------------------------------------------------- orbit camera and framing */
const FOV = 22;

/** Where to put a camera looking from (theta, phi) so that every point fits the viewport minus padding. */
function fitView(points, theta, phi, aspect, pad) {
  pad = Object.assign({ l: 0.04, r: 0.04, t: 0.06, b: 0.05 }, pad);
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 1000);
  const dir = new V3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
  const box = new THREE.Box3().setFromPoints(points);
  const target = box.getCenter(new V3());
  let dist = box.getSize(new V3()).length() * 1.3;
  const x0 = -1 + 2 * pad.l, x1 = 1 - 2 * pad.r, y0 = -1 + 2 * pad.b, y1 = 1 - 2 * pad.t;
  const right = new V3(), up = new V3(), q = new V3();
  const tanH = Math.tan((FOV * Math.PI) / 360);
  for (let it = 0; it < 16; it++) {
    cam.position.copy(target).addScaledVector(dir, dist); cam.lookAt(target); cam.updateMatrixWorld(true);
    let a = Infinity, b = -Infinity, lo = Infinity, hi = -Infinity;
    for (const p of points) { q.copy(p).project(cam); a = Math.min(a, q.x); b = Math.max(b, q.x); lo = Math.min(lo, q.y); hi = Math.max(hi, q.y); }
    const s = Math.max((b - a) / (x1 - x0), (hi - lo) / (y1 - y0));
    right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1);
    target.addScaledVector(right, ((a + b) / 2 - (x0 + x1) / 2) * dist * tanH * aspect).addScaledVector(up, ((lo + hi) / 2 - (y0 + y1) / 2) * dist * tanH);
    dist *= lerp(1, s, 0.85);
  }
  return { target, dist, theta, phi };
}

function OrbitCam(dom, camera) {
  const cur = { theta: -0.5, phi: 1.0, dist: 50, target: new V3() };
  const goal = { theta: -0.5, phi: 1.0, dist: 50, target: new V3() };
  const self = { cur, goal, moved: true, dragging: false, onUserMove: null, auto: false };
  let tween = null;

  function apply() {
    const sp = Math.sin(cur.phi);
    camera.position.set(cur.target.x + cur.dist * sp * Math.sin(cur.theta), cur.target.y + cur.dist * Math.cos(cur.phi), cur.target.z + cur.dist * sp * Math.cos(cur.theta));
    camera.lookAt(cur.target); camera.updateMatrixWorld(true);
  }
  self.place = function (v, snap) {
    goal.theta = v.theta; goal.phi = v.phi; goal.dist = v.dist; goal.target.copy(v.target);
    if (snap) { cur.theta = v.theta; cur.phi = v.phi; cur.dist = v.dist; cur.target.copy(v.target); tween = null; apply(); self.moved = true; }
  };
  self.flyTo = function (v, ms) {
    if (REDUCED_MOTION || !ms) return self.place(v, true);
    let dth = (v.theta - cur.theta) % (Math.PI * 2);
    if (dth > Math.PI) dth -= Math.PI * 2; if (dth < -Math.PI) dth += Math.PI * 2;
    tween = { t: 0, ms, from: { theta: cur.theta, phi: cur.phi, dist: cur.dist, target: cur.target.clone() }, to: { theta: cur.theta + dth, phi: v.phi, dist: v.dist, target: v.target.clone() } };
  };
  self.update = function (dt) {
    if (tween) {
      tween.t = Math.min(1, tween.t + (dt * 1000) / tween.ms);
      const k = ease.inOut(tween.t), a = tween.from, b = tween.to;
      cur.theta = lerp(a.theta, b.theta, k); cur.phi = lerp(a.phi, b.phi, k); cur.dist = lerp(a.dist, b.dist, k); cur.target.lerpVectors(a.target, b.target, k);
      self.place(cur, false);
      if (tween.t >= 1) tween = null;
      apply(); self.moved = true; return;
    }
    if (self.auto && !self.dragging) goal.theta += dt * 0.07;
    const k = 1 - Math.pow(0.0005, dt);   // critically-damped-ish follow
    const d = Math.abs(goal.theta - cur.theta) + Math.abs(goal.phi - cur.phi) + Math.abs(goal.dist - cur.dist) / 20 + goal.target.distanceTo(cur.target) / 10;
    if (d > 1e-4) {
      cur.theta = lerp(cur.theta, goal.theta, k); cur.phi = lerp(cur.phi, goal.phi, k); cur.dist = lerp(cur.dist, goal.dist, k); cur.target.lerp(goal.target, k);
      apply(); self.moved = true;
    }
  };

  /* pointer input: drag orbits, right-drag / shift-drag / two fingers pan, wheel and pinch zoom */
  const ptrs = new Map();
  let last = null, travelled = 0;
  const userMoved = () => { tween = null; if (self.onUserMove) self.onUserMove(); };
  function pan(dx, dy) {
    const k = (2 * goal.dist * Math.tan((FOV * Math.PI) / 360)) / dom.clientHeight;
    const right = new V3().setFromMatrixColumn(camera.matrixWorld, 0), up = new V3().setFromMatrixColumn(camera.matrixWorld, 1);
    goal.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  }
  const zoom = f => { goal.dist = clamp(goal.dist * f, 5, 160); };
  const mid = () => { let x = 0, y = 0; ptrs.forEach(p => { x += p.x; y += p.y; }); return { x: x / ptrs.size, y: y / ptrs.size }; };
  const spread = () => { const a = Array.from(ptrs.values()); return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
  dom.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey || e.ctrlKey || e.metaKey });
    try { dom.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    last = { m: mid(), s: spread() }; travelled = 0; self.dragging = true;
  });
  dom.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const m = mid(), s = spread(), dx = m.x - last.m.x, dy = m.y - last.m.y;
    travelled += Math.abs(dx) + Math.abs(dy);
    if (travelled > 4) {
      if (ptrs.size >= 2) { pan(dx, dy); if (last.s > 0 && s > 0) zoom(last.s / s); }
      else if (p.button === 2 || p.button === 1 || p.shift) pan(dx, dy);
      else { goal.theta -= dx * 0.0055; goal.phi = clamp(goal.phi - dy * 0.0055, 0.08, 1.52); }
      userMoved();
    }
    last = { m, s };
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size) last = { m: mid(), s: spread() };
    else { self.dragging = false; if (travelled <= 4 && self.onClick) self.onClick(e); }
  };
  dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(clamp(e.deltaY, -120, 120) * 0.0016)); userMoved(); }, { passive: false });
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('keydown', e => {
    const k = e.key; let used = true;
    if (k === 'ArrowLeft') goal.theta -= 0.12; else if (k === 'ArrowRight') goal.theta += 0.12;
    else if (k === 'ArrowUp') goal.phi = clamp(goal.phi - 0.08, 0.08, 1.52); else if (k === 'ArrowDown') goal.phi = clamp(goal.phi + 0.08, 0.08, 1.52);
    else if (k === '+' || k === '=') zoom(0.88); else if (k === '-' || k === '_') zoom(1.14);
    else used = false;
    if (used) { e.preventDefault(); userMoved(); }
  });
  self.apply = apply;
  return self;
}
