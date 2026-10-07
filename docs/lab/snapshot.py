#!/usr/bin/env python3
"""Tool A: capture the complete state of the lab at a milestone.

Usage (from anywhere, fleet up):
    python3 docs/lab/snapshot.py <NN-milestone-name> "<one sentence: what this milestone is>"

Writes docs/lab/snapshots/<NN-milestone-name>/
    snapshot.json   everything, machine readable (source for diagrams and for the final 3D visual)
    SUMMARY.md      the same content as readable tables

Sources: the OpenTofu state (AWS resources), then node_probe.py run as root on every node
(system, services, network, packages, Puppet, HTCondor). Read-only. Secrets and public IPs are
scrubbed, and the output is scanned with gitleaks before the tool reports success.
"""

import argparse
import json
import sys
from pathlib import Path

import lablib

HERE = Path(__file__).resolve().parent


def infrastructure() -> dict:
    res = lablib.local(f"tofu -chdir={lablib.TOFU_DIR} show -json", timeout=300)
    if res["rc"] != 0:
        return {"error": res["stderr"][-500:]}
    values = json.loads(res["stdout"]).get("values", {}).get("root_module", {})
    resources = list(values.get("resources", []))
    for child in values.get("child_modules", []):
        resources += child.get("resources", [])

    infra = {
        "machines": [],
        "security_group_rules": [],
        "network": {},
        "image": None,
        "key_pair": None,
    }
    sg_ids = {
        r["values"]["id"]: r["values"]["name"]
        for r in resources
        if r["type"] == "aws_security_group"
    }
    for r in resources:
        v, kind = r["values"], r["type"]
        if kind == "aws_instance":
            disk = (v.get("root_block_device") or [{}])[0]
            infra["machines"].append(
                {
                    "name": v["tags"].get("Name"),
                    "role": v["tags"].get("Role"),
                    "instance_type": v["instance_type"],
                    "availability_zone": v["availability_zone"],
                    "private_ip": v["private_ip"],
                    "has_public_ip": bool(v.get("public_ip")),
                    "root_volume": {
                        "size_gib": disk.get("volume_size"),
                        "type": disk.get("volume_type"),
                        "encrypted": disk.get("encrypted"),
                    },
                    "imdsv2_required": (v.get("metadata_options") or [{}])[0].get(
                        "http_tokens"
                    )
                    == "required",
                    "key_pair": v.get("key_name"),
                }
            )
        elif kind == "aws_vpc":
            infra["network"]["vpc_cidr"] = v["cidr_block"]
        elif kind == "aws_subnet":
            infra["network"]["subnet"] = {
                "cidr": v["cidr_block"],
                "availability_zone": v["availability_zone"],
                "public_ip_on_launch": v["map_public_ip_on_launch"],
            }
            infra["region"] = v["availability_zone"][:-1]
        elif kind == "aws_internet_gateway":
            infra["network"]["internet_gateway"] = True
        elif kind == "aws_route_table":
            infra["network"]["routes"] = [
                route.get("cidr_block") for route in v.get("route", [])
            ]
        elif kind in (
            "aws_vpc_security_group_ingress_rule",
            "aws_vpc_security_group_egress_rule",
        ):
            if v.get("referenced_security_group_id"):
                source = "members of " + sg_ids.get(
                    v["referenced_security_group_id"], "the security group"
                )
            elif v.get("cidr_ipv4") == "0.0.0.0/0":
                source = "anywhere (0.0.0.0/0)"
            else:
                source = "admin workstation (single /32)"
            infra["security_group_rules"].append(
                {
                    "direction": "inbound"
                    if kind.endswith("ingress_rule")
                    else "outbound",
                    "description": v.get("description"),
                    "protocol": v.get("ip_protocol"),
                    "ports": None
                    if v.get("from_port") is None
                    else f"{v['from_port']}-{v['to_port']}",
                    "peer": source,
                }
            )
        elif kind == "aws_ami":
            infra["image"] = {
                "name": v.get("name"),
                "owner": v.get("owner_id"),
                "architecture": v.get("architecture"),
            }
        elif kind == "aws_key_pair":
            infra["key_pair"] = v.get("key_name")
    infra["machines"].sort(key=lambda m: m["name"] or "")
    return infra


def nodes() -> dict:
    results = lablib.ansible("all", "script", str(HERE / "node_probe.py"), become=True)
    probes = {}
    for host, res in sorted(results.items()):
        try:
            probes[host] = json.loads(res["stdout"])
        except ValueError:
            probes[host] = {"error": (res["stderr"] or res["stdout"])[-1000:]}
    return probes


def git_info() -> dict:
    def get(cmd):
        return lablib.local(cmd)["stdout"]

    return {
        "commit": get("git rev-parse --short HEAD"),
        "branch": get("git branch --show-current"),
        # Only the deployed code counts: evidence written under docs/lab/ is not part of the lab.
        "uncommitted_changes": bool(get("git status --porcelain -- . ':!docs/lab'")),
    }


# ----------------------------------------------------------------------------------------------
# SUMMARY.md


def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += [
        "| " + " | ".join("" if c is None else str(c) for c in row) + " |"
        for row in rows
    ]
    return "\n".join(lines)


def summary(snap: dict) -> str:
    infra, probes = snap["infrastructure"], snap["nodes"]
    md = [
        f"# Lab snapshot: {snap['milestone']}",
        "",
        f"> {snap['description']}",
        "",
        (
            f"Captured {snap['captured_at']} from commit `{snap['git']['commit']}` "
            f"(branch `{snap['git']['branch']}`{', with uncommitted changes' if snap['git']['uncommitted_changes'] else ''}). "
            "Full data: `snapshot.json`."
        ),
        "",
        "## Infrastructure (AWS)",
        "",
    ]
    if "error" in infra:
        md += [f"Not available: {infra['error']}", ""]
    else:
        net = infra.get("network", {})
        md += [
            (
                f"- Region **{infra.get('region')}**, VPC `{net.get('vpc_cidr')}`, one public subnet "
                f"`{net.get('subnet', {}).get('cidr')}`, internet gateway: {net.get('internet_gateway', False)}, no NAT."
            ),
            f"- Image: {(infra.get('image') or {}).get('name')}. SSH key pair: `{infra.get('key_pair')}`.",
            "",
        ]
        rows = []
        for m in infra["machines"]:
            p = probes.get(m["name"], {}).get("system", {})
            v = m["root_volume"]
            rows.append(
                [
                    f"**{m['name']}**",
                    m["role"],
                    m["instance_type"],
                    p.get("cpus"),
                    p.get("memory_mib"),
                    m["private_ip"],
                    f"{v['size_gib']} GiB {v['type']}{' encrypted' if v['encrypted'] else ''}",
                    "yes" if m["imdsv2_required"] else "no",
                ]
            )
        md += [
            table(
                [
                    "Machine",
                    "Role",
                    "Type",
                    "vCPU",
                    "RAM (MiB)",
                    "Private IP",
                    "Disk",
                    "IMDSv2",
                ],
                rows,
            ),
            "",
        ]
        md += [
            "### Security group rules",
            "",
            table(
                ["Direction", "Ports", "Protocol", "Peer", "Purpose"],
                [
                    [
                        r["direction"],
                        r["ports"] or "all",
                        r["protocol"],
                        r["peer"],
                        r["description"],
                    ]
                    for r in infra["security_group_rules"]
                ],
            ),
            "",
        ]

    md += ["## Nodes", ""]
    for host, p in probes.items():
        if "error" in p:
            md += [f"### {host}", "", f"Probe failed: `{p['error'][:300]}`", ""]
            continue
        s, net = p["system"], p["network"]
        md += [
            f"### {host}",
            "",
            (
                f"{s['os']}, kernel {s['kernel']}, SELinux {s['selinux']}, {s['cpus']} vCPU, {s['memory_mib']} MiB, "
                f"root disk {s['root_disk_gib']} GiB ({s['root_disk_free_pct']} % free), {s['uptime']}."
            ),
            "",
            table(
                ["Service", "Enabled", "Active", "Since"],
                [
                    [n, v["enabled"], v["active"], v["since"]]
                    for n, v in p["services"].items()
                ],
            ),
            "",
            "Listening TCP ports: "
            + ", ".join(f"{l['port']} ({l['process']})" for l in net["listening_tcp"])
            + ".",
            "",
        ]
        if net.get("firewall"):
            fw = net["firewall"]
            md += [
                f"Firewall (zone {fw['zone']}): services {', '.join(fw['services'])}; ports {', '.join(fw['ports']) or 'none'}.",
                "",
            ]
        md += [
            "Packages: "
            + ", ".join(f"{k} {v}" for k, v in p["packages"].items())
            + ".",
            "",
        ]

    md += ["## Configuration management (OpenVox)", ""]
    server = next(
        (
            p["puppet"]["server"]
            for p in probes.values()
            if (p.get("puppet") or {}).get("server")
        ),
        None,
    )
    if server:
        md += [
            f"- Autosign policy: `{server['autosign']}`. Pending requests: {len(server['pending_requests'])}.",
            f"- JVM: `{server['java_args']}`. Environments: {', '.join(server['environments'])}.",
            "- Hiera hierarchy (first match wins): "
            + " -> ".join(f"`{lvl['path']}`" for lvl in server["hiera_hierarchy"] or [])
            + ".",
            "",
            table(
                [
                    "Signed certificate",
                    "pp_role (in the certificate)",
                    "Challenge password stored",
                    "Expires",
                ],
                [
                    [n, c["pp_role"], c["contains_challenge_password"], c["not_after"]]
                    for n, c in server["signed_certificates"].items()
                ],
            ),
            "",
        ]
    rows = []
    for host, p in probes.items():
        pu = p.get("puppet") or {}
        run = pu.get("last_run") or {}
        res = run.get("resources") or {}
        rows.append(
            [
                host,
                (pu.get("certificate") or {}).get("pp_role"),
                run.get("at"),
                res.get("total"),
                res.get("changed"),
                res.get("failed"),
                res.get("out_of_sync"),
                ", ".join(
                    c
                    for c in pu.get("classes", [])
                    if c.startswith(("role::", "profile::"))
                ),
            ]
        )
    md += [
        table(
            [
                "Node",
                "Role",
                "Last agent run",
                "Resources",
                "Changed",
                "Failed",
                "Out of sync",
                "Role and profiles",
            ],
            rows,
        ),
        "",
    ]

    md += ["## Batch system (HTCondor)", ""]
    rows = []
    for host, p in probes.items():
        hc = p.get("htcondor") or {}
        cfg = hc.get("config") or {}
        rows.append(
            [
                host,
                hc.get("version", "").split(" ")[1] if hc.get("version") else None,
                cfg.get("DAEMON_LIST"),
                ", ".join(hc.get("running_daemons", [])),
                hc.get("pool_key_present"),
            ]
        )
    md += [
        table(
            ["Node", "Version", "Configured daemons", "Running processes", "Pool key"],
            rows,
        ),
        "",
    ]
    central = next(
        (
            p["htcondor"]
            for p in probes.values()
            if (p.get("htcondor") or {}).get("pool_slots") is not None
        ),
        None,
    )
    if central:
        md += [
            "### Slots seen by the central manager",
            "",
            table(
                [
                    "Slot",
                    "State",
                    "Activity",
                    "CPUs",
                    "Memory (MiB)",
                    "Healthy",
                    "Health reason",
                ],
                [
                    [
                        s.get("Name"),
                        s.get("State"),
                        s.get("Activity"),
                        s.get("Cpus"),
                        s.get("Memory"),
                        s.get("NODE_IS_HEALTHY"),
                        s.get("NODE_HEALTH_REASON"),
                    ]
                    for s in central["pool_slots"]
                ],
            ),
            "",
        ]
    submit = next(
        (
            p["htcondor"]
            for p in probes.values()
            if (p.get("htcondor") or {}).get("history") is not None
        ),
        None,
    )
    if submit:
        hist = submit["history"]
        md += [
            f"- Queue now: {submit['queue'] or 'empty'}.",
            (
                f"- Job history: {hist['by_status']}; completed per worker: {hist['completed_by_host']} "
                f"(from {hist['first_completion']} to {hist['last_completion']})."
            ),
            f"- START expression on the workers: `{next((p['htcondor']['config']['START'] for p in probes.values() if 'STARTD' in ((p.get('htcondor') or {}).get('config') or {}).get('DAEMON_LIST', '')), None)}`.",
            "",
        ]
    return "\n".join(md)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("milestone", help="folder name, for example 01-htcondor-pool")
    parser.add_argument("description", help="one sentence describing the milestone")
    parser.add_argument(
        "--out", type=Path, default=HERE / "snapshots", help="parent output directory"
    )
    parser.add_argument(
        "--force", action="store_true", help="overwrite an existing snapshot"
    )
    args = parser.parse_args()

    target = args.out / args.milestone
    if target.exists() and not args.force:
        print(f"{target} already exists (use --force to overwrite)")
        return 1

    print("collecting infrastructure (OpenTofu state)...")
    infra = infrastructure()
    print("probing every node (read-only)...")
    probes = nodes()
    snap = lablib.scrub_obj(
        {
            "milestone": args.milestone,
            "description": args.description,
            "captured_at": lablib.now(),
            "git": git_info(),
            "infrastructure": infra,
            "nodes": probes,
        }
    )
    target.mkdir(parents=True, exist_ok=True)
    (target / "snapshot.json").write_text(json.dumps(snap, indent=2) + "\n")
    (target / "SUMMARY.md").write_text(summary(snap) + "\n")

    failed = [h for h, p in probes.items() if "error" in p]
    if not lablib.leak_check(target):
        print(f"LEAK DETECTED in {target}: do not commit it")
        return 2
    print(
        f"snapshot written to {target}"
        + (f" (probe failed on: {', '.join(failed)})" if failed else "")
    )
    return 1 if failed or "error" in infra else 0


if __name__ == "__main__":
    sys.exit(main())
