/* ---------------------------------------------------------------- utilities */
const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = {
  out: t => 1 - Math.pow(1 - t, 3),
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: t => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Colours are authored in sRGB; three.js r128 lights in linear space. */
const srgb = hex => new THREE.Color(hex).convertSRGBToLinear();

/** Tiny DOM builder: el('div', {class:'x', onclick}, child, 'text', [more]) */
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') { for (const p in v) { if (p.startsWith('--')) n.style.setProperty(p, v[p]); else n.style[p] = v[p]; } }
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  const add = c => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return n;
}
const $ = (sel, root) => (root || document).querySelector(sel);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const fmt = {
  utc(iso) {
    if (!iso) return 'n/a';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  },
  time(iso) { const d = new Date(iso); return isNaN(d) ? String(iso || '') : d.toISOString().slice(11, 19) + ' UTC'; },
  /** "Wed 2026-10-07 09:24:08 UTC" -> "09:24:08" */
  since(s) { const m = /(\d\d:\d\d:\d\d)/.exec(s || ''); return m ? m[1] : (s || ''); },
  yesno(b) { return b === true ? 'yes' : b === false ? 'no' : 'n/a'; },
  ports(p) { if (!p) return 'all'; const [a, b] = String(p).split('-'); return a === b || !b ? a : p; },
};
