/* ------------------------------------------------------------------ main */
const HERO = { theta: -0.22, phi: 1.0 };      // the angle of the exported hero image: near frontal, so printed titles read level
const STEP_VIEWS = [
  { box: 'all', theta: -0.42, phi: 1.03 },    // on screen the overview is turned a little more, clear of the masthead
  { box: 'all', theta: -0.62, phi: 0.98 },
  { box: 'entry', theta: -0.3, phi: 0.92 },
  { box: 'farm', theta: -0.5, phi: 1.08 },
  { box: 'farm', theta: -0.34, phi: 1.02 },
  { box: 'farm', theta: -0.22, phi: 1.1 },
  { box: 'farm', theta: -0.52, phi: 1.0 },
];
const PART_NAMES = { instance: 'EC2 instance', system: 'operating system', openvox: 'OpenVox agent', certificate: 'signed certificate', services: 'profile::base', htcondor: 'HTCondor', server: 'OpenVox server', hiera: 'Hiera data' };

function start(snapshot) {
  const appEl = $('#app'), stage = $('#stage'), glc = $('#gl'), ovc = $('#ov'), tip = $('#tip');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, alpha: true }); }
  catch (e) { const f = $('#fallback'); f.hidden = false; f.textContent = 'This view needs WebGL, which this browser has turned off. The details panel still works.'; }

  const view = { step: 0, selected: null, hover: null, explode: 0, labels: 'main', extraLabels: [], flowShown: () => true };
  const app = { renderer, view, HERO, size: { w: 1, h: 1 }, theme: 'light' };
  const scene = app.scene = new THREE.Scene();
  const camera = app.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 700);
  const cam = OrbitCam(stage, camera);
  let userMoved = false, explodeGoal = 0, explodeT = 0;

  /* ---- light, ground */
  const hemi = new THREE.HemisphereLight(); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1); sun.position.set(-15, 27, 11); sun.target.position.set(0, 0, 3); scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.2); fill.position.set(14, 9, 16); scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.003; ground.receiveShadow = true; ground.renderOrder = -1; scene.add(ground);
  const grid = app.grid = gridMaterial();
  const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), grid); gridMesh.rotation.x = -Math.PI / 2; gridMesh.position.y = -0.006; gridMesh.renderOrder = -2; scene.add(gridMesh);
  if (renderer) {
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = true;
    const sz = renderer.capabilities.maxTextureSize >= 8192 ? 4096 : 2048;
    sun.shadow.mapSize.set(sz, sz); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3.5;
  }

  /* ---- theme */
  const themeNow = () => {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || t === 'light' ? t : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  };
  app.paint = function (theme) {
    app.theme = theme;
    const P = PALETTE[theme];
    app.W.applyTheme(P);
    hemi.color.copy(srgb(P.hemi[0])); hemi.groundColor.copy(srgb(P.hemi[1])); hemi.intensity = P.hemi[2];
    sun.intensity = P.sun; ground.material.opacity = P.shadow;
    grid.uniforms.color.value.copy(srgb(P.grid[0])); grid.uniforms.alpha.value = P.grid[1];
    $('#btn-theme').textContent = theme === 'dark' ? 'Light' : 'Dark';
  };
  new MutationObserver(() => { if (app.W && themeNow() !== app.theme) app.paint(themeNow()); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (app.W && themeNow() !== app.theme) app.paint(themeNow()); });

  /* ---- framing */
  const narrow = () => window.matchMedia('(max-width: 860px)').matches;
  function pads() {
    const { w, h } = app.size;
    if (narrow()) return { l: 0.03, r: 0.03, t: 0.05, b: 0.05 };
    const open = appEl.dataset.inspector === 'open';
    return { l: 0.025, r: open ? Math.min(0.45, 404 / w) : 0.025, t: Math.min(0.3, 78 / h), b: Math.min(0.42, ($('.dock').offsetHeight + 34) / h) };
  }
  function targetView() {
    const W = app.W, aspect = app.size.w / app.size.h, sel = view.selected;
    if (sel && sel.kind === 'node' && W.nodes[sel.id]) {
      const p = pads(); p.t += 0.12; p.l += 0.14; p.r += 0.05; p.b += 0.04;
      return fitView(W.fit.node(sel.id), -0.52, 1.0, aspect, p);
    }
    const sv = STEP_VIEWS[view.step] || STEP_VIEWS[0];
    // on a tall viewport, look more along the row of machines: whichever yaw brings the model closest
    const tall = aspect < 1.15;
    const yaws = tall ? [sv.theta, -0.8, -1.05, -1.3] : [sv.theta];
    const pts = W.fit[tall && sv.box === 'all' ? 'farm' : sv.box]();
    return yaws.map(th => fitView(pts, th, tall ? Math.min(sv.phi, 0.96) : sv.phi, aspect, pads())).reduce((a, b) => (b.dist < a.dist ? b : a));
  }
  function frame(snap) { if (snap) cam.place(targetView(), true); else cam.flyTo(targetView(), 950); userMoved = false; }
  cam.onUserMove = () => { userMoved = true; $('#hint').classList.add('gone'); };

  /* ---- picking */
  const ray = new THREE.Raycaster();
  function shown(o) {
    if (o.userData.flow && !view.flowShown(o.userData.flow)) return false;
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }
  function pickAt(x, y) {
    const l = app.labels.hit(x, y); if (l) return l;
    ray.setFromCamera({ x: (x / app.size.w) * 2 - 1, y: -((y / app.size.h) * 2 - 1) }, camera);
    let glass = null;
    for (const h of ray.intersectObjects(app.W.picks, false)) {
      if (!shown(h.object)) continue;
      const p = h.object.userData.pick;
      if (p.kind === 'sg') { glass = glass || p; continue; }       // look through the glass first
      return p.kind === 'net' && glass ? glass : p;
    }
    return glass;
  }
  function describe(p) {
    const m = app.model;
    switch (p.kind) {
      case 'node': { const mm = m.machines.find(x => x.name === p.id) || {}; return [p.id, p.part ? PART_NAMES[p.part] || p.part : mm.role]; }
      case 'sg': return ['security group ' + m.sgName, `${m.rules.length} rules`];
      case 'net': return p.part === 'igw' ? ['internet gateway', 'route ' + (m.net.routes || []).join(', ')] : p.part === 'vpc' ? ['VPC', m.net.vpc_cidr] : p.part === 'subnet' ? ['subnet', (m.net.subnet || {}).cidr] : ['AWS region', m.infra.region];
      case 'workspace': return ['workspace', CONTEXT.workspace];
      case 'internet': return ['internet', 'repositories, DNS, time'];
      case 'flow': { const f = FLOWS.find(x => x.id === p.id); return [f.name, f.what]; }
      case 'jobs': return [`${m.byHost[p.id] || 0} jobs completed`, 'on ' + p.id];
      case 'ghost': return [p.id, 'no longer exists'];
    }
    return ['', ''];
  }
  let ptr = null, hoverDirty = false;
  stage.addEventListener('pointermove', e => { const r = stage.getBoundingClientRect(); ptr = { x: e.clientX - r.left, y: e.clientY - r.top, type: e.pointerType }; hoverDirty = true; });
  stage.addEventListener('pointerleave', () => { ptr = null; hoverDirty = true; });
  stage.addEventListener('pointerdown', () => stage.classList.add('dragging'));
  window.addEventListener('pointerup', () => stage.classList.remove('dragging'));
  function updateHover() {
    hoverDirty = false;
    const p = ptr && !cam.dragging && ptr.type !== 'touch' ? pickAt(ptr.x, ptr.y) : null;
    view.hover = p;
    stage.classList.toggle('pointing', !!p);
    if (!p) { tip.hidden = true; return; }
    const d = describe(p);
    tip.replaceChildren(d[0], el('small', null, d[1] || ''));
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(ptr.x + 14, 4, app.size.w - tw - 4) + 'px';
    tip.style.top = clamp(ptr.y + 16, 4, app.size.h - th - 4) + 'px';
  }
  cam.onClick = e => { const r = stage.getBoundingClientRect(); select(pickAt(e.clientX - r.left, e.clientY - r.top)); };

  function select(pick) {
    const same = pick && view.selected && pick.kind === view.selected.kind && pick.id === view.selected.id && pick.part === view.selected.part;
    if (same) return;
    const wasNode = view.selected && view.selected.kind === 'node';
    view.selected = pick || null;
    appEl.dataset.inspector = pick ? 'open' : 'closed';
    $('#btn-details').setAttribute('aria-pressed', String(!!pick));
    app.inspector.show(pick || null);
    if ((pick && pick.kind === 'node') || (!pick && wasNode) || !userMoved) frame(false);
    if (pick && narrow()) toast(describe(pick)[0] + ': details are below the model');
  }
  app.select = select;

  /* ---- chrome */
  function buildChrome() {
    const m = app.model;
    $('#eyebrow').textContent = 'Lab snapshot · ' + m.milestone;
    $('#title').textContent = CONTEXT.project;
    $('#meta').textContent = `captured ${fmt.utc(m.captured)}${m.git.commit ? ' · commit ' + m.git.commit : ''}`;
    $('#facts').replaceChildren(...app.story.facts(0).map(f => el('li', null, f)));
    $('#legend').replaceChildren(...FLOWS.map(f => el('li', null, el('button', {
      type: 'button', 'aria-pressed': 'true', style: { '--c': `var(--${f.key})` }, title: 'Show or hide this flow',
      onclick: e => { const b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); app.story.toggleFlow(f.id, on); },
    }, el('span', { class: 'swatch' + (f.buildTime ? ' dashed' : '') }), el('span', { class: 'name' }, f.name), el('span', { class: 'what' }, f.what)))));
    const stepBtn = (n, verb, tool, key) => { const b = el('button', { type: 'button', 'data-step': n, onclick: () => setStep(n) }, el('span', { class: 'n' }, n ? String(n) : '•'), el('b', null, verb), el('small', null, tool)); b.style.setProperty('--c', `var(--${key})`); return b; };
    $('#steps').replaceChildren(stepBtn(0, 'Overview', m.milestone, 'alma'), ...CONTEXT.steps.map(s => stepBtn(s.n, s.verb, s.tool, s.key)));
    renderCaption();
  }
  function renderCaption() {
    const n = view.step, s = n ? CONTEXT.steps[n - 1] : null, m = app.model, cap = $('#caption');
    const idle = !Object.keys(m.pool.queue || {}).length;
    const text = s ? s.text : `The lab as it was captured on ${fmt.utc(m.captured)}. Pick a step to see how it is built, or click a machine to read everything the snapshot recorded about it.`;
    const note = n === 5 ? ` Animated illustration${idle ? ': at capture the queue was empty and the slots idle' : ''}.` : n === 6 ? ' Replay of the recorded demonstration, time compressed.' : '';
    cap.hidden = !s;
    const who = el('div', { class: 'who' }, el('b', null, s ? `${n}. ${s.verb}` : 'Overview'), el('span', null, s ? s.tool : 'snapshot ' + m.milestone));
    if (s) who.style.setProperty('--c', `var(--${s.key})`);
    const detail = el('div', { class: 'detail' }, el('p', null, text, note ? el('span', { class: 'muted' }, note) : null),
      n === 6 ? el('ul', { class: 'phases', id: 'phases' }, HEAL_PHASES.map((p, i) => el('li', { 'aria-current': i === app.story.phase ? 'true' : null }, p.name))) : null,
      el('ul', { class: 'facts' }, app.story.facts(n).map(f => el('li', null, f))));
    cap.replaceChildren(who, detail);
    for (const b of $('#steps').children) b.setAttribute('aria-current', String(Number(b.dataset.step) === n ? 'step' : 'false'));
  }
  function setStep(n) {
    app.story.set(n);
    renderCaption();
    if (!view.selected || view.selected.kind !== 'node') frame(false);
  }
  app.setStep = setStep;

  const toast = (msg, ms) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms || 2600); };

  // the lab summary lists every machine as a button: the way into the details without a pointer
  $('#btn-details').addEventListener('click', e => {
    const open = appEl.dataset.inspector !== 'open';
    if (!open) return select(null);
    appEl.dataset.inspector = 'open'; e.currentTarget.setAttribute('aria-pressed', 'true');
    app.inspector.show(null, true);
    if (!userMoved) frame(false);
  });
  $('#btn-explode').addEventListener('click', e => { explodeGoal = explodeGoal ? 0 : 1; e.currentTarget.setAttribute('aria-pressed', String(!!explodeGoal)); });
  $('#btn-labels').addEventListener('click', e => { view.labels = { main: 'all', all: 'off', off: 'main' }[view.labels]; e.currentTarget.textContent = 'Labels: ' + view.labels; });
  $('#btn-rotate').addEventListener('click', e => { cam.auto = !cam.auto; e.currentTarget.setAttribute('aria-pressed', String(cam.auto)); });
  $('#btn-reset').addEventListener('click', () => frame(false));
  $('#btn-theme').addEventListener('click', () => document.documentElement.setAttribute('data-theme', app.theme === 'dark' ? 'light' : 'dark'));
  const menu = $('#export-menu'), btnExport = $('#btn-export');
  const closeMenu = () => { menu.hidden = true; btnExport.setAttribute('aria-expanded', 'false'); };
  btnExport.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; btnExport.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  menu.addEventListener('click', e => { const b = e.target.closest('[data-export]'); if (b) { closeMenu(); doExport(b.dataset.export); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#modal').hidden) $('#modal').hidden = true; else if (!menu.hidden) closeMenu(); else if (view.selected) select(null); else if (appEl.dataset.inspector === 'open') app.inspector.close(); } });
  $('#modal-close').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });

  function doExport(preset) {
    if (!renderer) return;
    const o = Object.assign({}, EXPORTS[preset]);
    const cv = renderImage(app, o);
    const name = `${o.file}-${app.theme}.png`;
    toast('Preparing ' + name + '…', 12000);
    cv.toBlob(async blob => {
      const res = await saveBlob(blob, name);
      if (res === 'saved') toast('Saved ' + name);
      else if (res === 'declined') toast('Export cancelled');
      else {
        $('#toast').hidden = true;
        $('#modal-img').src = URL.createObjectURL(blob);
        $('#modal-note').textContent = `${cv.width} × ${cv.height} px. This viewer cannot save files directly: press and hold or right-click the image, then choose “Save image”.`;
        $('#modal').hidden = false;
      }
    }, 'image/png');
  }

  /* ---- open another snapshot (file picker or drop) */
  function readFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { try { load(JSON.parse(String(r.result))); toast('Loaded ' + file.name); } catch (err) { toast('Could not read ' + file.name + ': ' + (err && err.message ? err.message : 'not a snapshot.json'), 5200); } };
    r.readAsText(file);
  }
  $('#file-snapshot').addEventListener('change', e => { readFile(e.target.files[0]); e.target.value = ''; });
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });

  /* ---- (re)build from a snapshot */
  function load(S) {
    const model = buildModel(S);                   // throws on a file that is not a snapshot
    if (app.W) {
      app.story.dispose(); scene.remove(app.W.root);
      app.W.root.traverse(o => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; ms.forEach(mt => { if (mt.map) mt.map.dispose(); mt.dispose(); }); });
    }
    app.model = model;
    Object.assign(view, { step: 0, selected: null, hover: null, explode: 0, extraLabels: [] });
    explodeGoal = explodeT = 0; $('#btn-explode').setAttribute('aria-pressed', 'false');
    const W = app.W = buildWorld(model); scene.add(W.root);
    app.story = Story(W, view); app.labels = LabelLayer(W, view);
    app.inspector = Inspector($('#inspector'), model, { select, close: () => { appEl.dataset.inspector = 'closed'; $('#btn-details').setAttribute('aria-pressed', 'false'); if (!userMoved) frame(false); } });
    app.story.onPhase = i => { const ph = $('#phases'); if (ph) Array.prototype.forEach.call(ph.children, (li, k) => { if (k === i) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current'); }); };
    // shadow frustum and grid sized to this lab
    const box = new THREE.Box3().setFromPoints(W.fit.all()), R = box.getSize(new V3()).length() / 2 + 3, c = box.getCenter(new V3());
    sun.target.position.set(c.x, 0, c.z); sun.position.set(c.x - 15, 27, c.z + 11);
    const sc = sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 90; sc.updateProjectionMatrix();
    grid.uniforms.radius.value = R * 1.9; grid.uniforms.centre.value.set(c.x, c.z);
    app.paint(themeNow());
    appEl.dataset.inspector = 'closed'; $('#btn-details').setAttribute('aria-pressed', 'false');
    buildChrome();
    app.inspector.show(null);
    frame(true);
  }
  app.load = load;

  /* ---- size and the frame loop */
  const octx = ovc.getContext('2d');
  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight), dpr = Math.min(window.devicePixelRatio || 1, 2);
    app.size = { w, h }; app.dpr = dpr;
    if (renderer) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); }
    ovc.width = Math.round(w * dpr); ovc.height = Math.round(h * dpr);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (app.W && !userMoved) frame(true);
  }
  new ResizeObserver(resize).observe(stage);

  // panels that float over the stage: labels are laid out around them
  let chromeCache = null, chromeAt = 0;
  function chromeRects() {
    const now = performance.now();
    if (chromeCache && now - chromeAt < 400) return chromeCache;
    chromeAt = now;
    if (narrow()) return (chromeCache = []);
    const s = stage.getBoundingClientRect();
    chromeCache = ['.masthead', '.legend', '.toolbar', '.inspector', '.caption', '.steps'].map(q => $(q)).filter(n => n && n.offsetParent !== null)
      .map(n => { const r = n.getBoundingClientRect(); return { x: r.left - s.left - 6, y: r.top - s.top - 6, w: r.width + 12, h: r.height + 12 }; });
    return chromeCache;
  }

  let onScreen = true;
  if (window.IntersectionObserver) new IntersectionObserver(es => { onScreen = es[0].isIntersecting; }).observe(stage);

  let last = performance.now();
  function tick(now) {
    if (!onScreen) { last = now; return requestAnimationFrame(tick); }
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (explodeT !== explodeGoal) {
      explodeT = REDUCED_MOTION ? explodeGoal : clamp(explodeT + Math.sign(explodeGoal - explodeT) * dt / 0.7, 0, 1);
      view.explode = ease.inOut(explodeT);
      app.W.layoutColumns(view.explode);
      if (explodeT === explodeGoal && !userMoved) frame(false);
    }
    cam.update(dt);
    app.story.update(dt);
    if (hoverDirty || cam.moved) updateHover();
    cam.moved = false;
    if (renderer) renderer.render(scene, camera);
    octx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
    octx.clearRect(0, 0, app.size.w, app.size.h);
    view.compact = app.size.w < 520;   // phone: names and flows only
    app.labels.draw(octx, camera, app.size.w, app.size.h, view.compact ? 0.9 : 1, PALETTE[app.theme], true, chromeRects());
    requestAnimationFrame(tick);
  }

  resize();
  load(snapshot);
  if (!renderer) { appEl.dataset.inspector = 'open'; app.inspector.show(null); }   // no WebGL: the data is still readable
  requestAnimationFrame(tick);

  // handle for headless renders (docs/lab/visuals) and for debugging
  window.__farm = {
    app, setStep, select, frame,
    explode(on) { explodeGoal = explodeT = on ? 1 : 0; view.explode = explodeGoal; app.W.layoutColumns(view.explode); frame(true); },
    shot(o) { return renderImage(app, Object.assign({}, EXPORTS[o.preset || 'readme'], o)).toDataURL('image/png'); },
    /** Run the animations forward without waiting for frames (headless renders are slow). */
    advance(seconds) { for (let t = 0; t < seconds; t += 0.05) app.story.update(0.05); frame(true); },
    ready: true,
  };
}

(function boot() {
  const snapshot = JSON.parse(document.getElementById('snapshot').textContent);
  const faces = ['600 16px "IBM Plex Sans Condensed"', '500 16px "IBM Plex Sans Condensed"', '400 16px "IBM Plex Mono"', '500 16px "IBM Plex Mono"', '400 16px "IBM Plex Sans"', '600 16px "IBM Plex Sans"'];
  const fonts = document.fonts && document.fonts.load ? Promise.all(faces.map(f => document.fonts.load(f).catch(() => null))) : Promise.resolve();
  Promise.race([fonts, new Promise(r => setTimeout(r, 2500))]).then(() => start(snapshot));
})();
