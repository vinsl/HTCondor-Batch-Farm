#!/usr/bin/env node
// Headless renders of the 3D view: the same images as the page's "Export PNG" button, from the command line.
//
//   npm install --no-save playwright && npx playwright install chromium     (once)
//   node render.mjs                                  -> hero-light.png hero-dark.png linkedin-light.png linkedin-dark.png
//   node render.mjs --presets readme --themes light  -> hero-light.png
//   node render.mjs --snapshot ../snapshots/02-scaled-out/snapshot.json --out /tmp/shots
//
// Options: --page FILE (default ./index.html)  --out DIR (default: next to the page)
//          --presets readme,linkedin,square     --themes light,dark
//          --snapshot FILE  render another snapshot without rebuilding the page
//          --step N         story step 0-6 (default 0, the snapshot at rest)   --explode
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const page = path.resolve(opt('page', path.join(here, 'index.html')));
const out = path.resolve(opt('out', path.dirname(page)));
const presets = opt('presets', 'readme,linkedin').split(',');
const themes = opt('themes', 'light,dark').split(',');
const snapshot = opt('snapshot', null);
const step = Number(opt('step', 0));
const FILES = { readme: 'hero', linkedin: 'linkedin', square: 'square' };

// A software GL is enough: no GPU is needed, so this also runs in a Codespace or in CI.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const tab = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
tab.on('pageerror', e => console.error('page error:', e.message));
await tab.goto(pathToFileURL(page).href);
await tab.waitForFunction(() => window.__farm && window.__farm.ready, null, { timeout: 30000 });
if (!(await tab.evaluate(() => !!window.__farm.app.renderer))) { console.error('WebGL is not available in this browser.'); process.exit(1); }
if (snapshot) await tab.evaluate(s => window.__farm.app.load(s), JSON.parse(fs.readFileSync(snapshot, 'utf8')));
if (step) await tab.evaluate(n => { window.__farm.setStep(n); window.__farm.advance(6); }, step);
if (args.includes('--explode')) await tab.evaluate(() => window.__farm.explode(true));

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { /* optional: only used to make the files smaller */ }
fs.mkdirSync(out, { recursive: true });
for (const preset of presets) for (const theme of themes) {
  const url = await tab.evaluate(o => window.__farm.shot(o), { preset, theme });
  const file = path.join(out, `${FILES[preset] || preset}-${theme}.png`);
  const png = Buffer.from(url.split(',')[1], 'base64');
  fs.writeFileSync(file, sharp ? await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toBuffer() : png);
  console.log(`${path.relative(process.cwd(), file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
await browser.close();
