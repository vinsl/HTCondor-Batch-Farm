/* ----------------------------- the six steps, pulses, and the two replays */
/* The resting scene is the snapshot. Everything that moves here is an illustration of the README's
   "How it works": pulses along the flows, jobs travelling to slots, and the self-healing demonstration. */
const STEP_FLOWS = { 1: ['tofu'], 2: ['ssh', 'out'], 3: ['vox'], 4: ['vox', 'out'], 5: ['condor'], 6: ['condor', 'vox'] };
const HEAL_PHASES = [
  { until: 3.5, name: 'Healthy', text: 'Both workers publish NODE_IS_HEALTHY = true and receive jobs.' },
  { until: 5.2, name: 'chronyd stopped', text: 'chronyd is stopped by hand on the worker.' },
  { until: 11, name: 'Refuses jobs', text: 'The health check publishes false: the START expression of the worker rejects new jobs, which all go to the other worker.' },
  { until: 13, name: 'OpenVox repairs', text: 'The next agent run sees the stopped service as drift and starts it (corrective change).' },
  { until: 17.5, name: 'Healthy again', text: 'The health check publishes true again and the worker takes jobs.' },
];

function Story(W, view, scene) {
  const model = W.model;
  const S = { step: 0, t: 0, phase: 0, onPhase: null, userFlows: {}, pulses: [], jobs: [], healthy: {}, sick: null };
  FLOWS.forEach(f => { S.userFlows[f.id] = true; });
  view.flowShown = id => S.userFlows[id] && (S.step === 0 || (STEP_FLOWS[S.step] || []).indexOf(id) >= 0);

  const matOf = {};
  // materials made here join the theme registry (and take the current colour if a theme is already on)
  const mat = (key, lit) => {
    if (matOf[key]) return matOf[key];
    const m = lit ? new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 }) : new THREE.MeshBasicMaterial();
    W.mats.push({ m, key }); if (W.P) m.color.copy(srgb(W.P[key]));
    return (matOf[key] = m);
  };
  const pulseGeom = new THREE.SphereGeometry(0.095, 14, 10);
  const jobGeom = new THREE.BoxGeometry(0.24, 0.24, 0.24);
  const layer = new THREE.Group(); W.root.add(layer);

  /* ---- pulses: beads that travel along a flow */
  function addPulses(flowId, spacing, speed) {
    const f = W.flows[flowId]; if (!f) return;
    f.paths.forEach((p, i) => {
      if (p.short) return;
      const n = Math.max(1, Math.round(p.curve.getLength() / spacing));
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(pulseGeom, mat(f.def.key)); layer.add(m);
        S.pulses.push({ m, flow: flowId, path: i, phase: k / n + i * 0.37, speed, node: p.node });
      }
    });
  }
  addPulses('tofu', 5, 3.2); addPulses('ssh', 7, 4.2); addPulses('out', 9, 3.0); addPulses('vox', 6, 2.4); addPulses('condor', 7, 2.2);

  // which flows carry pulses at each step, and in which direction (+1 = along the drawn curve)
  function pulseMode(p) {
    const st = S.step;
    if (REDUCED_MOTION || !view.flowShown(p.flow)) return 0;
    if (st === 0) return p.flow === 'vox' ? 0.45 : p.flow === 'condor' ? -0.45 : p.flow === 'out' ? 0.45 : 0;
    if (p.flow === 'condor') return -0.6;                        // slot advertisements, worker -> collector
    if (p.flow === 'vox' && st === 4) return (p.phase * 10 | 0) % 2 ? 1 : -1;   // requests up, catalogs down
    if (p.flow === 'vox' && st === 6) return S.phase === 3 && p.node === S.sick ? 1.6 : 0;
    return 1;
  }

  /* ---- jobs: queued on the schedd, matched to a free slot, run, then stacked as completed */
  const cmName = model.cm.name;
  const workerNames = model.workers.map(w => w.name).filter(n => W.nodes[n] && W.nodes[n].cells.length);
  let spawnIn = 0, rr = 0, seq = 0;
  function resetJobs() {
    S.jobs.forEach(j => layer.remove(j.m)); S.jobs = [];
    workerNames.forEach(n => W.nodes[n].cells.forEach(c => { c.job = null; }));
    spawnIn = 0.2;
  }
  const cellPos = c => c.obj.localToWorld(c.p.clone()).add(new V3(0, 0.13, 0));
  function queueSpot(i) { const q = W.resolve(cmName + ':queue'); return q ? q.add(new V3((i - 1) * 0.3, 0.13, 0)) : null; }
  function updateJobs(dt) {
    if (!workerNames.length || !W.flows.condor.paths.length) return;
    const queued = S.jobs.filter(j => j.state === 'queued');
    spawnIn -= dt;
    if (spawnIn <= 0 && queued.length < 3) {
      const m = new THREE.Mesh(jobGeom, mat('job', true)); m.castShadow = true; layer.add(m);
      const j = { m, state: 'queued', age: 0, id: seq++ }; S.jobs.push(j); queued.push(j);
      spawnIn = 0.55;
    }
    queued.forEach((j, i) => { const p = queueSpot(i); if (p) j.m.position.lerp(p, j.age === 0 ? 1 : 0.2); });
    // negotiation: the oldest queued job goes to the next healthy worker with a free CPU
    const first = queued[0];
    if (first && first.age > 0.35) {
      for (let k = 0; k < workerNames.length; k++) {
        const name = workerNames[(rr + k) % workerNames.length];
        if (S.healthy[name] === false) continue;
        const cell = W.nodes[name].cells.find(c => !c.job);
        if (!cell) continue;
        cell.job = first; rr = (rr + k + 1) % workerNames.length;
        Object.assign(first, { state: 'fly', node: name, cell, u: 0, from: first.m.position.clone() });
        break;
      }
    }
    for (const j of S.jobs.slice()) {
      j.age += dt;
      if (j.state === 'queued') { j.m.scale.setScalar(Math.min(1, j.age * 5)); continue; }
      if (j.state === 'fly') {
        const path = W.flows.condor.paths.find(p => p.node === j.node);
        j.u = Math.min(1, j.u + (dt * 5.2) / path.curve.getLength());
        const k = ease.inOut(j.u), p = path.curve.getPointAt(k);
        const a = clamp(k / 0.12, 0, 1), b = clamp((k - 0.86) / 0.14, 0, 1);
        p.lerpVectors(j.from, p, a).lerp(cellPos(j.cell), b);
        j.m.position.copy(p); j.m.rotation.set(k * 6, k * 4, 0);
        if (j.u >= 1) { j.state = 'run'; j.timer = 1.5 + ((j.id * 37) % 10) / 10; j.m.rotation.set(0, 0, 0); }
      } else if (j.state === 'run') {
        j.timer -= dt; j.m.position.copy(cellPos(j.cell)); j.m.rotation.y += dt * 2.5;
        if (j.timer <= 0) { j.state = 'done'; j.u = 0; j.from = j.m.position.clone(); j.to = W.resolve(j.node + ':palletDrop'); j.cell.job = null; }
      } else {
        j.u = Math.min(1, j.u + dt / 0.5);
        j.m.position.lerpVectors(j.from, j.to, j.u); j.m.position.y += Math.sin(j.u * Math.PI) * 0.9;
        j.m.rotation.y = 0;
        if (j.u >= 1) { layer.remove(j.m); S.jobs.splice(S.jobs.indexOf(j), 1); }
      }
    }
  }

  /* ---- self-healing replay on the first worker */
  const snapLed = {};
  for (const k in W.leds) snapLed[k] = W.leds[k].userData.state;
  function restoreSnapshotState() {
    for (const k in snapLed) W.setLed(k, snapLed[k]);
    S.healthy = {}; S.sick = null; S.phase = 0; view.extraLabels = [];
  }
  function setPhase(i) {
    if (i === S.phase && S.sick) return;
    S.phase = i;
    const w = S.sick = workerNames[0]; if (!w) return;
    const chrony = i === 1 || i === 2, healthy = !(i === 2 || i === 3);
    W.setLed(w + ':chronyd', chrony ? 'bad' : 'ok');
    W.setLed(w + ':health', healthy ? 'ok' : 'bad');
    S.healthy[w] = healthy;
    const notes = [null,
      { anchor: w + ':chronyd', text: 'chronyd stopped', tone: 'bad', side: 'left' },
      { anchor: w + ':health', text: 'NODE_IS_HEALTHY = false · service chronyd is not active', tone: 'bad', side: 'up' },
      { anchor: w + ':chronyd', text: 'OpenVox: chronyd stopped → running (corrective)', tone: 'vox', side: 'left' },
      { anchor: w + ':health', text: 'NODE_IS_HEALTHY = true', tone: 'ok', side: 'up' }];
    view.extraLabels = notes[i] ? [Object.assign({ id: 'heal', kind: 'note', level: 1, prio: 12, mono: true }, notes[i])] : [];
    if (S.onPhase) S.onPhase(i);
  }
  view.nodeHealth = name => (name in S.healthy ? S.healthy[name] : undefined);

  /* ---- step changes */
  S.set = function (n) {
    const prev = S.step;
    S.step = view.step = n; S.t = 0;
    let i = 0;
    for (const a of W.appear) {
      const show = n === 0 || a.since <= n;
      const fresh = show && n > 0 && prev !== 0 && !a.shown || (show && n > 0 && a.since === n);
      a.shown = show;
      a.t = fresh && !REDUCED_MOTION ? -(i++) * 0.045 : 1;
    }
    W.applyAppear();
    restoreSnapshotState(); resetJobs();
    if (n === 6) { S.phase = -1; setPhase(0); }
    S.syncFlows();
  };
  S.syncFlows = function () { for (const id in W.flows) W.flows[id].group.visible = view.flowShown(id); };
  S.toggleFlow = function (id, on) { S.userFlows[id] = on; S.syncFlows(); };

  S.update = function (dt) {
    S.t += dt;
    // parts dropping into place
    let moving = false;
    for (const a of W.appear) if (a.t < 1) { a.t = Math.min(1, a.t + dt / 0.6); moving = true; }
    if (moving) { W.applyAppear(); if (W.items.some(it => it.ap.t < 1)) W.rebuildArcs(); }
    // marching dashes on the build-time flows while their step is on
    for (const d of W.dashed) if (!REDUCED_MOTION && ((S.step === 1 && d.flow === 'tofu') || (S.step === 2 && d.flow === 'ssh'))) d.mat.map.offset.x -= (dt * 1.6) / d.period;
    // pulses
    for (const p of S.pulses) {
      const mode = pulseMode(p), path = W.flows[p.flow].paths[p.path];
      p.m.visible = !!mode && !!path;
      if (!p.m.visible) continue;
      const len = path.curve.getLength();
      let u = (((S.t * p.speed * mode) / len + p.phase) % 1 + 1) % 1;
      p.m.position.copy(path.curve.getPointAt(u));
      p.m.scale.setScalar(Math.min(1, Math.min(u, 1 - u) * 12 + 0.15));
    }
    if (S.step >= 5 && !REDUCED_MOTION) updateJobs(dt);
    if (S.step === 6 && !REDUCED_MOTION) {
      const total = HEAL_PHASES[HEAL_PHASES.length - 1].until, tt = S.t % total;
      setPhase(HEAL_PHASES.findIndex(p => tt < p.until));
    }
  };

  /** Facts shown under each step's caption, all read from the snapshot. */
  S.facts = function (n) {
    const f = model.facts, infra = model.infra, net = model.net, srv = model.server;
    const ver = (pkg, node) => String(((node || model.cm).node.packages || {})[pkg] || '').split('-')[0];
    const wcfg = ((model.workers[0] || {}).node || {}).htcondor ? model.workers[0].node.htcondor.config || {} : {};
    const range = f.resMin === f.resMax ? String(f.resMin) : `${f.resMin}–${f.resMax}`;
    const certs = Object.values(srv.signed_certificates || {});
    switch (n) {
      case 0: return [plural(f.machines, 'machine'), f.healthKnown ? `${f.healthySlots} of ${plural(f.slots, 'slot')} healthy` : plural(f.slots, 'slot'), `${plural(f.completed, 'job')} completed`, `${f.changed} of ${range} resources changed`, `${plural(f.pending, 'certificate request')} pending`];
      case 1: return [`region ${infra.region}`, `VPC ${net.vpc_cidr}`, `subnet ${(net.subnet || {}).cidr}`, plural(model.rules.length, 'security group rule'), plural(f.machines, 'machine'), (infra.image || {}).name].filter(Boolean);
      case 2: return [`openvox-agent ${ver('openvox-agent')}`, `openvox-server ${ver('openvox-server')}`, 'SSH allowed from one /32', `key pair ${infra.key_pair}`];
      case 3: return [`${plural(f.certs, 'certificate')} signed`, `${f.pending} pending`, certs.length && certs.every(c => c.contains_challenge_password === false) ? 'challenge password kept in certificates: no' : null,
        srv.autosign ? 'policy ' + String(srv.autosign).split('/').pop() : null, certs[0] && certs[0].issuer ? String(certs[0].issuer).replace('CN=', '') : null].filter(Boolean);
      case 4: return [`${f.changed} changed, ${f.failed} failed at the last run`, `${range} resources per node`, `Hiera: ${(srv.hiera_hierarchy || []).length} levels`, `environment ${(srv.environments || []).join(', ')}`];
      case 5: return [`${plural(f.slots, 'slot')}, ${plural(f.cpus, 'CPU')}`, `${plural(f.completed, 'job')} completed`].concat(Object.keys(model.byHost).map(h => `${h}: ${model.byHost[h]}`));
      case 6: return [wcfg.START ? 'START = ' + wcfg.START : null, wcfg.STARTD_CRON_HEALTH_PERIOD ? 'check every ' + wcfg.STARTD_CRON_HEALTH_PERIOD : null,
        wcfg.STARTD_CRON_AUTOPUBLISH ? 'autopublish ' + wcfg.STARTD_CRON_AUTOPUBLISH : null].filter(Boolean);
    }
    return [];
  };
  S.dispose = function () { W.root.remove(layer); };
  S.syncFlows();
  return S;
}
