/* ------------------------------------------------- snapshot.json -> model */

/**
 * Facts that are true of the project but are not recorded in snapshot.json
 * (the snapshot tool captures AWS and the nodes, not the workspace).
 * Source: the project README ("Versions", "How it works").
 */
const CONTEXT = {
  project: 'HTCondor Batch Farm as Code',
  workspace: 'GitHub Codespace',
  // a host that completed jobs but is not in the capture: in this project, the worker of the scale-out demonstration
  goneWorker: ['added by the scale-out demo,', 'destroyed before this capture'],
  tools: {
    tofu: { name: 'OpenTofu', version: '1.13.1' },
    ansible: { name: 'Ansible', version: 'core 2.21.4' },
  },
  steps: [
    { n: 1, key: 'tofu', verb: 'Provision', tool: 'OpenTofu',
      text: 'Builds the network, the security group and one machine per entry of var.nodes, then writes the Ansible inventory from the machines it created.' },
    { n: 2, key: 'ansible', verb: 'Bootstrap', tool: 'Ansible',
      text: 'Installs the OpenVox agent and writes the certificate request attributes: the node’s role and a challenge password. On the central manager it also installs the OpenVox server and its admission policy.' },
    { n: 3, key: 'vox', verb: 'Admit', tool: 'OpenVox server',
      text: 'A policy script signs a certificate request only if its challenge password matches. The role is written into the signed certificate, so the node cannot change it.' },
    { n: 4, key: 'vox', verb: 'Configure', tool: 'OpenVox agents',
      text: 'Each agent pulls a catalog compiled for its role, applies it, and repeats every 30 minutes, reverting any manual change.' },
    { n: 5, key: 'condor', verb: 'Compute', tool: 'HTCondor',
      text: 'Workers advertise their CPUs and memory; the negotiator matches waiting jobs with free slots.' },
    { n: 6, key: 'ok', verb: 'Self-heal', tool: 'Health check',
      text: 'Every minute each worker checks itself and publishes the result. A sick worker refuses new jobs by itself, and comes back once OpenVox has repaired it.' },
  ],
};

function buildModel(S) {
  const infra = S.infrastructure || {};
  const nodes = S.nodes || {};
  const machines = (infra.machines || []).map(m => Object.assign({}, m, { node: nodes[m.name] || {} }));
  if (!machines.length) throw new Error('This file has no infrastructure.machines: it is not a lab snapshot.');
  const cm = machines.find(m => m.role === 'central_manager') || machines[0];
  const workers = machines.filter(m => m !== cm);

  const pool = (cm.node.htcondor) || {};
  const slots = pool.pool_slots || [];
  const history = pool.history || {};
  const byHost = history.completed_by_host || {};
  const completed = (history.by_status && history.by_status.completed) || Object.values(byHost).reduce((a, b) => a + b, 0);
  // Hosts that ran jobs but no longer exist (the scale-out worker, destroyed before this capture)
  const ghosts = Object.keys(byHost).filter(h => !machines.some(m => m.name === h)).sort();

  const server = (cm.node.puppet && typeof cm.node.puppet.server === 'object') ? cm.node.puppet.server : {};
  const slotOf = name => slots.find(s => s.Machine === name) || null;

  const runs = machines.map(m => ((m.node.puppet || {}).last_run || {}).resources || {});
  const totals = runs.map(r => r.total).filter(n => n != null);
  const rules = infra.security_group_rules || [];
  const sgName = (rules.map(r => /members of (\S+)/.exec(r.peer || '')).find(Boolean) || [])[1] || 'security group';

  return {
    raw: S, infra, machines, cm, workers, ghosts, pool, slots, history, byHost, completed, server, slotOf, rules, sgName,
    net: infra.network || {},
    milestone: S.milestone || 'snapshot',
    captured: S.captured_at,
    git: S.git || {},
    facts: {
      machines: machines.length,
      slots: slots.length,
      healthySlots: slots.filter(s => s.NODE_IS_HEALTHY === true).length,
      healthKnown: slots.some(s => s.NODE_IS_HEALTHY != null),
      cpus: slots.reduce((a, s) => a + (s.TotalCpus || s.Cpus || 0), 0),
      completed,
      changed: runs.reduce((a, r) => a + (r.changed || 0), 0),
      failed: runs.reduce((a, r) => a + (r.failed || 0), 0),
      resMin: totals.length ? Math.min.apply(null, totals) : null,
      resMax: totals.length ? Math.max.apply(null, totals) : null,
      certs: Object.keys(server.signed_certificates || {}).length,
      pending: (server.pending_requests || []).length,
    },
  };
}

/** Services of a node that are 'active', as {name: bool}. */
function serviceStates(m) {
  const out = {};
  const sv = m.node.services || {};
  for (const k in sv) out[k] = sv[k].active === 'active';
  return out;
}
