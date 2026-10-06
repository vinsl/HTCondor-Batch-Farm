"""Shared helpers of the lab documentation tools (snapshot.py and demo.py).

Everything that leaves the lab goes through scrub(): known secrets are replaced by <secret> and
public IPv4 addresses by <public-ip> (private 10.x addresses are kept: they describe the topology).
"""

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ANSIBLE_DIR = REPO / "ansible"
TOFU_DIR = REPO / "tofu"
SECRETS_DIR = Path.home() / ".config" / "batchfarm"

# An IPv4 address that is not part of a longer dotted number (an OID such as 1.3.6.1.4.1 is not an IP).
IPV4 = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])")
NON_PUBLIC = re.compile(
    r"^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.)"
)


def _secrets() -> list[str]:
    values = []
    if SECRETS_DIR.is_dir():
        for path in SECRETS_DIR.iterdir():
            value = path.read_text().strip()
            if len(value) >= 8:
                values.append(value)
    return values


_SECRETS = _secrets()


def scrub(text: str) -> str:
    for secret in _SECRETS:
        text = text.replace(secret, "<secret>")

    def public(match: re.Match) -> str:
        ip = match.group(1)
        if NON_PUBLIC.match(ip) or any(int(part) > 255 for part in ip.split(".")):
            return ip
        return "<public-ip>"

    return IPV4.sub(public, text)


def scrub_obj(obj):
    if isinstance(obj, str):
        return scrub(obj)
    if isinstance(obj, list):
        return [scrub_obj(item) for item in obj]
    if isinstance(obj, dict):
        return {key: scrub_obj(value) for key, value in obj.items()}
    return obj


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def local(command: str, timeout: int = 900) -> dict:
    """Run a command on the workspace, from the repository root."""
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return {
            "rc": proc.returncode,
            "stdout": proc.stdout.rstrip(),
            "stderr": proc.stderr.rstrip(),
        }
    except subprocess.TimeoutExpired:
        return {"rc": -1, "stdout": "", "stderr": f"timeout after {timeout}s"}


def ansible(
    pattern: str, module: str, args: str, become: bool = False, timeout: int = 900
) -> dict:
    """Run one Ansible module on the hosts matching pattern. Returns {host: {rc, stdout, stderr}}."""
    env = dict(
        os.environ,
        ANSIBLE_CONFIG=str(
            ANSIBLE_DIR / "ansible.cfg"
        ),  # explicit: a world-writable cwd is ignored
        ANSIBLE_LOAD_CALLBACK_PLUGINS="1",
        ANSIBLE_STDOUT_CALLBACK="ansible.posix.json",
    )
    cmd = ["ansible", pattern, "-m", module, "-a", args] + (["-b"] if become else [])
    try:
        proc = subprocess.run(
            cmd,
            cwd=ANSIBLE_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            pattern: {"rc": -1, "stdout": "", "stderr": f"timeout after {timeout}s"}
        }
    try:
        hosts = json.loads(proc.stdout)["plays"][0]["tasks"][0]["hosts"]
    except (ValueError, KeyError, IndexError):
        return {
            pattern: {
                "rc": -1,
                "stdout": "",
                "stderr": (proc.stderr or proc.stdout)[-2000:],
            }
        }
    results = {}
    for host, res in hosts.items():
        rc = res.get(
            "rc", 0 if not res.get("failed") and not res.get("unreachable") else -1
        )
        stderr = res.get("stderr", "") or ("" if rc == 0 else res.get("msg", ""))
        results[host] = {
            "rc": rc,
            "stdout": (res.get("stdout") or "").rstrip(),
            "stderr": stderr.rstrip(),
        }
    return results


def leak_check(path: Path) -> bool:
    """Scan written files with gitleaks when available. True means no leak found."""
    if not shutil.which("gitleaks"):
        print("warning: gitleaks not found, leak scan skipped")
        return True
    proc = subprocess.run(
        [
            "gitleaks",
            "detect",
            "--no-git",
            "--source",
            str(path),
            "--redact",
            "--no-banner",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode == 0
