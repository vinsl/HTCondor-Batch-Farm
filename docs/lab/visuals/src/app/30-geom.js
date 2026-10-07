/* ------------------------------------------------------- geometry helpers */
const FONT = {
  disp: (w, px) => `${w} ${px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`,
  mono: (w, px) => `${w} ${px}px "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace`,
  body: (w, px) => `${w} ${px}px "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif`,
};

function rrShape(w, d, r) {
  const x = -w / 2, y = -d / 2;
  r = Math.max(0.005, Math.min(r, w / 2 - 0.001, d / 2 - 0.001));
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A plate w (x) by d (z), h tall, sitting on y = 0: rounded in plan, chamfered top and bottom. */
function plateGeom(w, h, d, r, bevel) {
  r = r == null ? 0.1 : r;
  bevel = Math.min(bevel == null ? 0.03 : bevel, h / 2 - 0.002);
  const g = new THREE.ExtrudeGeometry(rrShape(w - 2 * bevel, d - 2 * bevel, r - bevel), {
    depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 5, steps: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

/** Outline of a plate's top face, as a closed line. */
function plateOutline(w, h, d, r, bevel, material) {
  r = r == null ? 0.1 : r; bevel = bevel == null ? 0.03 : bevel;
  const pts = rrShape(w - 2 * bevel, d - 2 * bevel, r - bevel).getPoints(5);
  const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new V3(p.x, h + 0.002, -p.y)));
  return new THREE.LineLoop(g, material);
}

/** Polyline with filleted corners, as an arc-length parameterised path. */
function roundedPath(pts, radius) {
  const path = new THREE.CurvePath();
  let prev = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const dIn = p.clone().sub(pts[i - 1]), dOut = pts[i + 1].clone().sub(p);
    const rr = Math.min(radius, dIn.length() / 2, dOut.length() / 2);
    const pIn = p.clone().addScaledVector(dIn.normalize(), -rr);
    const pOut = p.clone().addScaledVector(dOut.normalize(), rr);
    if (prev.distanceTo(pIn) > 1e-4) path.add(new THREE.LineCurve3(prev, pIn));
    path.add(new THREE.QuadraticBezierCurve3(pIn, p.clone(), pOut));
    prev = pOut;
  }
  const last = pts[pts.length - 1].clone();
  if (prev.distanceTo(last) > 1e-4) path.add(new THREE.LineCurve3(prev, last));
  return path;
}

function tubeGeom(curve, radius) {
  const len = curve.getLength();
  return new THREE.TubeGeometry(curve, Math.max(6, Math.ceil(len * 7)), radius, 8, false);
}

/** Cone pointing along a curve at parameter `at` (default: its end); `reverse` points it back along the curve. */
function arrowHead(curve, radius, material, at, reverse) {
  const t = at == null ? 1 : at;
  const g = new THREE.ConeGeometry(radius * 2.6, radius * 7, 14);
  g.translate(0, -radius * 3.5, 0);
  const m = new THREE.Mesh(g, material);
  m.position.copy(curve.getPointAt(t));
  const dir = curve.getTangentAt(clamp(t, 0.001, 0.999)).normalize();
  m.quaternion.setFromUnitVectors(new V3(0, 1, 0), reverse ? dir.negate() : dir);
  return m;
}

/** Repeating dash pattern (opaque / transparent) used as a map on build-time flows. */
let _dashCanvas = null;
function dashTexture(repeat) {
  if (!_dashCanvas) {
    _dashCanvas = document.createElement('canvas'); _dashCanvas.width = 64; _dashCanvas.height = 4;
    const c = _dashCanvas.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, 38, 4);
  }
  const t = new THREE.CanvasTexture(_dashCanvas);
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(repeat, 1);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

/**
 * One line of text printed flat on a surface (or upright on a wall).
 * parts: [{t, f: 'cap' | 'mono' | 'disp', a: alpha}]. Drawn white, tinted by the material colour.
 * Returns a mesh whose origin is the left / centre / right end of the baseline box.
 */
function printedText(parts, unitH, opts) {
  opts = opts || {};
  const px = 72, pad = 10, H = 104;
  const cv = document.createElement('canvas');
  let c = cv.getContext('2d');
  const fontOf = p => (p.f === 'mono' ? FONT.mono(500, px * 0.86) : FONT.disp(600, px));
  const track = p => (p.f === 'cap' ? px * 0.085 : 0);
  const str = p => (p.f === 'cap' ? String(p.t).toUpperCase() : String(p.t));
  const widthOf = p => {
    c.font = fontOf(p);
    const s = str(p);
    return track(p) ? Array.from(s).reduce((a, ch) => a + c.measureText(ch).width + track(p), 0) : c.measureText(s).width;
  };
  const gap = px * 0.34;
  const total = parts.reduce((a, p) => a + widthOf(p), 0) + gap * (parts.length - 1);
  cv.width = Math.min(4096, Math.ceil(total + pad * 2)); cv.height = H;
  c = cv.getContext('2d');
  c.textBaseline = 'alphabetic'; c.fillStyle = '#fff';
  let x = pad;
  for (const p of parts) {
    c.font = fontOf(p); c.globalAlpha = p.a == null ? 1 : p.a;
    const s = str(p);
    if (track(p)) { for (const ch of Array.from(s)) { c.fillText(ch, x, H * 0.72); x += c.measureText(ch).width + track(p); } }
    else { c.fillText(s, x, H * 0.72); x += c.measureText(s).width; }
    x += gap;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 16;
  const w = (cv.width / px) * unitH, h = (cv.height / px) * unitH;
  const g = new THREE.PlaneGeometry(w, h);
  const ax = opts.align === 'right' ? -w / 2 : opts.align === 'center' ? 0 : w / 2;
  g.translate(ax, 0, 0);
  if (!opts.upright) g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, opts.material);
  m.material.map = tex; m.material.needsUpdate = true;
  m.userData.span = [ax - w / 2, ax + w / 2, h * 0.5];   // local x extent and text height, for label avoidance
  return m;
}

/** Drafting-table grid under the model: world-space lines, anti-aliased in the shader, fading out with distance. */
function gridMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    extensions: { derivatives: true },
    uniforms: { color: { value: new THREE.Color() }, alpha: { value: 1 }, radius: { value: 46 }, px: { value: 1 }, centre: { value: new THREE.Vector2(0, 3) } },
    vertexShader: 'varying vec3 vPos; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: [
      'varying vec3 vPos; uniform vec3 color; uniform float alpha; uniform float radius; uniform float px; uniform vec2 centre;',
      'float grid(vec2 c){ vec2 g = abs(fract(c - 0.5) - 0.5) / (fwidth(c) * px); return 1.0 - min(min(g.x, g.y), 1.0); }',
      'void main(){',
      '  vec2 c = vPos.xz;',
      '  float a = grid(c) * 0.55 + grid(c / 5.0) * 0.75;',
      '  float fade = 1.0 - smoothstep(radius * 0.3, radius, length(c - centre));',
      '  gl_FragColor = vec4(color, clamp(a, 0.0, 1.0) * alpha * fade);',
      '}',
    ].join('\n'),
  });
}
