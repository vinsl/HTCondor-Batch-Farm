#!/usr/bin/env python3
"""Health check run by the HTCondor startd (STARTD_CRON) every minute.

It prints ClassAd attributes on standard output. The startd merges them into the machine's ClassAd,
so the central manager and the START expression can use them. Contract of a startd cron job:
  - one attribute per line, "Name = value"; strings are double-quoted, booleans are True / False;
  - exit code 0 (anything else makes the startd ignore the output).

A node is healthy only if every check passes. Checks are plain functions so they can be tested
without a real machine (see tests/health_check/test_health_check.py).
"""

import shutil
import subprocess
import sys

MIN_FREE_RATIO = 0.10  # refuse jobs when less than 10 % of the disk is free
DISK_PATH = "/var/lib/condor"  # where job scratch directories are created
CRITICAL_SERVICES = ("chronyd",)  # services a worker cannot run jobs without


def disk_ok(path: str, min_free_ratio: float) -> bool:
    """Return True when at least min_free_ratio (0.0 to 1.0) of the filesystem holding path is free.

    TODO(human): shutil.disk_usage(path) returns a named tuple (total, used, free), in bytes.
    Compare free / total with min_free_ratio. A ratio exactly equal to the minimum is acceptable.
    """
    usage = shutil.disk_usage(path)
    return usage.free / usage.total >= min_free_ratio


def service_active(name: str) -> bool:
    """Return True when the systemd service `name` is active.

    TODO(human): run `systemctl is-active <name>` with subprocess.run and look at the RETURN CODE
    (0 means active). Do not parse the text output. Do not let the command print on the terminal:
    capture the output (capture_output=True). Do not use shell=True.
    """
    result = subprocess.run(
        ["systemctl", "is-active", name], capture_output=True, check=False
    )

    return result.returncode == 0


def evaluate() -> tuple[bool, str]:
    """Run all checks and return (healthy, reason).

    reason is "ok" when healthy, otherwise a short text naming the FIRST failed check, for example
    "disk below 10% free" or "service chronyd is not active".

    TODO(human): call disk_ok(DISK_PATH, MIN_FREE_RATIO), then service_active for every service of
    CRITICAL_SERVICES. Return as soon as one check fails.
    """
    if disk_ok(DISK_PATH, MIN_FREE_RATIO) == False:
        return False, f"disk below {MIN_FREE_RATIO:.0%} free"
    for service in CRITICAL_SERVICES:
        if service_active(service) == False:
            return False, f"service {service} is not active"
    return True, "ok"


def format_classad(healthy: bool, reason: str) -> str:
    """Render the ClassAd lines published to the startd, each ending with a newline.

    Exact format expected (the tests check it):
        NODE_IS_HEALTHY = True
        NODE_HEALTH_REASON = "ok"
    A boolean is written True or False (capital first letter), a string is written between double quotes.

    TODO(human): build the two lines.
    """
    classAd = (
        "NODE_IS_HEALTHY = "
        + str(healthy)
        + "\n"
        + "NODE_HEALTH_REASON = "
        + '"'
        + reason
        + '"'
        + "\n"
    )
    return classAd


def main() -> int:
    healthy, reason = evaluate()
    sys.stdout.write(format_classad(healthy, reason))
    return 0


if __name__ == "__main__":
    sys.exit(main())
