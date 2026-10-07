/* ------------------------- the detail panel: everything the snapshot holds */
function Inspector(root, model, hooks) {
  const S = model.raw, infra = model.infra, net = model.net, srv = model.server;
  const has = v => v != null && v !== '';
  const kv = rows => el('dl', { class: 'kv' }, rows.filter(r => r && has(r[1])).map(r => [el('dt', null, r[0]), el('dd', { class: r[2] === false ? null : 'mono' }, r[1])]));
  const sec = (id, title, ...kids) => el('section', { class: 'sec', id: 'sec-' + id }, el('h3', null, title), kids);
  const chip = (text, tone) => el('span', { class: 'chip' + (tone ? ' ' + tone : '') }, text);
  const table = (heads, rows) => el('div', { class: 'tablewrap' }, el('table', null,
    el('thead', null, el('tr', null, heads.map(h => el('th', null, h)))),
    el('tbody', null, rows.map(r => el('tr', null, r.map(c => el('td', null, c == null ? '–' : c)))))));
  const dot = ok => el('span', { class: 'dot ' + (ok ? 'ok' : 'bad'), 'aria-hidden': 'true' });
  const state = (ok, text) => el('span', { class: 'state' }, dot(ok), text);
  const list = items => el('ul', { class: 'plain mono' }, items.map(i => el('li', null, i)));
  const p = text => el('p', null, text);
  const raw = obj => el('details', { class: 'raw' }, el('summary', null, 'Raw snapshot data'), el('pre', null, JSON.stringify(obj, null, 2)));
  const sgFor = port => { const r = model.rules.find(x => x.direction === 'inbound' && String(x.ports) === `${port}-${port}`); return r ? r.peer : null; };

  function bars(byHost) {
    const max = Math.max(1, ...Object.values(byHost));
    return el('div', { class: 'bars' }, Object.keys(byHost).sort().map(h => {
      const gone = model.ghosts.indexOf(h) >= 0;
      return el('div', { class: 'bar' + (gone ? ' gone' : '') }, el('span', { class: 'mono' }, h),
        el('span', { class: 'track' }, el('span', { class: 'fill', style: { width: (byHost[h] / max * 100).toFixed(1) + '%' } })),
        el('span', { class: 'mono num' }, String(byHost[h])));
    }));
  }

  /* ------------------------------------------------------------- a machine */
  function nodeView(name) {
    const m = model.machines.find(x => x.name === name); if (!m) return null;
    const n = m.node || {}, sys = n.system || {}, pup = n.puppet || {}, htc = n.htcondor || {}, isCM = m === model.cm;
    const svc = n.services || {}, fw = (n.network || {}).firewall || {}, listen = (n.network || {}).listening_tcp || [];
    const run = pup.last_run || {}, res = run.resources || {}, cert = pup.certificate || {}, vol = m.root_volume || {};
    const slot = model.slotOf(name);
    const active = Object.values(svc).filter(s => s.active === 'active').length, nsvc = Object.keys(svc).length;
    const role = (pup.classes || []).find(c => /^role::/.test(c)) || m.role;
    const fwOpen = port => (fw.ports || []).indexOf(port + '/tcp') >= 0 || (port === 22 && (fw.services || []).indexOf('ssh') >= 0);

    const out = [];
    out.push(el('div', { class: 'chips' },
      slot && slot.NODE_IS_HEALTHY != null ? chip(slot.NODE_IS_HEALTHY ? 'healthy' : 'unhealthy', slot.NODE_IS_HEALTHY ? 'ok' : 'bad') : null,
      nsvc ? chip(`${active}/${nsvc} services active`, active === nsvc ? 'ok' : 'bad') : null,
      res.total != null ? chip(`${res.changed} of ${res.total} resources changed`, res.failed ? 'bad' : 'ok') : null));

    out.push(sec('instance', 'Instance', kv([
      ['Type', m.instance_type], ['Availability zone', m.availability_zone], ['Private address', m.private_ip],
      ['Public address', fmt.yesno(m.has_public_ip), false],
      ['Root volume', vol.size_gib ? `${vol.size_gib} GiB ${vol.type || ''}${vol.encrypted ? ', encrypted' : ', not encrypted'}` : null],
      ['IMDSv2 required', fmt.yesno(m.imdsv2_required), false], ['Key pair', m.key_pair]])));

    if (n.system) out.push(sec('system', 'System', kv([
      ['OS', sys.os], ['Kernel', sys.kernel], ['Architecture', sys.arch], ['CPUs', sys.cpus], ['Memory', has(sys.memory_mib) ? sys.memory_mib + ' MiB' : null],
      ['Root disk', has(sys.root_disk_gib) ? `${sys.root_disk_gib} GiB, ${sys.root_disk_free_pct} % free` : null], ['SELinux', sys.selinux], ['Uptime', sys.uptime],
      ['Fleet in /etc/hosts', (sys.etc_hosts_fleet || []).length ? list(sys.etc_hosts_fleet) : null, false]])));

    if (nsvc) out.push(sec('services', 'Services', table(['Service', 'Boot', 'State', 'Since (UTC)'],
      Object.keys(svc).map(k => [el('span', { class: 'mono' }, k), svc[k].enabled, state(svc[k].active === 'active', svc[k].active), el('span', { class: 'mono' }, fmt.since(svc[k].since))]))));

    if (listen.length) out.push(sec('network', 'Listening ports',
      table(['Port', 'Process', 'Host firewall', 'Security group'], listen.map(l => [
        el('span', { class: 'mono' }, String(l.port)), el('span', { class: 'mono' }, String(l.process).replace(/:$/, '')),
        fwOpen(l.port) ? state(true, 'open') : el('span', { class: 'muted' }, 'closed'),
        sgFor(l.port) ? sgFor(l.port) : el('span', { class: 'muted' }, 'no rule')])),
      kv([['firewalld zone', fw.zone], ['Services', (fw.services || []).join(', ')], ['Ports', (fw.ports || []).join(', ')]])));

    if (pup.certname || pup.last_run) {
      out.push(sec('openvox', 'OpenVox agent', kv([
        ['Certname', pup.certname], ['Server', typeof pup.server === 'string' ? pup.server : (isCM ? 'this machine' : null)], ['Environment', pup.environment],
        ['Run interval', has(pup.runinterval_s) ? `${pup.runinterval_s} s (${Math.round(pup.runinterval_s / 60)} min)` : null],
        ['Classes', (pup.classes || []).length ? list(pup.classes) : null, false]])));
      if (pup.certificate) out.push(sec('certificate', 'Certificate', kv([
        ['pp_role', cert.pp_role], ['Issuer', cert.issuer], ['Expires', cert.not_after], ['Alt names', cert.alt_names],
        ['Challenge password kept', fmt.yesno(cert.contains_challenge_password), false]]),
      p('The role is an extension of the signed certificate, read as a trusted fact. The node cannot change it.')));
      if (pup.last_run) out.push(sec('run', 'Last agent run', kv([
        ['At', fmt.utc(run.at)], ['Duration', has(run.duration_s) ? run.duration_s + ' s' : null], ['Catalog version', run.config_version], ['Agent version', run.puppet_version],
        ['Resources', res.total], ['Changed', res.changed], ['Corrective changes', res.corrective_change], ['Failed', res.failed], ['Out of sync', res.out_of_sync],
        ['Restarted', res.restarted], ['Failed to restart', res.failed_to_restart], ['Skipped', res.skipped], ['Scheduled', res.scheduled],
        ['Events', run.events ? `${run.events.total} (${run.events.success} success, ${run.events.failure} failure)` : null]]),
      (pup.resources || []).length ? el('details', { class: 'raw' }, el('summary', null, `Managed resources (${Object.keys(pup.resource_counts || {}).map(k => `${pup.resource_counts[k]} ${k}`).join(', ')})`), list(pup.resources)) : null));
    }

    if (isCM && typeof pup.server === 'object') {
      const certs = srv.signed_certificates || {};
      out.push(sec('server', 'OpenVox server', kv([
        ['Admission policy', srv.autosign], ['Pending requests', String((srv.pending_requests || []).length)], ['JVM', srv.java_args], ['Environments', (srv.environments || []).join(', ')]]),
      table(['Signed certificate', 'pp_role', 'Expires', 'Password kept'], Object.keys(certs).map(k => [el('span', { class: 'mono' }, k), el('span', { class: 'mono' }, certs[k].pp_role), certs[k].not_after, fmt.yesno(certs[k].contains_challenge_password)]))));
      out.push(sec('hiera', 'Hiera hierarchy',
        el('ol', { class: 'hier' }, (srv.hiera_hierarchy || []).map(h => el('li', null, el('span', null, h.name), el('span', { class: 'mono' }, h.path)))),
        p('The first file that defines a key wins.'),
        kv([['Data files', (srv.hiera_data_files || []).length ? list(srv.hiera_data_files) : null, false]])));
    }

    if (n.htcondor) {
      const cfg = htc.config || {};
      out.push(sec('htcondor', 'HTCondor', kv([
        ['Version', String(htc.version || '').replace(/^\$CondorVersion:\s*|\s*\$$/g, '')],
        ['Running daemons', (htc.running_daemons || []).length ? list(htc.running_daemons) : null, false],
        ['Configuration files', (htc.config_files || []).join(', ')], ['Pool key present', fmt.yesno(htc.pool_key_present), false], ['Daemon tokens', (htc.daemon_tokens || []).join(', ')]]),
      table(['Setting', 'Value'], Object.keys(cfg).map(k => [el('span', { class: 'mono' }, k), cfg[k] == null ? el('span', { class: 'muted' }, 'not set') : el('span', { class: 'mono' }, String(cfg[k]))]))));
      if (isCM) out.push(poolSection());
    }
    if (Object.keys(n.packages || {}).length) out.push(sec('packages', 'Packages', table(['Package', 'Version'], Object.keys(n.packages).map(k => [el('span', { class: 'mono' }, k), el('span', { class: 'mono' }, n.packages[k])]))));
    out.push(raw({ machine: Object.assign({}, m, { node: undefined }), node: n }));
    return { title: name, sub: role, body: out };
  }

  function poolSection() {
    const h = model.history, q = model.pool.queue || {};
    return sec('pool', 'Pool, as seen by the collector',
      table(['Slot', 'State', 'CPUs', 'MiB', 'Healthy', 'Reason'], model.slots.map(s => [el('span', { class: 'mono' }, s.Name), `${s.State} / ${s.Activity}`, s.Cpus, s.Memory,
        s.NODE_IS_HEALTHY == null ? null : state(s.NODE_IS_HEALTHY === true, String(s.NODE_IS_HEALTHY)), s.NODE_HEALTH_REASON])),
      kv([['Queue', Object.keys(q).length ? JSON.stringify(q) : 'empty'], ['Jobs completed', model.completed],
        ['First completion', h.first_completion ? fmt.utc(h.first_completion) : null], ['Last completion', h.last_completion ? fmt.utc(h.last_completion) : null]]),
      Object.keys(model.byHost).length ? bars(model.byHost) : null,
      (model.pool.pool_daemons || []).length ? el('details', { class: 'raw' }, el('summary', null, `Advertised daemons (${model.pool.pool_daemons.length})`), table(['Type', 'Name'], model.pool.pool_daemons.map(d => [d[0], el('span', { class: 'mono' }, d[1])]))) : null);
  }

  const rulesTable = rs => table(['Direction', 'Ports', 'Protocol', 'Peer', 'Purpose'], rs.map(r => [r.direction, el('span', { class: 'mono' }, fmt.ports(r.ports)), r.protocol === '-1' ? 'all' : r.protocol, r.peer, r.description]));

  const FLOW_TEXT = {
    tofu: ['OpenTofu → AWS API', 'Build time', 'OpenTofu runs in the workspace and calls the AWS API. It creates the network, the security group and one machine per entry of var.nodes, then writes the Ansible inventory from the machines it created.'],
    ssh: ['Ansible over SSH', 'Build time, port 22', 'Ansible pushes once over SSH and only does what must exist before an agent can talk to its server: the OpenVox agent, the certificate request attributes and, on the central manager, the server and its admission policy.'],
    vox: ['OpenVox agent to server', 'Run time, port 8140', 'Each agent pulls a catalog compiled for its role, applies it, and repeats at every run interval, reverting any manual change. The server never pushes.'],
    condor: ['HTCondor daemons', 'Run time, port 9618', 'Every daemon listens on one shared port. Workers advertise their slots to the collector; the negotiator matches waiting jobs with free slots; the schedd sends each job to the startd, which has the last word through its START expression.'],
    out: ['Outbound traffic', 'Any port', 'Machines reach package repositories, DNS and time servers through the internet gateway. There is no NAT: every machine has a public address, and the security group lets nothing in except SSH from one address.'],
  };

  function view(pick) {
    if (!pick) return overview();
    if (pick.kind === 'node') return nodeView(pick.id) || overview();
    if (pick.kind === 'sg') return { title: model.sgName, sub: 'Security group', body: [
      p('One security group holds every machine. The two run-time flows are allowed between members only; the only way in from outside is SSH from a single address.'),
      sec('rules', 'Rules', rulesTable(model.rules)), raw(model.rules)] };
    if (pick.kind === 'net') return { title: infra.region || 'Network', sub: 'AWS network', body: [
      sec('net', 'Network', kv([['Region', infra.region], ['VPC', net.vpc_cidr], ['Subnet', (net.subnet || {}).cidr], ['Availability zone', (net.subnet || {}).availability_zone],
        ['Public address on launch', fmt.yesno((net.subnet || {}).public_ip_on_launch), false], ['Internet gateway', fmt.yesno(net.internet_gateway), false], ['Routes', (net.routes || []).join(', ')]])),
      sec('image', 'Image and access', kv([['Image', (infra.image || {}).name], ['Image owner', (infra.image || {}).owner], ['Architecture', (infra.image || {}).architecture], ['SSH key pair', infra.key_pair]])),
      sec('machines', 'Machines', table(['Name', 'Role', 'Type', 'Private address'], model.machines.map(m => [el('span', { class: 'mono' }, m.name), m.role, el('span', { class: 'mono' }, m.instance_type), el('span', { class: 'mono' }, m.private_ip)]))),
      raw(Object.assign({}, infra, { machines: undefined, security_group_rules: undefined }))] };
    if (pick.kind === 'workspace') return { title: 'Workspace', sub: CONTEXT.workspace, body: [
      p('Where the code lives and where both build tools run. Nothing here is recorded in the snapshot except the commit it was taken from; tool versions come from the project README.'),
      sec('git', 'Deployed code', kv([['Commit', model.git.commit], ['Branch', model.git.branch], ['Uncommitted changes', fmt.yesno(model.git.uncommitted_changes), false]])),
      sec('tools', 'Tools', kv(Object.values(CONTEXT.tools).map(t => [t.name, t.version])))] };
    if (pick.kind === 'internet') return { title: 'Internet', sub: 'Outside AWS', body: [p(FLOW_TEXT.out[2]), sec('rules', 'Rule', rulesTable(model.rules.filter(r => r.direction === 'outbound')))] };
    if (pick.kind === 'ghost') return { title: pick.id, sub: 'No longer exists', body: [
      p(`${pick.id} is not part of this capture. It was added by the scale-out demonstration (one more entry in the OpenTofu node map), ran ${model.byHost[pick.id]} jobs, and was destroyed before the snapshot. The schedd still remembers the jobs it completed.`),
      sec('jobs', 'Jobs completed, by worker', bars(model.byHost))] };
    if (pick.kind === 'jobs') return { title: 'Completed jobs', sub: `${model.completed} in this lab`, body: [
      sec('jobs', 'By worker', bars(model.byHost)),
      kv([['First completion', model.history.first_completion ? fmt.utc(model.history.first_completion) : null], ['Last completion', model.history.last_completion ? fmt.utc(model.history.last_completion) : null], ['Queue now', Object.keys(model.pool.queue || {}).length ? JSON.stringify(model.pool.queue) : 'empty']])] };
    if (pick.kind === 'flow') {
      const t = FLOW_TEXT[pick.id], body = [p(t[2])];
      const port = { ssh: 22, vox: 8140, condor: 9618 }[pick.id];
      const rs = pick.id === 'out' ? model.rules.filter(r => r.direction === 'outbound') : port ? model.rules.filter(r => String(r.ports) === `${port}-${port}`) : [];
      if (rs.length) body.push(sec('rule', 'Security group rule', rulesTable(rs)));
      if (port) body.push(sec('listen', 'Who listens on ' + port, table(['Machine', 'Process', 'Host firewall'], model.machines.map(m => {
        const l = (((m.node.network || {}).listening_tcp) || []).find(x => x.port === port), fw = (m.node.network || {}).firewall || {};
        const open = (fw.ports || []).indexOf(port + '/tcp') >= 0 || (port === 22 && (fw.services || []).indexOf('ssh') >= 0);
        return [el('span', { class: 'mono' }, m.name), l ? el('span', { class: 'mono' }, String(l.process).replace(/:$/, '')) : el('span', { class: 'muted' }, 'nothing'), open ? state(true, 'open') : el('span', { class: 'muted' }, 'closed')];
      }))));
      if (pick.id === 'vox') body.push(sec('runs', 'Last agent runs', table(['Machine', 'At (UTC)', 'Resources', 'Changed'], model.machines.map(m => { const r = (m.node.puppet || {}).last_run || {}; return [el('span', { class: 'mono' }, m.name), el('span', { class: 'mono' }, r.at ? fmt.time(r.at).replace(' UTC', '') : null), (r.resources || {}).total, (r.resources || {}).changed]; }))));
      if (pick.id === 'condor') body.push(poolSection());
      if (pick.id === 'tofu') body.push(sec('made', 'What it created', kv([['Region', infra.region], ['VPC', net.vpc_cidr], ['Subnet', (net.subnet || {}).cidr], ['Internet gateway', fmt.yesno(net.internet_gateway), false], ['Security group rules', model.rules.length], ['Key pair', infra.key_pair], ['Machines', model.machines.map(m => m.name).join(', ')]])));
      return { title: t[0], sub: t[1], body };
    }
    return overview();
  }

  function overview() {
    const f = model.facts;
    return { title: 'Lab at a glance', sub: model.milestone, body: [
      p(S.description || ''),
      sec('facts', 'State at capture', kv([['Captured', fmt.utc(model.captured)], ['Commit', model.git.commit], ['Machines', f.machines],
        f.healthKnown ? ['Slots healthy', `${f.healthySlots} of ${f.slots}`] : ['Slots', f.slots], ['Jobs completed', f.completed], ['Resources changed at last run', `${f.changed} (${f.failed} failed)`],
        ['Certificates signed', f.certs], ['Requests pending', f.pending]])),
      Object.keys(model.byHost).length ? sec('jobs', 'Jobs completed, by worker', bars(model.byHost)) : null,
      sec('machines', 'Machines', el('div', { class: 'links' }, model.machines.map(m => el('button', { type: 'button', class: 'link', onclick: () => hooks.select({ kind: 'node', id: m.name }) }, el('span', { class: 'mono' }, m.name), el('span', null, m.role)))))] };
  }

  function show(pick, closable) {
    const v = view(pick);
    root.replaceChildren(
      el('header', { class: 'insp-head' },
        el('div', null, el('p', { class: 'eyebrow' }, v.sub || ''), el('h2', null, v.title)),
        pick || closable ? el('button', { type: 'button', class: 'icon', 'aria-label': 'Close details', onclick: () => (pick ? hooks.select(null) : hooks.close()) }, '×') : null),
      el('div', { class: 'insp-body' }, v.body));
    root.scrollTop = 0;
    if (pick && pick.part) {
      const map = { instance: 'instance', system: 'system', services: 'services', openvox: 'openvox', certificate: 'certificate', server: 'server', hiera: 'hiera', htcondor: 'htcondor' };
      const t = root.querySelector('#sec-' + (map[pick.part] || pick.part));
      if (t) { root.scrollTop = t.offsetTop - 8; t.classList.add('flash'); }
    }
  }
  return { show, close: () => hooks.close() };
}
