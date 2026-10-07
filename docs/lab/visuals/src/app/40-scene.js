/* ------------------------------------------------ model -> 3D scene graph */
const DIM = {
  MS: 1.14,                  // machines are modelled in their own units, then scaled by MS
  NW: 2.6, ND: 2.6,          // footprint of a node's software stack (machine units)
  SW: 1.9, COLGAP: 0.3,      // the OpenVox server module docked on the central manager
  PALLET_W: 0.95, PALLET_D: 1.26, PALLET_GAP: 0.4, CELLGAP: 1.3,
  SLAB: 0.22, FENCE_H: 0.9, FENCE_SIDE: 0.95, MIN_WIDTH: 21.5,
  H: { chassis: 0.4, os: 0.34, agent: 0.28, base: 0.4, condor: 0.4, server: 0.95, block: 0.5 },
  GAP: 0.05, EXPLODE: 0.6,
  LANE_SSH: 2.6, LANE_OUT: 3.3, FENCE_F: 4.3, FENCE_B: -2.55, GATE_X: 0.5,
  FRONT: [1.35, 1.45, 1.45], SIDE: [0.75, 0.75, 0.75],
};

function buildWorld(model) {
  const D = DIM, H = D.H;
  const W = {
    model, root: new THREE.Group(), mats: [], picks: [], labels: [], columns: [], items: [], appear: [],
    flows: {}, leds: {}, anchors: {}, nodes: {}, onTheme: [], dashed: [], printed: [], explode: 0,
  };

  /* ---- materials: every colour goes through the registry so a theme switch can repaint */
  const reg = (m, key, alphaKey) => { W.mats.push({ m, key, alphaKey }); return m; };
  const std = (key, o) => reg(new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.82, metalness: 0 }, o)), key);
  const flat = (key, o, alphaKey) => reg(new THREE.MeshBasicMaterial(o || {}), key, alphaKey);
  W.inkMat = reg(new THREE.LineBasicMaterial({ transparent: true }), 'ink', 'inkAlpha');
  const printMat = () => flat('ink', { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'printAlpha');

  const pickable = (mesh, pick) => { mesh.userData.pick = pick; W.picks.push(mesh); return mesh; };
  function plate(parent, o) {
    const m = new THREE.Mesh(plateGeom(o.w, o.h, o.d, o.r, o.bevel), o.mat || std(o.key));
    m.position.set(o.x || 0, o.y || 0, o.z || 0);
    m.castShadow = o.shadow !== false; m.receiveShadow = true;
    if (o.outline !== false) m.add(plateOutline(o.w, o.h, o.d, o.r, o.bevel, W.inkMat));
    if (o.pick) pickable(m, o.pick);
    parent.add(m);
    return m;
  }
  function box(parent, w, h, d, x, y, z, mat, pick) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (pick) pickable(m, pick);
    parent.add(m);
    return m;
  }
  /** Things that drop into place when the story reaches the step that creates them. */
  let order = 0;
  const appearable = (obj, since, mode) => { const a = { obj, since, mode: mode || 'drop', t: 1, shown: true, order: order++, y0: obj.position.y }; W.appear.push(a); return a; };
  const anchor = (id, obj, x, y, z) => { W.anchors[id] = { obj, p: new V3(x, y, z) }; };
  const label = l => { W.labels.push(l); return l; };

  /* ---------------------------------------------------------------- layout */
  const { cm, workers, ghosts } = model;
  const cells = [];
  let x = 0;
  const MS = D.MS, nw = D.NW * MS;
  const cmCell = { m: cm, x: x + nw / 2, srvX: x + (D.NW + D.COLGAP + D.SW / 2) * MS, x0: x, x1: x + (D.NW + D.COLGAP + D.SW) * MS };
  x = cmCell.x1 + D.CELLGAP;
  const workerCell = (m, ghost) => {
    // a destroyed worker keeps its footprint, with its few jobs inside it
    const lead = ghost ? 0 : D.PALLET_W + D.PALLET_GAP;
    const c = { m, ghost, palletX: ghost ? x + nw / 2 : x + D.PALLET_W / 2, x: x + lead + nw / 2, x0: x, x1: x + lead + nw };
    x = c.x1 + D.CELLGAP;
    return c;
  };
  workers.forEach(m => cells.push(workerCell(m, false)));
  ghosts.forEach(name => cells.push(workerCell({ name, role: 'execute', node: {} }, true)));
  const used = x - D.CELLGAP, total = Math.max(used, D.MIN_WIDTH), shift = -used / 2;   // a small lab still gets a floor wide enough for the printed titles
  [cmCell].concat(cells).forEach(c => { for (const k of ['x', 'srvX', 'x0', 'x1', 'palletX']) if (c[k] != null) c[k] += shift; });

  const fence = { x0: -total / 2 - D.FENCE_SIDE, x1: total / 2 + D.FENCE_SIDE, z0: D.FENCE_B, z1: D.FENCE_F };
  const grow = (b, s, f) => ({ x0: b.x0 - s, x1: b.x1 + s, z0: b.z0 - s, z1: b.z1 + f });
  const subnet = grow(fence, D.SIDE[0], D.FRONT[0]);
  const vpc = grow(subnet, D.SIDE[1], D.FRONT[1]);
  const region = grow(vpc, D.SIDE[2], D.FRONT[2]);
  const yRegion = D.SLAB, yVpc = D.SLAB * 2, yFloor = D.SLAB * 3;
  const wsX = fence.x0 * 0.8, exX = fence.x1 * 0.86, outerZ = region.z1 + 3.5;
  W.layout = { fence, subnet, vpc, region, yFloor, wsX, exX, outerZ, cmCell, cells };

  /* ----------------------------------------------- region / VPC / subnet */
  const net = model.net, infra = model.infra;
  function slab(b, y, key, pick) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const g = new THREE.Group(); g.position.set((b.x0 + b.x1) / 2, y, (b.z0 + b.z1) / 2);
    plate(g, { w, h: D.SLAB, d, r: 0.32, bevel: 0.035, key, pick });
    W.root.add(g); appearable(g, 1);
    return g;
  }
  function printOn(parent, parts, unitH, lx, ly, lz, align) {
    const m = printedText(parts, unitH, { material: printMat(), align });
    m.position.set(lx, ly + 0.006, lz);
    parent.add(m); W.printed.push(m);
    return m;
  }
  const gRegion = slab(region, 0, 'region', { kind: 'net', part: 'region' });
  const gVpc = slab(vpc, yRegion, 'vpc', { kind: 'net', part: 'vpc' });
  const gSubnet = slab(subnet, yVpc, 'subnet', { kind: 'net', part: 'subnet' });
  // Titles printed on the front terraces, like the legend strip of a drawing
  const terrace = (b, inner) => ({ zc: (inner.z1 + b.z1) / 2 - (b.z0 + b.z1) / 2, x0: -(b.x0 + b.x1) / 2 });
  const TITLE = 0.52, SMALL = 0.36, titleX = 1.9;   // titles start just right of the gateway, at the same x on every terrace
  const tR = terrace(region, vpc), tV = terrace(vpc, subnet), tS = terrace(subnet, fence);
  printOn(gRegion, [{ t: 'AWS region', f: 'cap' }, { t: infra.region || '', f: 'mono' }], TITLE, tR.x0 + titleX, D.SLAB, tR.zc);
  if (infra.image && infra.image.name) printOn(gRegion, [{ t: 'image', f: 'cap', a: 0.75 }, { t: infra.image.name, f: 'mono', a: 0.75 }], SMALL, tR.x0 - titleX, D.SLAB, tR.zc, 'right');
  printOn(gVpc, [{ t: 'VPC', f: 'cap' }, { t: net.vpc_cidr || '', f: 'mono' }], TITLE, tV.x0 + titleX, D.SLAB, tV.zc);
  if (net.internet_gateway) printOn(gVpc, [{ t: 'route', f: 'cap', a: 0.75 }, { t: (net.routes || []).join(', ') + ' → internet gateway', f: 'mono', a: 0.75 }], SMALL, tV.x0 - titleX, D.SLAB, tV.zc, 'right');
  const sn = net.subnet || {};
  printOn(gSubnet, [{ t: (sn.public_ip_on_launch ? 'public ' : '') + 'subnet', f: 'cap' }, { t: [sn.cidr, sn.availability_zone].filter(Boolean).join(' · '), f: 'mono' }], TITLE, tS.x0 + titleX, D.SLAB, tS.zc);

  /* ---------------------------------------------------- security group */
  const gFence = new THREE.Group(); gFence.position.y = yFloor; W.root.add(gFence); appearable(gFence, 1);
  const glass = flat('glass', { transparent: true, depthWrite: false, side: THREE.DoubleSide }, 'glassAlpha');
  const railMat = flat('rail');
  const sgPick = { kind: 'sg' };
  function fenceRun(xa, za, xb, zb) {
    const len = Math.hypot(xb - xa, zb - za), along = Math.abs(xb - xa) > Math.abs(zb - za);
    const cx = (xa + xb) / 2, cz = (za + zb) / 2;
    box(gFence, along ? len : 0.02, D.FENCE_H, along ? 0.02 : len, cx, D.FENCE_H / 2, cz, glass, sgPick).renderOrder = 2;
    box(gFence, along ? len : 0.05, 0.05, along ? 0.05 : len, cx, D.FENCE_H, cz, railMat);
  }
  const post = (px, pz) => box(gFence, 0.09, D.FENCE_H + 0.08, 0.09, px, (D.FENCE_H + 0.08) / 2, pz, railMat);
  const gate = D.GATE_X + 0.42;
  fenceRun(fence.x0, fence.z0, fence.x1, fence.z0);
  fenceRun(fence.x0, fence.z0, fence.x0, fence.z1);
  fenceRun(fence.x1, fence.z0, fence.x1, fence.z1);
  fenceRun(fence.x0, fence.z1, -gate, fence.z1);
  fenceRun(gate, fence.z1, fence.x1, fence.z1);
  [[fence.x0, fence.z0], [fence.x1, fence.z0], [fence.x0, fence.z1], [fence.x1, fence.z1], [-gate, fence.z1], [0, fence.z1], [gate, fence.z1]].forEach(p => post(p[0], p[1]));
  const members = model.rules.filter(r => r.direction === 'inbound' && /^members/.test(r.peer || '')).map(r => fmt.ports(r.ports)).sort();
  const sgText = printedText([{ t: 'security group', f: 'cap' }, { t: model.sgName, f: 'mono' }], 0.4, { material: printMat(), upright: true });
  sgText.position.set(fence.x0 + 0.5, 0.46, fence.z1 + 0.02); gFence.add(sgText); W.printed.push(sgText);
  if (members.length) {
    const t2 = printedText([{ t: 'members only', f: 'cap', a: 0.8 }, { t: members.join(', '), f: 'mono', a: 0.8 }], 0.34, { material: printMat(), upright: true, align: 'right' });
    t2.position.set(fence.x1 - 0.5, 0.46, fence.z1 + 0.02); gFence.add(t2); W.printed.push(t2);
  }
  anchor('gate22', gFence, -D.GATE_X, D.FENCE_H + 0.1, fence.z1);
  anchor('gateOut', gFence, D.GATE_X, D.FENCE_H + 0.1, fence.z1);

  /* ---------------------------------------------------- internet gateway */
  const hasIgw = !!net.internet_gateway;
  const gIgw = new THREE.Group(); gIgw.position.set(0, yRegion, vpc.z1); W.root.add(gIgw); appearable(gIgw, 1);
  if (hasIgw) {
    const igwPick = { kind: 'net', part: 'igw' };
    plate(gIgw, { w: 0.26, h: 1.3, d: 0.6, r: 0.05, key: 'steel', x: -1.08, pick: igwPick });
    plate(gIgw, { w: 0.26, h: 1.3, d: 0.6, r: 0.05, key: 'steel', x: 1.08, pick: igwPick });
    plate(gIgw, { w: 2.5, h: 0.24, d: 0.66, r: 0.05, key: 'steel', y: 1.3, pick: igwPick });
    anchor('igw', gIgw, 0, 1.6, 0);
    label({ id: 'igw', kind: 'note', anchor: 'igw', text: 'internet gateway', level: 1, prio: 4, pick: igwPick, since: 1 });
  }

  /* ------------------------------------------- workspace and the internet */
  const gWs = new THREE.Group(); gWs.position.set(wsX, 0, outerZ); W.root.add(gWs);
  const wsPick = { kind: 'workspace' };
  plate(gWs, { w: 5.6, h: 0.2, d: 3.6, r: 0.3, key: 'pad', pick: wsPick });
  printOn(gWs, [{ t: 'workspace', f: 'cap' }], 0.46, -2.4, 0.2, 0.72);
  printOn(gWs, [{ t: CONTEXT.workspace, f: 'mono', a: 0.8 }], 0.36, -2.4, 0.2, 1.3);
  const tofuBlock = plate(gWs, { w: 1.3, h: 1.05, d: 1.3, r: 0.15, bevel: 0.05, key: 'tofu', x: -1.3, y: 0.2, z: -0.75, pick: { kind: 'flow', id: 'tofu' } });
  const ansBlock = plate(gWs, { w: 1.3, h: 1.05, d: 1.3, r: 0.15, bevel: 0.05, key: 'ansible', x: 1.3, y: 0.2, z: -0.75, pick: { kind: 'flow', id: 'ssh' } });
  anchor('tofuTop', tofuBlock, 0, 1.05, 0); anchor('ansTop', ansBlock, 0, 1.05, 0);
  const T = CONTEXT.tools;
  label({ id: 'tofu', kind: 'tag', anchor: 'tofuTop', title: T.tofu.name, lines: [T.tofu.version], color: 'tofu', level: 1, prio: 6, pick: { kind: 'flow', id: 'tofu' }, steps: [0, 1, 2], prefer: 'left' });
  label({ id: 'ansible', kind: 'tag', anchor: 'ansTop', title: T.ansible.name, lines: [T.ansible.version], color: 'ansible', level: 1, prio: 6, pick: { kind: 'flow', id: 'ssh' }, steps: [0, 1, 2], prefer: 'right' });

  const gEx = new THREE.Group(); gEx.position.set(exX, 0, outerZ); W.root.add(gEx);
  const exPick = { kind: 'internet' };
  const exPad = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.16, 48), std('pad'));
  exPad.position.y = 0.08; exPad.receiveShadow = true; exPad.castShadow = true; pickable(exPad, exPick); gEx.add(exPad);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.28, 0.5, 20), std('steel')); stand.position.y = 0.41; stand.castShadow = true; gEx.add(stand);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1.0, 32, 20), std('subnet', { roughness: 0.9 })); globe.position.y = 1.62; globe.castShadow = true; pickable(globe, exPick); gEx.add(globe);
  // graticule as thin rings (hairlines would vanish in a supersampled export)
  const ringMat = flat('steel');
  const ring = (R, y, ry, flatRing) => { const r = new THREE.Mesh(new THREE.TorusGeometry(R, 0.011, 6, 56), ringMat); r.position.y = 1.62 + y; if (flatRing) r.rotation.x = Math.PI / 2; else r.rotation.y = ry; gEx.add(r); };
  [-60, -30, 0, 30, 60].forEach(lat => ring(Math.cos((lat * Math.PI) / 180) * 1.004, Math.sin((lat * Math.PI) / 180) * 1.004, 0, true));
  for (let i = 0; i < 6; i++) ring(1.004, 0, (i * Math.PI) / 6, false);
  printOn(gEx, [{ t: 'internet', f: 'cap' }], 0.46, 0, 0, 2.35, 'center');
  printOn(gEx, [{ t: 'repositories · DNS · time', f: 'mono', a: 0.8 }], 0.34, 0, 0, 2.9, 'center');
  anchor('internet', gEx, 0, 2.75, 0);

  /* ------------------------------------------------------------ machines */
  const column = (cx, cz, parent) => { const c = { x: cx, z: cz, parent: parent || null, items: [], top: 0 }; W.columns.push(c); return c; };
  function stratum(col, id, h, since, node, build) {
    const g = new THREE.Group(); g.position.set(col.x, 0, col.z); g.scale.setScalar(MS);
    const it = { id, h: h * MS, hl: h, since, node, group: g, col, restY: 0 };
    it.ap = appearable(g, since);
    build(g, it);
    col.items.push(it); W.items.push(it); W.root.add(g);
    return it;
  }
  const ledMat = () => new THREE.MeshBasicMaterial();
  function led(parent, node, service, on, lx, ly, lz, top) {
    const g = top ? new THREE.CylinderGeometry(0.11, 0.11, 0.06, 20) : new THREE.BoxGeometry(0.15, 0.1, 0.04);
    const m = new THREE.Mesh(g, ledMat());
    m.position.set(lx, ly, lz); m.userData.state = on === undefined ? 'off' : on ? 'ok' : 'bad';
    parent.add(m); W.leds[node + ':' + service] = m;
    return m;
  }
  const socket = (parent, lx, ly, lz, key) => box(parent, 0.36, 0.15, 0.07, lx, ly, lz, flat(key || 'port'));
  const zF = D.ND / 2, zFw = (D.ND * MS) / 2;   // front face of a machine: local, world

  function buildNode(cell, isCM) {
    const m = cell.m, name = m.name, node = m.node || {};
    const sv = serviceStates(m), sys = node.system || {}, pup = node.puppet || {}, htc = node.htcondor || {}, cfg = htc.config || {};
    const pk = node.packages || {}, classes = pup.classes || [];
    const ver = s => String(s || '').split('-')[0];
    const pick = part => ({ kind: 'node', id: name, part });
    const info = W.nodes[name] = { name, isCM, cell, items: {}, cells: [] };
    const fullW = isCM ? D.NW + D.COLGAP + D.SW : D.NW;
    const fullX = isCM ? (cell.x0 + cell.x1) / 2 : cell.x;
    const dx = (cell.x - fullX) / MS;   // node stack centre, relative to the chassis centre (machine units)
    const note = (id, obj, lx, ly, lz, text, o) => {
      anchor(name + ':' + id, obj, lx, ly, lz);
      label(Object.assign({ id: name + ':' + id, kind: 'note', anchor: name + ':' + id, text, level: 2, prio: 2, node: name, pick: pick(id) }, o));
    };
    const side = (it, w, text, right, part) => note('s-' + it.id, it.group, right ? w / 2 : -w / 2, it.hl / 2, zF, text, { side: right ? 'right' : 'left', exploded: true, since: it.since, pick: pick(part) });

    // 1. what OpenTofu creates: the instance, booted from the AlmaLinux image
    const colBase = column(fullX, 0);
    colBase.baseY = yFloor;
    const vol = m.root_volume || {};
    const chassis = stratum(colBase, 'chassis', H.chassis, 1, name, g => {
      plate(g, { w: fullW, h: H.chassis, d: D.ND, r: 0.14, key: 'chassis', pick: pick('instance') });
      socket(g, dx - 0.55, 0.1, zF + 0.02, 'ansible'); socket(g, dx + 0.55, 0.1, zF + 0.02, 'out');
      anchor(name + ':p22', g, dx - 0.55, 0.055, zF + 0.05); anchor(name + ':pout', g, dx + 0.55, 0.055, zF + 0.05);
    });
    side(chassis, fullW, [m.instance_type, sys.cpus != null ? sys.cpus + ' vCPU' : null, sys.memory_mib != null ? sys.memory_mib + ' MiB' : null,
      vol.size_gib ? `${vol.size_gib} GiB ${vol.type || ''}${vol.encrypted ? ' encrypted' : ''}` : null].filter(Boolean).join(' · '), false, 'instance');
    const os = stratum(colBase, 'os', H.os, 1, name, g => { plate(g, { w: fullW, h: H.os, d: D.ND, r: 0.14, key: 'alma', pick: pick('system') }); });
    side(os, fullW, [(sys.os || 'AlmaLinux').replace(/\s*\(.*\)/, ''), sys.selinux ? 'SELinux ' + sys.selinux : null].filter(Boolean).join(' · '), false, 'system');

    // 2. what Ansible adds: the OpenVox agent (and, on the central manager, the server)
    const col = column(cell.x, 0, colBase);
    const agent = stratum(col, 'agent', H.agent, 2, name, g => {
      plate(g, { w: D.NW, h: H.agent, d: D.ND, r: 0.14, key: 'vox', pick: pick('openvox') });
      led(g, name, 'puppet', sv.puppet, 1.0, H.agent / 2, zF + 0.012);
      // 3. the signed certificate, with the role written inside
      const seal = plate(g, { w: 0.62, h: 0.18, d: 0.05, r: 0.02, bevel: 0.012, key: 'secret', x: -0.82, y: H.agent / 2 - 0.09, z: zF + 0.02, outline: false, shadow: false, pick: pick('certificate') });
      appearable(seal, 3, 'scale');
      anchor(name + ':seal', g, -0.82, H.agent / 2, zF + 0.05);
      anchor(name + ':agentL', g, -D.NW / 2, H.agent / 2, -0.55); anchor(name + ':agentR', g, D.NW / 2, H.agent / 2, -0.55);
    });
    side(agent, D.NW, ['openvox-agent ' + ver(pk['openvox-agent']), pup.runinterval_s ? 'run every ' + Math.round(pup.runinterval_s / 60) + ' min' : null].filter(Boolean).join(' · '), false, 'openvox');
    const cert = pup.certificate || {};
    if (cert.pp_role) label({ id: name + ':cert', kind: 'note', anchor: name + ':seal', text: 'certificate: pp_role = ' + cert.pp_role, level: 2, prio: 3, node: name, side: 'down', since: 3, pick: pick('certificate'), storyOnly: 3 });

    // 4. what OpenVox converges: the shared profiles, then the role's own
    const has = c => classes.indexOf(c) >= 0;
    const base = stratum(col, 'base', H.base, 4, name, g => {
      plate(g, { w: D.NW, h: H.base, d: D.ND, r: 0.14, key: 'base', pick: pick('services') });
      ['chronyd', 'sshd', 'firewalld'].forEach((s, i) => led(g, name, s, sv[s], -1.0 + i * 0.24, H.base / 2, zF + 0.012));
      anchor(name + ':chronyd', g, -1.0, H.base / 2, zF + 0.04);
    });
    // the services this layer keeps running: read from the catalog when it is in the snapshot, else from systemd
    const managed = (pup.resources || []).map(r => /^service\[(.+)\]$/.exec(r)).filter(Boolean).map(r => r[1]).filter(s => s !== 'condor');
    const baseSvcs = managed.length ? managed : ['chronyd', 'sshd', 'firewalld'].filter(s => s in sv);
    side(base, D.NW, (has('profile::base') ? 'profile::base' : 'base') + (baseSvcs.length ? ' · ' + baseSvcs.join(', ') : ''), false, 'services');
    const condor = stratum(col, 'condor', H.condor, 4, name, g => {
      plate(g, { w: D.NW, h: H.condor, d: D.ND, r: 0.14, key: 'condor', pick: pick('htcondor') });
      led(g, name, 'condor', sv.condor, 1.0, H.condor / 2, zF + 0.012);
      socket(g, 0.5, H.condor / 2, zF + 0.02);
    });
    side(condor, D.NW, [(has('profile::htcondor') ? 'profile::htcondor' : 'HTCondor') + ' · condor ' + ver(pk.condor), htc.pool_key_present ? 'pool key' : null, (htc.daemon_tokens || []).length ? 'token' : null].filter(Boolean).join(', '), false, 'htcondor');

    const blockW = 1.12, off = 0.63;
    const deck = stratum(col, 'deck', H.block, 4, name, g => {
      const block = (id, text, lx, lz) => {
        const b = plate(g, { w: blockW, h: H.block, d: blockW, r: 0.1, key: 'condorLight', x: lx, z: lz, pick: pick('htcondor') });
        note(id, b, 0, H.block, 0, text, { side: 'up', since: 4 });
        return b;
      };
      const tray = (w, lx, lz) => plate(g, { w, h: 0.1, d: blockW, r: 0.1, key: 'condorPale', x: lx, z: lz, pick: pick('htcondor') });
      if (isCM) {
        const coll = block('collector', 'collector', -off, -off); block('negotiator', 'negotiator', off, -off);
        const sch = block('schedd', 'schedd', -off, off);
        const q = tray(blockW, off, off);
        const qn = Object.keys(htc.queue || {}).length;
        note('queue', q, 0, 0.1, 0, 'job queue: ' + (qn ? qn + ' states' : 'empty'), { side: 'up', since: 4 });
        anchor(name + ':schedd', sch, 0, H.block, 0); anchor(name + ':collector', coll, 0, H.block, 0); anchor(name + ':queue', q, 0, 0.1, 0);
      } else {
        const st = block('startd', 'startd', -off, -off);
        const hb = block('health', 'health check' + (cfg.STARTD_CRON_HEALTH_PERIOD ? ' · every ' + cfg.STARTD_CRON_HEALTH_PERIOD : ''), off, -off);
        const slot = model.slotOf(name);
        const known = slot && slot.NODE_IS_HEALTHY != null;   // a pool without the health check publishes nothing
        if (cfg.STARTD_CRON_JOBLIST || known) led(hb, name, 'health', known ? slot.NODE_IS_HEALTHY === true : undefined, 0, H.block + 0.03, 0, true);
        const t = tray(2.38, 0, off);
        const ncpu = clamp(Math.round((slot && (slot.TotalCpus || slot.Cpus)) || sys.cpus || 2), 1, 4);
        for (let i = 0; i < ncpu; i++) {
          const cw = Math.min(0.9, 2.1 / ncpu - 0.12), cx = (i - (ncpu - 1) / 2) * (2.1 / ncpu);
          const cellMesh = plate(t, { w: cw, h: 0.05, d: 0.84, r: 0.07, bevel: 0.012, key: 'condor', x: cx, y: 0.1, outline: false, shadow: false });
          info.cells.push({ obj: cellMesh, p: new V3(0, 0.05, 0), job: null });
        }
        if (slot) note('slot', t, 0, 0.16, 0.2, `${String(slot.Name || 'slot').split('@')[0]} · ${slot.Cpus} CPU · ${slot.Memory} MiB · ${slot.State}`, { side: 'down', since: 4 });
        anchor(name + ':slot', t, 0, 0.16, 0); anchor(name + ':startd', st, 0, H.block, 0); anchor(name + ':health', hb, 0, H.block + 0.1, 0);
      }
      anchor(name + ':top', g, isCM ? -dx : 0, H.block + 0.25, 0);
    });
    const roleClass = classes.find(c => /^role::/.test(c));
    side(deck, D.NW, classes.filter(c => /^profile::htcondor::/.test(c)).join(' + ') || (isCM ? 'central manager daemons' : 'execute daemons'), false, 'htcondor');
    Object.assign(info.items, { chassis, os, agent, base, condor, deck });

    if (isCM) {
      const srv = model.server;
      const colS = column(cell.srvX, 0, colBase);
      const ps = stratum(colS, 'server', H.server, 2, name, g => {
        plate(g, { w: D.SW, h: H.server, d: D.ND, r: 0.14, key: 'voxDeep', pick: pick('server') });
        if ('puppetserver' in sv) led(g, name, 'puppetserver', sv.puppetserver, 0.66, H.server - 0.2, zF + 0.012);
        socket(g, -0.4, H.server - 0.2, zF + 0.02);
        anchor(name + ':srvL', g, -D.SW / 2, H.agent / 2, -0.55);
        anchor(name + ':p8140', g, -0.4, H.server - 0.2, zF + 0.06);
      });
      const jvm = /-Xmx(\w+)/.exec(srv.java_args || '');
      side(ps, D.SW, ['openvox-server ' + ver(pk['openvox-server']), jvm ? 'JVM ' + jvm[1] : null, 'listens on 8140'].filter(Boolean).join(' · '), true, 'server');
      const hier = srv.hiera_hierarchy || [];
      const sdeck = stratum(colS, 'sdeck', H.block, 2, name, g => {
        const ca = plate(g, { w: 1.5, h: H.block, d: 1.0, r: 0.1, key: 'vox', z: -0.66, pick: pick('server') });
        anchor(name + ':ca', ca, 0, H.block, 0);
        const nSigned = Object.keys(srv.signed_certificates || {}).length;
        note('ca', ca, 0, H.block, 0, `CA + autosign policy · ${nSigned} signed, ${(srv.pending_requests || []).length} pending`, { side: 'up', since: 2, pick: pick('server') });
        // Hiera: one sheet per level, the first match on top
        const n = Math.max(1, hier.length);
        const sheetH = Math.min(0.08, (H.block - 0.04 * (n - 1)) / n);
        hier.slice().reverse().forEach((lv, i) => {
          const top = i === n - 1;
          plate(g, { w: 1.5 - (n - 1 - i) * 0.0, h: sheetH, d: 1.06, r: 0.06, bevel: 0.012, key: /secret/i.test(lv.path + lv.name) ? 'secret' : (i % 2 ? 'voxPale' : 'vox'), x: 0, y: i * (sheetH + 0.04), z: 0.66, pick: pick('hiera') });
          if (top) anchor(name + ':hiera', g, 0, i * (sheetH + 0.04) + sheetH, 0.66);
        });
        if (hier.length) label({ id: name + ':hiera', kind: 'note', anchor: name + ':hiera', text: `Hiera · ${hier.length} levels, first match wins`, level: 2, prio: 2, node: name, side: 'down', since: 2, pick: pick('hiera') });
      });
      side(sdeck, D.SW, 'admission and data', true, 'server');
      Object.assign(info.items, { server: ps, sdeck });
    }

    // the tag above the machine
    const slot = model.slotOf(name);
    label({
      id: name, kind: 'tag', anchor: name + ':top', title: name, node: name, level: 1, prio: 10, pick: pick(null), since: 1,
      // the story fills the tag in as the machine gets its role (step 3) and its slot (step 4)
      lines: st => [st === 0 || st >= 3 ? (roleClass || ('role: ' + (m.role || 'n/a'))) : null, [m.instance_type, m.private_ip].filter(Boolean).join(' · ')],
      health: (st, live) => (st > 0 && st < 4 ? null : live !== undefined ? live : slot && slot.NODE_IS_HEALTHY != null ? slot.NODE_IS_HEALTHY === true : null),
    });
    info.fullX = fullX;
    info.x0 = cell.x0; info.x1 = cell.x1;
  }

  buildNode(cmCell, true);
  cells.filter(c => !c.ghost).forEach(c => buildNode(c, false));

  /* -------------------------------------------- completed jobs, by worker */
  const cube = 0.25, pitch = 0.31, perRow = 3, perLayer = 12;
  const jobGeom = new THREE.BoxGeometry(cube, cube, cube);
  function pallet(cell) {
    const n = model.byHost[cell.m.name] || 0;
    const g = new THREE.Group(); g.position.set(cell.palletX, yFloor, cell.ghost ? 0 : 0.35); W.root.add(g); appearable(g, 5);
    const pick = cell.ghost ? { kind: 'ghost', id: cell.m.name } : { kind: 'jobs', id: cell.m.name };
    plate(g, { w: D.PALLET_W + 0.12, h: 0.07, d: D.PALLET_D + 0.12, r: 0.06, bevel: 0.015, key: 'steel', pick });
    if (n) {
      const im = new THREE.InstancedMesh(jobGeom, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
      const mx = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const layer = Math.floor(i / perLayer), k = i % perLayer;
        mx.makeTranslation((k % perRow - 1) * pitch, 0.07 + cube / 2 + layer * (cube + 0.02), (Math.floor(k / perRow) - 1.5) * pitch);
        im.setMatrixAt(i, mx);
      }
      im.castShadow = true; im.receiveShadow = true; pickable(im, pick); g.add(im);
      W.onTheme.push(P => { for (let i = 0; i < n; i++) im.setColorAt(i, srgb((i * 7) % 3 === 0 ? P.jobAlt : P.job)); im.instanceColor.needsUpdate = true; });
    }
    const layers = Math.ceil(n / perLayer);
    anchor(cell.m.name + ':pallet', g, 0, 0.07 + layers * (cube + 0.02) + 0.12, 0);
    anchor(cell.m.name + ':palletDrop', g, 0, 0.07 + layers * (cube + 0.02) + cube / 2, 0);
    label({ id: cell.m.name + ':jobs', kind: 'note', anchor: cell.m.name + ':pallet', text: plural(n, 'job'), mono: true, level: 1, prio: 5, side: cell.ghost ? 'right' : 'up', pick, since: 5 });
  }
  cells.forEach(pallet);

  /* ---- a worker that ran jobs and was then destroyed (the scale-out demonstration) */
  cells.filter(c => c.ghost).forEach(cell => {
    const g = new THREE.Group(); g.position.set(cell.x, yFloor, 0); W.root.add(g); appearable(g, 5);
    const dm = reg(new THREE.LineDashedMaterial({ dashSize: 0.16, gapSize: 0.12, transparent: true }), 'ghost', 'printAlpha');
    const hgt = (H.chassis + H.os + H.agent + H.base + H.condor + H.block + D.GAP * 5) * MS;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(nw, hgt, nw)), dm);
    edges.position.y = hgt / 2; edges.computeLineDistances(); g.add(edges);
    const fill = box(g, nw, hgt, nw, 0, hgt / 2, 0, flat('ghost', { transparent: true, opacity: 0.05, depthWrite: false }), { kind: 'ghost', id: cell.m.name });
    fill.renderOrder = 1;
    anchor(cell.m.name + ':top', g, 0, hgt + 0.25, 0);
    label({ id: cell.m.name, kind: 'tag', anchor: cell.m.name + ':top', title: cell.m.name, ghost: true, level: 1, prio: 7, pick: { kind: 'ghost', id: cell.m.name }, since: 5,
      lines: CONTEXT.goneWorker });
  });

  /* --------------------------------------------------------------- flows */
  const flowGroup = id => { const g = new THREE.Group(); W.root.add(g); return (W.flows[id] = { id, def: FLOWS.find(f => f.id === id), group: g, paths: [], on: true }); };
  const R = 0.05;
  function tube(flow, curve, o) {
    o = o || {};
    const len = curve.getLength();
    let mat;
    if (o.dashed) {
      mat = flat(flow.def.key, { map: dashTexture(len / 0.5), alphaTest: 0.5 });
      W.dashed.push({ mat, period: 0.5, flow: flow.id });
    } else mat = flow.mat || (flow.mat = flat(flow.def.key));
    const m = new THREE.Mesh(tubeGeom(curve, o.r || R), mat);
    flow.group.add(m);
    const fat = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(4, Math.ceil(len * 2)), 0.2, 5, false), fatMat);
    pickable(fat, { kind: 'flow', id: flow.id }); fat.userData.flow = flow.id; flow.group.add(fat);
    return m;
  }
  const head = (flow, curve, at, reverse) => { const h = arrowHead(curve, R, flow.headMat || (flow.headMat = flat(flow.def.key)), at, reverse); flow.group.add(h); return h; };
  const fatMat = new THREE.MeshBasicMaterial({ visible: false });
  const P3 = (px, py, pz) => new V3(px, py, pz);
  const ramp = (px, ya, yb, z, dir) => [P3(px, ya, z - 0.14 * dir), P3(px, yb, z + 0.14 * dir)];   // step between two slabs, dir = travel direction along z
  const yT = [0.055, yRegion + 0.055, yVpc + 0.055, yFloor + 0.055];
  W.resolve = id => { const a = W.anchors[id]; return a ? a.obj.localToWorld(a.p.clone()) : null; };
  const allNodes = [cmCell].concat(cells.filter(c => !c.ghost));

  // --- OpenTofu -> AWS API (build time)
  const fTofu = flowGroup('tofu');
  const apiX = (region.x0 + vpc.x0) / 2, apiZ = 1.2;
  const api = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.1, 28), std('tofu')); api.position.set(apiX, yRegion + 0.05, apiZ); api.castShadow = true;
  pickable(api, { kind: 'flow', id: 'tofu' }); W.root.add(api); appearable(api, 1);
  anchor('api', api, 0, 0.3, 0);
  label({ id: 'api', kind: 'note', anchor: 'api', text: 'AWS API', level: 1, prio: 6, side: 'left', flow: 'tofu', pick: { kind: 'flow', id: 'tofu' } });
  // the inventory OpenTofu writes for Ansible
  const inv = new THREE.LineCurve3(P3(wsX - 0.62, 0.74, outerZ - 0.75), P3(wsX + 0.56, 0.74, outerZ - 0.75));
  tube(fTofu, inv, { dashed: true }); head(fTofu, inv);
  anchor('inventory', gWs, 0, 0.94, -0.75);
  label({ id: 'inventory', kind: 'note', anchor: 'inventory', text: 'generated inventory', level: 2, prio: 2, side: 'up', pick: { kind: 'flow', id: 'tofu' } });

  // --- Ansible over SSH (build time): workspace -> gateway -> gate 22 -> every node
  const fSsh = flowGroup('ssh'), fOut = flowGroup('out');
  function bus(flow, laneZ, jx, yLift, trunkPts, portOf, inbound, dashed) {
    const y = yT[3] + yLift;
    const junction = P3(jx, y, laneZ);
    const trunk = roundedPath(inbound ? trunkPts.concat([junction]) : [junction].concat(trunkPts), 0.3);
    tube(flow, trunk, { dashed });
    if (!inbound) head(flow, trunk);
    flow.trunk = trunk;
    const xs = allNodes.map(c => portOf(c).x);
    for (const sideSign of [-1, 1]) {
      const far = sideSign < 0 ? Math.min.apply(null, xs) : Math.max.apply(null, xs);
      if ((far - jx) * sideSign <= 0.01) continue;
      const a = junction, b = P3(far, y, laneZ);
      tube(flow, new THREE.LineCurve3(inbound ? a : b, inbound ? b : a), { dashed });
    }
    allNodes.forEach(c => {
      const p = portOf(c), onLane = P3(p.x, y, laneZ), port = P3(p.x, y, p.z);
      const drop = new THREE.LineCurve3(inbound ? onLane : port, inbound ? port : onLane);
      tube(flow, drop, { dashed });
      if (inbound) head(flow, drop);
      // the whole route, for pulses
      const lane = [junction, onLane].filter((q, i, arr) => i === 0 || q.distanceTo(arr[0]) > 0.02);
      const route = inbound ? trunkPts.concat(lane, [port]) : [port].concat(lane.slice().reverse(), trunkPts);
      flow.paths.push({ curve: roundedPath(route, 0.3), node: c.m.name });
    });
  }
  const zIgw = vpc.z1;
  const through = (gx, ySide) => [   // from the fence gate out to the ground in front of the region, through the gateway
    P3(gx, yT[3] + ySide, fence.z1),
  ].concat(ramp(gx, yT[3] + ySide, yT[2] + ySide, subnet.z1, 1), ramp(gx, yT[2] + ySide, yT[1] + ySide, zIgw, 1), ramp(gx, yT[1] + ySide, yT[0] + ySide, region.z1, 1), [P3(gx, yT[0] + ySide, region.z1 + 1.1)]);
  W.root.updateMatrixWorld(true);
  const sshTrunk = [P3(wsX + 1.3, 0.2 + 0.055, outerZ - 1.4)]
    .concat(ramp(wsX + 1.3, 0.255, yT[0] + 0.012, outerZ - 1.8, -1), [P3(wsX + 1.3, yT[0] + 0.012, region.z1 + 1.1)], through(-D.GATE_X, 0.012).reverse());
  bus(fSsh, D.LANE_SSH, -D.GATE_X, 0.012, sshTrunk, c => W.resolve(c.m.name + ':p22'), true, true);
  const outTrunk = through(D.GATE_X, 0).concat([P3(exX, yT[0], region.z1 + 1.1), P3(exX, yT[0], outerZ - 1.9)]);
  bus(fOut, D.LANE_OUT, D.GATE_X, 0, outTrunk, c => W.resolve(c.m.name + ':pout'), false, false);
  label({ id: 'f-ssh', kind: 'chip', flow: 'ssh', curve: () => fSsh.trunk, ts: [0.3, 0.2, 0.42, 0.1], text: fSsh.def.chip, color: 'ansible', level: 1, prio: 8, pick: { kind: 'flow', id: 'ssh' } });
  label({ id: 'f-out', kind: 'chip', flow: 'out', curve: () => fOut.trunk, ts: [0.72, 0.82, 0.6, 0.9], text: fOut.def.chip, color: 'out', level: 1, prio: 8, pick: { kind: 'flow', id: 'out' } });
  const rule = (dir, re) => model.rules.find(r => r.direction === dir && re.test(String(r.ports) + ' ' + r.protocol));
  const r22 = rule('inbound', /^22-22/), rOut = rule('outbound', /./);
  if (r22) label({ id: 'gate22', kind: 'note', anchor: 'gate22', text: 'in 22 ← ' + String(r22.peer || '').replace(/^admin workstation \(single (\/\d+)\)$/, 'one admin address $1'), level: 2, prio: 3, side: 'left', pick: sgPick, since: 1 });
  if (rOut) label({ id: 'gateOut', kind: 'note', anchor: 'gateOut', text: 'out all → ' + String(rOut.peer || '').replace(/\s*\(.*\)/, ''), level: 2, prio: 3, side: 'right', pick: sgPick, since: 1 });

  // --- the two flows between members of the security group, drawn in the air
  const fVox = flowGroup('vox'), fCon = flowGroup('condor');
  {
    const tA = W.resolve('tofuTop'), tB = W.resolve('api').add(P3(0, -0.22, 0));
    const tcv = new THREE.CubicBezierCurve3(tA, P3(tA.x - 0.8, tA.y + 3.6, tA.z - 1.5), P3(tB.x - 1.6, tB.y + 3.2, tB.z + 2.6), tB);
    tube(fTofu, tcv, { dashed: true }); head(fTofu, tcv);
    fTofu.paths = [{ curve: tcv }]; fTofu.arc = tcv;
  }
  W.rebuildArcs = function () {
    W.root.updateMatrixWorld(true);
    for (const f of [fVox, fCon]) {
      f.paths = [];
      for (let i = f.group.children.length - 1; i >= 0; i--) { const c = f.group.children[i]; c.geometry.dispose(); f.group.remove(c); const k = W.picks.indexOf(c); if (k >= 0) W.picks.splice(k, 1); }
    }
    const cmName = cm.name;
    const arc = (a, b, lift, lean) => {
      const dxy = Math.abs(a.x - b.x), top = Math.max(a.y, b.y) + lift + 0.13 * dxy;
      return new THREE.CubicBezierCurve3(a, P3(a.x + (b.x - a.x) * 0.12, top, a.z + lean), P3(b.x + (a.x - b.x) * 0.12, top, b.z + lean), b);
    };
    // 8140: every agent pulls from the server
    const ca = W.resolve(cmName + ':ca');
    if (ca) {
      const self = new THREE.LineCurve3(W.resolve(cmName + ':agentR'), W.resolve(cmName + ':srvL'));
      tube(fVox, self, { r: 0.06 }); fVox.paths.push({ curve: self, node: cmName, short: true });
      cells.filter(c => !c.ghost).forEach((c, i) => {
        const a = W.resolve(c.m.name + ':agentL');
        const cv = arc(a, ca.clone().add(P3(0.25 - i * 0.22, 0, 0)), 1.5, -0.5);
        tube(fVox, cv, { r: 0.065 }); head(fVox, cv);
        fVox.paths.push({ curve: cv, node: c.m.name });
      });
    }
    // 9618: slot advertisements up to the collector, jobs down from the schedd
    const sch = W.resolve(cmName + ':schedd');
    if (sch) cells.filter(c => !c.ghost).forEach((c, i) => {
      const b = W.resolve(c.m.name + ':slot');
      const cv = arc(sch.clone().add(P3(0.2 - i * 0.2, 0, 0)), b, 2.3, 0.55);
      tube(fCon, cv, { r: 0.065 }); head(fCon, cv); head(fCon, cv, 0, true);
      fCon.paths.push({ curve: cv, node: c.m.name });
    });
  };
  const arcsOf = f => f.paths.filter(p => !p.short).map(p => p.curve).reverse();   // outermost first
  label({ id: 'f-vox', kind: 'chip', flow: 'vox', curve: () => arcsOf(fVox), ts: [0.5, 0.36, 0.64, 0.26, 0.74], text: fVox.def.chip, color: 'vox', level: 1, prio: 9, pick: { kind: 'flow', id: 'vox' } });
  label({ id: 'f-condor', kind: 'chip', flow: 'condor', curve: () => arcsOf(fCon), ts: [0.5, 0.36, 0.64, 0.26, 0.74], text: fCon.def.chip, color: 'condor', level: 1, prio: 9, pick: { kind: 'flow', id: 'condor' } });

  /* ------------------------------------------- stacking, explode, bounds */
  W.layoutColumns = function (e) {
    W.explode = e;
    const gap = D.GAP + e * D.EXPLODE;
    for (const c of W.columns) {
      let y = c.parent ? c.parent.top + gap : c.baseY;
      for (const it of c.items) { it.restY = y; it.ap.y0 = y; y += it.h + gap; }
      c.top = y - gap;
    }
    W.applyAppear();
    W.rebuildArcs();
  };
  W.applyAppear = function () {
    for (const a of W.appear) {
      a.obj.visible = a.shown && a.t > 0;
      const k = ease.back(clamp(a.t, 0, 1));
      if (a.mode === 'scale') a.obj.scale.setScalar(Math.max(0.001, k));
      else a.obj.position.y = a.y0 + (1 - k) * 2.6;
    }
  };
  const rect = (b, y) => [P3(b.x0, y, b.z0), P3(b.x1, y, b.z0), P3(b.x0, y, b.z1), P3(b.x1, y, b.z1)];
  const real = cells.filter(c => !c.ghost);
  const tops = (names, room) => names.reduce((a, n) => { const t = W.nodeTop(n).y + room, i = W.nodes[n]; return a.concat([P3(i.x0, t, 0), P3(i.x1, t, 0)]); }, []);
  const apexes = () => ['vox', 'condor'].reduce((a, id) => a.concat(W.flows[id].paths.filter(p => !p.short).map(p => p.curve.getPointAt(0.5))), []);
  const everyNode = () => Object.keys(W.nodes);
  const ghostTops = () => cells.filter(c => c.ghost).map(c => P3(c.x1, yFloor + 5.3, 0));
  /** The points each view has to contain. */
  W.fit = {
    all: () => rect(region, 0).concat(rect({ x0: wsX - 2.8, x1: wsX + 2.8, z0: outerZ - 1.8, z1: outerZ + 1.8 }, 0), [P3(wsX, 2.9, outerZ - 0.75), P3(exX + 2.6, 0, outerZ + 2.9), P3(exX - 2.6, 0, outerZ + 3.2), P3(exX, 2.8, outerZ)],
      tops(everyNode(), 1.7), apexes(), ghostTops(), [W.flows.tofu.arc.getPointAt(0.5)]),
    farm: () => rect(fence, yFloor).concat(tops(everyNode(), 1.7), apexes(), ghostTops()),
    workers: () => rect({ x0: real.length ? real[0].x0 : -3, x1: real.length ? real[real.length - 1].x1 : 3, z0: -zFw, z1: D.LANE_OUT }, yFloor).concat(tops(real.map(c => c.m.name), 1.8), apexes()),
    entry: () => rect({ x0: region.x0, x1: region.x1, z0: -zFw, z1: outerZ + 1.8 }, 0).concat(tops(everyNode(), 1.5), [P3(wsX - 2.8, 0, outerZ + 1.8), P3(exX + 2.6, 0, outerZ + 2.9), P3(exX, 2.8, outerZ)]),
    node: name => { const i = W.nodes[name]; return rect({ x0: i.x0, x1: i.x1, z0: -zFw, z1: zFw + 0.4 }, yFloor).concat(tops([name], 1.6)); },
  };

  /** Top of a machine as it currently stands (parts not yet created by the story are skipped). */
  W.nodeTop = function (name) {
    const n = W.nodes[name]; if (!n) return W.resolve(name + ':top');
    let top = yFloor;
    for (const k in n.items) { const it = n.items[k]; if (it.ap.shown) top = Math.max(top, it.restY + it.h); }
    return new V3(n.fullX, top + 0.3, 0);
  };
  W.applyTheme = function (P) {
    for (const r of W.mats) { r.m.color.copy(srgb(P[r.key])); if (r.alphaKey) r.m.opacity = P[r.alphaKey]; }
    for (const k in W.leds) W.paintLed(k, P);
    W.onTheme.forEach(fn => fn(P));
    W.P = P;
  };
  W.paintLed = function (k, P) { const l = W.leds[k]; if (l) l.material.color.copy(srgb((P || W.P)[l.userData.state] || (P || W.P).off)); };
  W.setLed = function (k, state) { const l = W.leds[k]; if (l) { l.userData.state = state; W.paintLed(k); } };

  W.layoutColumns(0);
  return W;
}
