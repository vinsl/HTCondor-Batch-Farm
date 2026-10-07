/* --------------------------------- screen-space labels, drawn on a 2D canvas */
/* Drawn with the canvas API rather than DOM so that a PNG export contains exactly what is on screen. */
function LabelLayer(W, view) {
  const mctx = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  const textW = (font, s) => {
    const key = font + '\u0001' + s;
    let w = cache.get(key);
    if (w === undefined) { mctx.font = font; w = mctx.measureText(s).width; cache.set(key, w); }
    return w;
  };
  const val = (v, l) => (typeof v === 'function' ? v(view.step, l && l.node && view.nodeHealth ? view.nodeHealth(l.node) : undefined) : v);
  const lum = hex => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };

  function worldPos(l) {
    if (l.curve) { const cv = [].concat(l.curve() || [])[0]; return cv ? cv.getPointAt(l.ts[0]) : null; }
    if (l.kind === 'tag' && l.node && W.nodes[l.node]) return W.nodeTop(l.node);
    return W.resolve(l.anchor);
  }
  function visible(l, camera, wp) {
    if (view.labels === 'off') return false;
    if (l.hidden && l.hidden()) return false;
    if (view.step > 0 && l.since && l.since > view.step) return false;
    if (l.flow && !view.flowShown(l.flow)) return false;
    if (l.steps && l.steps.indexOf(view.step) < 0) return false;
    if (view.compact && l.kind === 'note' && l.level !== 2 && l.id !== 'heal') return false;   // phone: names and flows only
    if (l.level !== 2) return true;
    const sel = !!(l.node && view.selected && view.selected.kind === 'node' && view.selected.id === l.node);
    if (l.storyOnly && l.storyOnly === view.step) return true;
    // exploded: the shared layers are named once, on the central manager; every machine names its own daemons
    const first = l.node === W.model.cm.name;
    if (l.exploded) return sel || view.labels === 'all' || (view.explode > 0.5 && first);
    if (view.labels === 'all' || sel) return true;
    if (view.explode > 0.5) return l.side === 'up' || first;
    return camera.position.distanceTo(wp) < 19;
  }

  function shape(l, sx, sy, k, alts) {
    const s = { l, sx, sy };
    if (l.kind === 'tag') {
      s.fTitle = FONT.disp(600, 15 * k); s.fLine = FONT.mono(400, 10.5 * k);
      s.title = val(l.title); s.lines = view.compact ? [] : (val(l.lines, l) || []).filter(Boolean); s.health = val(l.health, l);
      const extra = (l.color ? 15 * k : 0) + (s.health != null ? 15 * k : 0);
      s.w = Math.max(textW(s.fTitle, s.title) + extra, ...s.lines.map(t => textW(s.fLine, t))) + 18 * k;
      s.h = (s.lines.length ? 12 : 9) * k + 18 * k + s.lines.length * 13.5 * k;
      const above = [16, 34, 54].map(d => [sx - s.w / 2, sy - d * k - s.h]);
      const right = [[sx + 30 * k, sy - s.h * 0.4], [sx + 22 * k, sy - s.h - 8 * k], [sx + 30 * k, sy + 10 * k]];
      const left = [[sx - s.w - 30 * k, sy - s.h * 0.4], [sx - s.w - 22 * k, sy - s.h - 8 * k], [sx - s.w - 30 * k, sy + 10 * k]];
      // a tag sits above its object unless it asks for a side (two neighbours then open away from each other)
      s.cands = l.prefer === 'left' ? left.concat(above, right) : l.prefer === 'right' ? right.concat(above, left) : above.concat([right[1], left[1], right[0], left[0], [sx - s.w / 2, sy - 78 * k - s.h], right[2], left[2]]);
    } else if (l.kind === 'chip') {
      s.font = FONT.mono(500, 10.5 * k); s.text = val(l.text);
      s.w = textW(s.font, s.text) + 16 * k; s.h = 19 * k;
      s.cands = [];
      for (const dy of [0, -24, 24, -48]) for (const a of alts || [[sx, sy]]) s.cands.push([a[0] - s.w / 2, a[1] - s.h / 2 + dy * k]);
    } else {
      s.font = l.mono ? FONT.mono(500, 11 * k) : FONT.disp(500, 12.5 * k); s.text = val(l.text);
      s.w = textW(s.font, s.text) + 4 * k; s.h = 15 * k;
      const c = {
        up: [sx - s.w / 2, sy - 11 * k - s.h], down: [sx - s.w / 2, sy + 9 * k],
        left: [sx - 13 * k - s.w, sy - s.h / 2], right: [sx + 13 * k, sy - s.h / 2],
      };
      const order = { up: ['up', 'right', 'left'], down: ['down', 'right', 'left'], left: ['left', 'up', 'down'], right: ['right', 'up', 'down'] }[l.side || 'up'];
      s.cands = order.map(n => c[n]).concat(l.side === 'up' || !l.side ? [[sx - s.w / 2, sy - 28 * k - s.h]] : []);
    }
    return s;
  }

  function layout(camera, vw, vh, k, reserved) {
    const shapes = [], q = new V3();
    for (const l of W.labels.concat(view.extraLabels || [])) {
      const wp = worldPos(l);
      if (!wp || !visible(l, camera, wp)) continue;
      q.copy(wp).project(camera);
      if (q.z > 1 || q.z < -1) continue;
      const sx = (q.x * 0.5 + 0.5) * vw, sy = (-q.y * 0.5 + 0.5) * vh;
      if (sx < 0 || sx > vw || sy < 0 || sy > vh) continue;   // a label never stands in for something off screen
      let alts = [[sx, sy]];
      if (l.curve) {   // a flow's chip may sit anywhere along any of its curves
        alts = [];
        for (const cv of [].concat(l.curve())) for (const t of l.ts) { q.copy(cv.getPointAt(t)).project(camera); alts.push([(q.x * 0.5 + 0.5) * vw, (-q.y * 0.5 + 0.5) * vh]); }
      }
      shapes.push(shape(l, sx, sy, k, alts));
    }
    shapes.sort((a, b) => (b.l.prio || 0) - (a.l.prio || 0));
    // text printed on the model: labels keep off it when they have somewhere else to go
    const printed = [];
    for (const t of W.printed) {
      let on = true; for (let o = t; o; o = o.parent) if (!o.visible) { on = false; break; }
      if (!on) continue;
      const sp = t.userData.span, n = Math.max(2, Math.ceil((sp[1] - sp[0]) / (sp[2] * 1.5)));
      for (let i = 0; i <= n; i++) {
        q.set(lerp(sp[0], sp[1], i / n), 0, 0); t.localToWorld(q).project(camera);
        if (q.z < 1) printed.push({ x: (q.x * 0.5 + 0.5) * vw - 7 * k, y: (-q.y * 0.5 + 0.5) * vh - 7 * k, w: 14 * k, h: 14 * k });
      }
    }
    const placed = (reserved || []).slice(), m = 3 * k, nReserved = placed.length;
    const hitsAny = (list, x, y, w, h, g) => list.some(p => x < p.x + p.w + g && x + w + g > p.x && y < p.y + p.h + g && y + h + g > p.y);
    const free = (x, y, w, h, strict) => !hitsAny(placed, x, y, w, h, m) && !(strict && hitsAny(printed, x, y, w, h, 0));
    for (const s of shapes) {
      let spot = null;
      for (const strict of [true, false]) {
        for (const c of s.cands) {
          const x = clamp(c[0], 4 * k, Math.max(4 * k, vw - s.w - 4 * k)), y = clamp(c[1], 4 * k, Math.max(4 * k, vh - s.h - 4 * k));
          if (free(x, y, s.w, s.h, strict)) { spot = [x, y]; break; }
        }
        if (spot) break;
      }
      if (!spot) { if (s.l.kind !== 'tag') continue; spot = [clamp(s.cands[0][0], 4 * k, vw - s.w - 4 * k), clamp(s.cands[0][1], 4 * k, vh - s.h - 4 * k)]; }
      s.x = spot[0]; s.y = spot[1];
      placed.push(s);
    }
    return placed.slice(nReserved);
  }

  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  /** Draw every label for `camera` into ctx (vw x vh canvas units); k scales type for exports; `reserved` are rectangles to keep clear. */
  function draw(c, camera, vw, vh, k, P, store, reserved) {
    const L = P.label, placed = layout(camera, vw, vh, k, reserved);
    const samePick = (a, b) => a && b && a.kind === b.kind && a.id === b.id;
    c.save(); c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
    // leaders first, so that boxes sit on top of them
    for (const s of placed) {
      if (s.l.kind === 'chip') continue;
      const cx = clamp(s.sx, s.x + 4 * k, s.x + s.w - 4 * k), cy = s.sy < s.y ? s.y : s.sy > s.y + s.h ? s.y + s.h : s.sy;
      const ex = s.sx < s.x ? s.x : s.sx > s.x + s.w ? s.x + s.w : cx;
      c.strokeStyle = L.leader; c.lineWidth = 1 * k; c.beginPath(); c.moveTo(s.sx, s.sy); c.lineTo(ex, cy); c.stroke();
      c.fillStyle = L.leader; c.beginPath(); c.arc(s.sx, s.sy, 1.8 * k, 0, 7); c.fill();
    }
    for (const s of placed) {
      const l = s.l, hot = samePick(l.pick, view.hover) || samePick(l.pick, view.selected);
      if (l.kind === 'tag') {
        rr(c, s.x, s.y, s.w, s.h, 5 * k);
        c.fillStyle = L.card; c.fill();
        c.lineWidth = (hot ? 1.6 : 1) * k; c.strokeStyle = hot ? L.text : L.border;
        if (l.ghost) c.setLineDash([4 * k, 3 * k]);
        c.stroke(); c.setLineDash([]);
        let tx = s.x + 9 * k; const ty = s.y + (s.lines.length ? 6 : 4.5) * k + 14 * k;
        if (l.color) { c.fillStyle = P[l.color]; rr(c, tx, ty - 9.5 * k, 9 * k, 9 * k, 2 * k); c.fill(); tx += 15 * k; }
        c.font = s.fTitle; c.fillStyle = l.ghost ? L.sub : L.text; c.fillText(s.title, tx, ty);
        const h = s.health;
        if (h != null) { c.fillStyle = h ? P.ok : P.bad; c.beginPath(); c.arc(s.x + s.w - 13 * k, ty - 5 * k, 4 * k, 0, 7); c.fill(); }
        c.font = s.fLine; c.fillStyle = L.sub;
        s.lines.forEach((t, i) => c.fillText(t, s.x + 9 * k, ty + (i + 1) * 13.5 * k + 1 * k));
      } else if (l.kind === 'chip') {
        const bg = P[l.color] || P.out;
        rr(c, s.x, s.y, s.w, s.h, s.h / 2); c.fillStyle = bg; c.fill();
        if (hot) { c.lineWidth = 1.6 * k; c.strokeStyle = L.text; c.stroke(); }
        c.font = s.font; c.fillStyle = lum(bg) > 0.42 ? '#141C2E' : '#FFFFFF';
        c.fillText(s.text, s.x + 8 * k, s.y + s.h / 2 + 3.7 * k);
      } else {
        c.font = s.font; c.lineWidth = 3.6 * k; c.strokeStyle = L.halo;
        c.strokeText(s.text, s.x + 2 * k, s.y + 11.5 * k);
        c.fillStyle = l.tone ? P[val(l.tone)] : (hot ? L.text : L.sub); c.fillText(s.text, s.x + 2 * k, s.y + 11.5 * k);
      }
    }
    c.restore();
    if (store) hits = placed.filter(s => s.l.pick).map(s => ({ x: s.x, y: s.y, w: s.w, h: s.h, pick: s.l.pick }));
  }
  let hits = [];
  const hit = (x, y) => { for (const h of hits) if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.pick; return null; };
  return { draw, hit };
}
