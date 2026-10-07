/* ------------------------------------------------------------ PNG export */
/* Renders the 3D view at an exact size, then draws labels, legend and caption on top with the canvas API,
   so the image is the same whether it comes from the button or from a headless render. */
const EXPORTS = {
  readme: { w: 2400, h: 1350, file: 'hero', view: 'hero', title: false },
  linkedin: { w: 2400, h: 1256, file: 'linkedin', view: 'hero', title: true, compact: true, phi: 1.08 },
  square: { w: 2160, h: 2160, file: 'square', view: 'hero', title: true, compact: true, theta: -1.0, phi: 0.9 },
  current: { file: 'view', view: 'current', title: false },
};

function renderImage(app, o) {
  const { renderer, scene, camera, W, labels, view, model } = app;
  const P = PALETTE[o.theme || app.theme], L = P.label;
  const cssW = app.size.w, cssH = app.size.h;
  let w = o.w, h = o.h;
  if (!w) { w = 2400; h = Math.round((2400 * cssH) / cssW); }
  const k = w / 1280;                                  // type scale: legible once the image is shown ~1000 px wide
  const m = 0.03 * w, dot = '  ·  ', f = model.facts;
  const gl = renderer.getContext();
  const ss = Math.max(w, h) * 2 <= Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 6000) ? 2 : 1;

  // --- the text around the picture, measured first so that the model and its labels keep clear of it
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.textBaseline = 'alphabetic';
  const lines = [];                                    // [{y, parts: [[text, font, colour]]}]
  let y = m + 11 * k;
  const facts = [plural(f.machines, 'machine'), f.healthKnown ? `${f.healthySlots} of ${plural(f.slots, 'slot')} healthy` : plural(f.slots, 'slot'),
    `${plural(f.completed, 'job')} completed`, `${plural(f.changed, 'resource')} changed at the last run`].join(dot);
  if (o.title) {
    lines.push({ y, parts: [[`LAB SNAPSHOT · ${String(model.milestone).toUpperCase()}`, FONT.mono(500, 12.5 * k), L.sub]] });
    y += 44 * k; lines.push({ y, parts: [[CONTEXT.project, FONT.disp(600, 40 * k), L.text]] });
    y += 27 * k; lines.push({ y, parts: [['OpenTofu', 'tofu'], [' provisions, ', null], ['Ansible', 'ansible'], [' bootstraps, ', null], ['OpenVox', 'vox'], [' configures, ', null], ['HTCondor', 'condor'], [' schedules.', null]]
      .map(s => [s[0], FONT.body(s[1] ? 600 : 400, 15.5 * k), s[1] ? P[s[1]] : L.sub]) });
    y += 23 * k;
  }
  lines.push({ y, parts: [[facts, FONT.mono(500, 12 * k), o.title ? L.sub : L.text]] });
  const reserved = lines.map(ln => { const tw = ln.parts.reduce((a, p) => { c.font = p[1]; return a + c.measureText(p[0]).width; }, 0); return { x: 0, y: ln.y - 40 * k, w: m + tw + 12 * k, h: 48 * k }; });
  reserved.push({ x: 0, y: h - m - 26 * k, w, h: m + 26 * k });
  const top = (y + 12 * k) / h;

  // --- save the live view, then set up the shot
  const saved = { theme: app.theme, aspect: camera.aspect, pos: camera.position.clone(), quat: camera.quaternion.clone(), pr: renderer.getPixelRatio(), labels: view.labels, hover: view.hover, compact: view.compact };
  if (o.theme && o.theme !== app.theme) app.paint(o.theme);
  if (o.labels) view.labels = o.labels;
  view.hover = null; view.compact = !!o.compact;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (o.view !== 'current') {
    // labels are larger, relative to the model, than on screen: leave them head room
    const pad = Object.assign({ l: 0.03, r: 0.03, t: (o.title ? top : 0.035) + (o.compact ? 0.03 : 0.065), b: 0.085 }, o.pad);
    const v = fitView(W.fit[o.box || 'all'](), o.theta != null ? o.theta : app.HERO.theta, o.phi != null ? o.phi : app.HERO.phi, w / h, pad);
    const sp = Math.sin(v.phi);
    camera.position.set(v.target.x + v.dist * sp * Math.sin(v.theta), v.target.y + v.dist * Math.cos(v.phi), v.target.z + v.dist * sp * Math.cos(v.theta));
    camera.lookAt(v.target);
  }
  camera.updateMatrixWorld(true);
  renderer.setPixelRatio(1); renderer.setSize(w * ss, h * ss, false);
  app.grid.uniforms.px.value = ss * k * 0.8;
  renderer.render(scene, camera);

  // --- compose: ground, model, labels, text
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, P.bg[0]); g.addColorStop(1, P.bg[1]);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(renderer.domElement, 0, 0, w, h);
  labels.draw(c, camera, w, h, k, P, false, reserved);
  c.textBaseline = 'alphabetic';
  for (const ln of lines) { let x = m; for (const p of ln.parts) { c.font = p[1]; c.fillStyle = p[2]; c.fillText(p[0], x, ln.y); x += c.measureText(p[0]).width; } }
  // legend, bottom left
  let x = m; const yb = h - m;
  FLOWS.forEach(fl => {
    if (!view.flowShown(fl.id)) return;
    c.strokeStyle = P[fl.key]; c.lineWidth = 3.4 * k; c.lineCap = 'butt';
    c.setLineDash(fl.buildTime ? [6 * k, 4 * k] : []);
    c.beginPath(); c.moveTo(x, yb - 4.5 * k); c.lineTo(x + 24 * k, yb - 4.5 * k); c.stroke(); c.setLineDash([]);
    x += 31 * k;
    c.font = FONT.disp(600, 13.5 * k); c.fillStyle = L.text; c.fillText(fl.name, x, yb); x += c.measureText(fl.name).width + 6 * k;
    c.font = FONT.mono(400, 11.5 * k); c.fillStyle = L.sub; c.fillText(fl.what, x, yb); x += c.measureText(fl.what).width + 20 * k;
  });
  // provenance, bottom right (dropped if the legend needs the room)
  const prov = `snapshot ${model.milestone}${dot}${fmt.utc(model.captured)}${dot}commit ${model.git.commit || 'n/a'}`;
  c.font = FONT.mono(400, 11.5 * k); c.fillStyle = L.sub;
  if (x + c.measureText(prov).width < w - m) { c.textAlign = 'right'; c.fillText(prov, w - m, yb); c.textAlign = 'left'; }

  // --- restore the live view
  view.labels = saved.labels; view.hover = saved.hover; view.compact = saved.compact;
  if (app.theme !== saved.theme) app.paint(saved.theme);
  camera.aspect = saved.aspect; camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  app.grid.uniforms.px.value = 1;
  renderer.setPixelRatio(saved.pr); renderer.setSize(cssW, cssH, false);
  renderer.render(scene, camera);
  return cv;
}

/** Hand a blob to the viewer: claude.ai's save prompt inside an artifact, a plain download anywhere else. */
async function saveBlob(blob, filename) {
  if (window.claude && typeof window.claude.use === 'function') {
    let dl = null;
    try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
    if (!dl) return 'preview';
    try { await dl.save({ filename, data: blob }); return 'saved'; }
    catch (e) { return e && e.code === 'declined' ? 'declined' : 'preview'; }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}
