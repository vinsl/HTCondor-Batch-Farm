#!/usr/bin/env python3
"""Read-only probe run as root on every lab node by docs/lab/snapshot.py (through `ansible -m script`).

Prints ONE JSON document describing the node: system, services, network, packages, Puppet state,
HTCondor state. It changes nothing on the node. It never reads secret material: no
csr_attributes.yaml, nothing from /etc/condor/passwords.d or tokens.d, no catalog parameter
(only class names and resource titles).
Written for the system Python of AlmaLinux 9 (3.9).
"""

import glob
import json
import os
import platform
import re
import shutil
import socket
import subprocess
from datetime import datetime, timezone

PUPPET = "/opt/puppetlabs/bin/puppet"
STATE = "/opt/puppetlabs/puppet/cache/state"
SSL = "/etc/puppetlabs/puppet/ssl"
PP_ROLE_OID = "1.3.6.1.4.1.34380.1.1.13"
PRIVATE = re.compile(r"^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)")


def proc_name(pid):
    try:
        with open(f"/proc/{pid}/cmdline") as handle:
            argv0 = (
                handle.read().split("\0")[0].split(" ")[0]
            )  # some daemons rewrite their title
        return os.path.basename(argv0) or None
    except OSError:
        return None


def sh(cmd, timeout=120):
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.returncode, proc.stdout.strip()
    except Exception as exc:  # noqa: BLE001 - the probe must never crash on one failing command
        return -1, str(exc)


def out(cmd):
    rc, text = sh(cmd)
    return text if rc == 0 else None


def iso(epoch):
    return (
        datetime.fromtimestamp(float(epoch), timezone.utc).isoformat(timespec="seconds")
        if epoch
        else None
    )


def system():
    release = {}
    with open("/etc/os-release") as handle:
        for line in handle:
            key, _, value = line.strip().partition("=")
            release[key] = value.strip('"')
    mem_kib = 0
    with open("/proc/meminfo") as handle:
        for line in handle:
            if line.startswith("MemTotal:"):
                mem_kib = int(line.split()[1])
    disk = shutil.disk_usage("/")
    return {
        "hostname": socket.gethostname(),
        "os": release.get("PRETTY_NAME"),
        "kernel": platform.release(),
        "arch": platform.machine(),
        "cpus": os.cpu_count(),
        "memory_mib": mem_kib // 1024,
        "root_disk_gib": round(disk.total / 2**30, 1),
        "root_disk_free_pct": round(100 * disk.free / disk.total, 1),
        "selinux": out("getenforce"),
        "uptime": out("uptime -p"),
        "private_ipv4": [
            ip for ip in (out("hostname -I") or "").split() if PRIVATE.match(ip)
        ],
        "etc_hosts_fleet": [
            l
            for l in (
                out(
                    "sed -n '/BEGIN ANSIBLE MANAGED/,/END ANSIBLE MANAGED/p' /etc/hosts"
                )
                or ""
            ).splitlines()
            if not l.startswith("#")
        ],
    }


def services():
    result = {}
    for name in ("sshd", "chronyd", "firewalld", "puppet", "puppetserver", "condor"):
        if sh(f"systemctl cat {name}.service >/dev/null 2>&1")[0] != 0:
            continue
        result[name] = {
            "enabled": sh(f"systemctl is-enabled {name}")[1],
            "active": sh(f"systemctl is-active {name}")[1],
            "since": out(f"systemctl show {name} -p ActiveEnterTimestamp --value"),
        }
    return result


def network():
    listening = {}
    for line in (out("ss -H -lntp") or "").splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        address, _, port = fields[3].rpartition(":")
        process = re.search(r'\(\("([^"]+)",pid=(\d+)', line)
        name = (proc_name(process.group(2)) or process.group(1)) if process else "?"
        key = (int(port), name)
        listening.setdefault(key, set()).add(address)
    firewall = None
    if (
        shutil.which("firewall-cmd")
        and out("systemctl is-active firewalld") == "active"
    ):
        firewall = {
            "zone": out("firewall-cmd --get-default-zone"),
            "services": (out("firewall-cmd --permanent --list-services") or "").split(),
            "ports": (out("firewall-cmd --permanent --list-ports") or "").split(),
        }
    return {
        "listening_tcp": [
            {"port": port, "process": proc, "addresses": sorted(addrs)}
            for (port, proc), addrs in sorted(listening.items())
        ],
        "firewall": firewall,
    }


def packages():
    names = "openvox-agent openvox-server openvox8-release condor htcondor-release epel-release chrony firewalld python3"
    pkgs = {}
    for line in (
        sh(f"rpm -q --qf '%{{NAME}} %{{VERSION}}-%{{RELEASE}}\\n' {names}")[1]
    ).splitlines():
        if "not installed" not in line and " " in line:
            name, version = line.split(" ", 1)
            pkgs[name] = version
    return pkgs


def cert_info(path):
    text = out(f"openssl x509 -in {path} -noout -text") or ""
    role = None
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if PP_ROLE_OID in line and index + 1 < len(lines):
            role = lines[index + 1].strip().lstrip(".").strip()
    issuer = re.search(r"Issuer: (.+)", text)
    not_after = re.search(r"Not After\s*:\s*(.+)", text)
    sans = re.search(r"Subject Alternative Name:\s*\n\s*(.+)", text)
    return {
        "pp_role": role,
        "issuer": issuer.group(1).strip() if issuer else None,
        "not_after": not_after.group(1).strip() if not_after else None,
        "alt_names": sans.group(1).strip() if sans else None,
        "contains_challenge_password": "challenge" in text.lower(),
    }


def puppet():
    if not os.path.exists(PUPPET):
        return None
    certname = out(f"{PUPPET} config print certname")
    info = {
        "certname": certname,
        "server": out(f"{PUPPET} config print server --section agent"),
        "environment": out(f"{PUPPET} config print environment --section agent"),
        "runinterval_s": out(f"{PUPPET} config print runinterval --section agent"),
        "certificate": cert_info(f"{SSL}/certs/{certname}.pem") if certname else None,
    }
    try:
        import yaml

        lastrunfile = out(f"{PUPPET} config print lastrunfile") or os.path.join(
            STATE, "last_run_summary.yaml"
        )
        with open(lastrunfile) as handle:
            summary = yaml.safe_load(handle) or {}
        info["last_run"] = {
            "at": iso(summary.get("time", {}).get("last_run")),
            "duration_s": round(summary.get("time", {}).get("total", 0), 2),
            "config_version": summary.get("version", {}).get("config"),
            "puppet_version": summary.get("version", {}).get("puppet"),
            "resources": summary.get("resources", {}),
            "changes": summary.get("changes", {}).get("total"),
            "events": summary.get("events", {}),
        }
    except Exception as exc:  # noqa: BLE001 - missing file or unexpected format: report it
        info["last_run"] = {"error": str(exc)}
    try:
        with open(os.path.join(STATE, "classes.txt")) as handle:
            info["classes"] = sorted(
                {
                    l.strip()
                    for l in handle
                    if l.strip() and l.strip() not in ("settings", "default")
                }
            )
        with open(os.path.join(STATE, "resources.txt")) as handle:
            resources = sorted({l.strip() for l in handle if l.strip()})
        info["resources"] = resources
        counts = {}
        for ref in resources:
            kind = ref.split("[", 1)[0]
            counts[kind] = counts.get(kind, 0) + 1
        info["resource_counts"] = counts
    except OSError as exc:
        info["classes_error"] = str(exc)

    if os.path.isdir("/opt/puppetlabs/server/apps/puppetserver"):
        signed = {}
        for pem in sorted(glob.glob(SSL + "/ca/signed/*.pem")):
            name = os.path.basename(pem)[:-4]
            signed[name] = cert_info(pem)
        env_dir = "/etc/puppetlabs/code/environments/production"
        hierarchy = None
        try:
            import yaml

            with open(os.path.join(env_dir, "hiera.yaml")) as handle:
                hierarchy = [
                    {"name": lvl.get("name"), "path": lvl.get("path")}
                    for lvl in yaml.safe_load(handle).get("hierarchy", [])
                ]
        except Exception as exc:  # noqa: BLE001 - report instead of failing the whole probe
            hierarchy = {"error": str(exc)}
        info["server"] = {
            "signed_certificates": signed,
            "pending_requests": sorted(
                os.path.basename(p)[:-4] for p in glob.glob(SSL + "/ca/requests/*.pem")
            ),
            "autosign": out(f"{PUPPET} config print autosign --section server"),
            "java_args": out("grep -E '^JAVA_ARGS=' /etc/sysconfig/puppetserver"),
            "environments": sorted(os.listdir("/etc/puppetlabs/code/environments")),
            "hiera_hierarchy": hierarchy,
            "hiera_data_files": sorted(
                os.path.relpath(p, env_dir)
                for p in glob.glob(env_dir + "/data/**/*.yaml", recursive=True)
            ),
        }
    return info


def condor():
    if not shutil.which("condor_config_val"):
        return None
    keys = [
        "DAEMON_LIST",
        "CONDOR_HOST",
        "TRUST_DOMAIN",
        "START",
        "STARTD_CRON_JOBLIST",
        "STARTD_CRON_HEALTH_EXECUTABLE",
        "STARTD_CRON_HEALTH_PERIOD",
        "STARTD_CRON_AUTOPUBLISH",
        "SEC_DEFAULT_AUTHENTICATION_METHODS",
        "USE_SHARED_PORT",
    ]
    config = {key: out(f"condor_config_val {key}") for key in keys}
    info = {
        "version": (out("condor_version") or "").splitlines()[0]
        if out("condor_version")
        else None,
        "config": config,
        "running_daemons": sorted(
            {proc_name(pid) for pid in (out("pgrep condor_") or "").split()} - {None}
        ),
        "config_files": sorted(
            os.path.basename(p) for p in glob.glob("/etc/condor/config.d/*")
        ),
        "pool_key_present": os.path.exists("/etc/condor/passwords.d/POOL"),
        "daemon_tokens": sorted(
            os.path.basename(p) for p in glob.glob("/etc/condor/tokens.d/*")
        ),
    }
    daemons = config.get("DAEMON_LIST") or ""
    if "COLLECTOR" in daemons:
        keep = [
            "Name",
            "Machine",
            "SlotType",
            "State",
            "Activity",
            "Cpus",
            "Memory",
            "TotalCpus",
            "TotalMemory",
            "OpSys",
            "Arch",
            "NODE_IS_HEALTHY",
            "NODE_HEALTH_REASON",
            "LoadAvg",
        ]
        rc, text = sh("condor_status -json")
        try:
            ads = json.loads(text) if rc == 0 and text else []
        except ValueError:
            ads = []
        info["pool_slots"] = [
            {key: ad.get(key) for key in keep if key in ad} for ad in ads
        ]
        info["pool_daemons"] = [
            line.split(None, 1)
            for line in (out("condor_status -any -af MyType Name") or "").splitlines()
        ]
    if "SCHEDD" in daemons:
        status_names = {
            "1": "idle",
            "2": "running",
            "3": "removed",
            "4": "completed",
            "5": "held",
        }
        queue = {}
        for line in (out("condor_q -allusers -af JobStatus") or "").splitlines():
            label = status_names.get(line.strip(), line.strip())
            queue[label] = queue.get(label, 0) + 1
        history = {
            "by_status": {},
            "completed_by_host": {},
            "first_completion": None,
            "last_completion": None,
        }
        dates = []
        for line in (
            out("condor_history -af JobStatus LastRemoteHost CompletionDate") or ""
        ).splitlines():
            fields = line.split()
            if len(fields) < 3:
                continue
            label = status_names.get(fields[0], fields[0])
            history["by_status"][label] = history["by_status"].get(label, 0) + 1
            if label == "completed":
                host = fields[1].split("@")[-1]
                history["completed_by_host"][host] = (
                    history["completed_by_host"].get(host, 0) + 1
                )
                if fields[2].isdigit() and int(fields[2]) > 0:
                    dates.append(int(fields[2]))
        if dates:
            history["first_completion"], history["last_completion"] = (
                iso(min(dates)),
                iso(max(dates)),
            )
        info["queue"] = queue
        info["history"] = history
    return info


def main():
    print(
        json.dumps(
            {
                "system": system(),
                "services": services(),
                "network": network(),
                "packages": packages(),
                "puppet": puppet(),
                "htcondor": condor(),
            }
        )
    )


if __name__ == "__main__":
    main()
