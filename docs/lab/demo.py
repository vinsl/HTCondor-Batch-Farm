#!/usr/bin/env python3
"""Tool B: run a demonstration scenario and record every detail of it.

Usage:
    python3 docs/lab/demo.py docs/lab/demos/<name>/scenario.toml            # run and record
    python3 docs/lab/demo.py docs/lab/demos/<name>/scenario.toml --dry-run  # only show the plan

The scenario (TOML) describes the demo as ordered steps. Each step runs one command, on the
workspace ("local") or on a lab node through Ansible, and can then wait until a condition holds.
The recorder writes, next to the scenario:
    record.json   every step: command, host, timestamps, duration, exit code, full output, polls
    RECORD.md     the same as a readable timeline (time since start, why, command, result)

Scenario format:
    title = "Self-healing worker"
    goal  = "What the demonstration proves, in one sentence."

    [[step]]
    title  = "Stop chronyd on wn-01"        # required
    why    = "Simulate a broken service."    # shown in the timeline
    host   = "wn-01"                         # "local" (default) or an Ansible host or group
    run    = "systemctl stop chronyd"        # optional: the command of the step
    become = true                            # run as root on the node (default false)
    expect = "success"                       # "success" (default), "failure" or "any"
    pause  = 0                               # seconds to wait after the step (default 0)

    [step.wait_until]                        # optional: poll until this command succeeds
    host     = "cm-01"
    run      = "condor_status -af NODE_IS_HEALTHY -constraint 'Machine==\"wn-01\"' | grep -q false"
    become   = false
    timeout  = 180                           # seconds (default 300)
    interval = 10                            # seconds between attempts (default 10)

A step whose expectation fails stops the demo (the record is still written, marked failed).
Outputs are scrubbed (known secrets, public IPs) and the record is scanned with gitleaks.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import lablib
import tomllib

MAX_LINES = 80  # per output in RECORD.md (record.json keeps everything)


def execute(host: str, command: str, become: bool, timeout: int = 900) -> dict:
    if host == "local":
        return lablib.local(command, timeout=timeout)
    results = lablib.ansible(host, "shell", command, become=become, timeout=timeout)
    if len(results) == 1:
        return next(iter(results.values()))
    # Several hosts (a group): keep each host's result, fail if any host failed.
    return {
        "rc": max(abs(r["rc"]) for r in results.values()),
        "stdout": "\n".join(
            f"[{h}] {line}"
            for h, r in results.items()
            for line in r["stdout"].splitlines()
        ),
        "stderr": "\n".join(
            f"[{h}] {r['stderr']}" for h, r in results.items() if r["stderr"]
        ),
    }


def expectation_met(expect: str, rc: int) -> bool:
    return expect == "any" or (expect == "success") == (rc == 0)


def run_step(index: int, step: dict, t0: float) -> dict:
    record = {
        "index": index,
        "title": step["title"],
        "why": step.get("why", ""),
        "started_s": round(time.time() - t0, 1),
    }
    start = time.time()
    record["started_at"] = lablib.now()
    if "run" in step:
        host = step.get("host", "local")
        result = execute(host, step["run"], step.get("become", False))
        record["command"] = {
            "host": host,
            "become": step.get("become", False),
            "run": step["run"],
            **result,
        }
        record["ok"] = expectation_met(step.get("expect", "success"), result["rc"])
    else:
        record["ok"] = True
    wait = step.get("wait_until")
    if record["ok"] and wait:
        attempts, deadline = [], time.time() + wait.get("timeout", 300)
        while True:
            res = execute(
                wait.get("host", "local"), wait["run"], wait.get("become", False)
            )
            attempts.append(
                {
                    "at_s": round(time.time() - t0, 1),
                    "rc": res["rc"],
                    "stdout": res["stdout"][-500:],
                }
            )
            if res["rc"] == 0 or time.time() >= deadline:
                break
            time.sleep(wait.get("interval", 10))
        record["wait_until"] = {
            "host": wait.get("host", "local"),
            "run": wait["run"],
            "condition_met": attempts[-1]["rc"] == 0,
            "waited_s": round(time.time() - start, 1),
            "attempts": attempts,
        }
        record["ok"] = attempts[-1]["rc"] == 0
    if step.get("pause"):
        time.sleep(step["pause"])
    record["duration_s"] = round(time.time() - start, 1)
    return record


def mmss(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{int(seconds % 60):02d}"


def clip(text: str) -> str:
    lines = text.splitlines()
    if len(lines) <= MAX_LINES:
        return text
    return "\n".join(
        lines[:MAX_LINES]
        + [f"... ({len(lines) - MAX_LINES} more lines in record.json)"]
    )


def timeline(rec: dict) -> str:
    md = [
        f"# Demo: {rec['title']}",
        "",
        f"> {rec['goal']}",
        "",
        (
            f"Recorded {rec['started_at']} from commit `{rec['git_commit']}`, "
            f"{len(rec['steps'])} steps in {mmss(rec['duration_s'])}. "
            f"Result: **{'success' if rec['success'] else 'FAILED'}**. Full data: `record.json`."
        ),
        "",
    ]
    for step in rec["steps"]:
        md += [f"## {step['index']}. {step['title']}  `+{mmss(step['started_s'])}`", ""]
        if step["why"]:
            md += [step["why"], ""]
        cmd = step.get("command")
        if cmd:
            who = (
                "workspace"
                if cmd["host"] == "local"
                else cmd["host"] + (" (root)" if cmd["become"] else "")
            )
            md += [f"On **{who}**:", "", "```bash", cmd["run"], "```", ""]
            output = "\n".join(part for part in (cmd["stdout"], cmd["stderr"]) if part)
            md += [f"Exit code {cmd['rc']}, {step['duration_s']} s.", ""]
            if output:
                md += ["```text", clip(output), "```", ""]
        wait = step.get("wait_until")
        if wait:
            verdict = "met" if wait["condition_met"] else "NOT met"
            md += [
                (
                    f"Waited for a condition on **{wait['host']}**, {verdict} after {wait['waited_s']} s "
                    f"({len(wait['attempts'])} checks):"
                ),
                "",
                "```bash",
                wait["run"],
                "```",
                "",
            ]
        if not step["ok"]:
            md += [
                "**This step did not meet its expectation: the demo stopped here.**",
                "",
            ]
    return "\n".join(md)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("scenario", type=Path)
    parser.add_argument(
        "--dry-run", action="store_true", help="print the plan without running anything"
    )
    parser.add_argument(
        "--out", type=Path, help="output directory (default: the scenario's directory)"
    )
    args = parser.parse_args()

    scenario = tomllib.loads(args.scenario.read_text())
    steps = scenario.get("step", [])
    if (
        not scenario.get("title")
        or not scenario.get("goal")
        or not steps
        or any("title" not in s for s in steps)
    ):
        print(
            "invalid scenario: title, goal and at least one [[step]] with a title are required"
        )
        return 1
    if args.dry_run:
        print(f"{scenario['title']}: {scenario['goal']}")
        for i, step in enumerate(steps, 1):
            target = step.get("host", "local")
            print(
                f"  {i}. {step['title']}  [{target}] {step.get('run', '(no command)')}"
            )
            if "wait_until" in step:
                print(
                    f"     wait until on {step['wait_until'].get('host', 'local')}: {step['wait_until']['run']}"
                )
        return 0

    out = args.out or args.scenario.parent
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    rec = {
        "title": scenario["title"],
        "goal": scenario["goal"],
        "started_at": lablib.now(),
        "git_commit": lablib.local("git rev-parse --short HEAD")["stdout"],
        "steps": [],
    }
    try:
        for i, step in enumerate(steps, 1):
            print(f"[{mmss(time.time() - t0)}] {i}. {step['title']}")
            result = run_step(i, step, t0)
            rec["steps"].append(result)
            if not result["ok"]:
                print("   expectation not met: stopping")
                break
    finally:
        rec["duration_s"] = round(time.time() - t0, 1)
        rec["success"] = len(rec["steps"]) == len(steps) and all(
            s["ok"] for s in rec["steps"]
        )
        rec = lablib.scrub_obj(rec)
        (out / "record.json").write_text(json.dumps(rec, indent=2) + "\n")
        (out / "RECORD.md").write_text(timeline(rec) + "\n")
    if not lablib.leak_check(out):
        print(f"LEAK DETECTED in {out}: do not commit it")
        return 2
    print(f"record written to {out} ({'success' if rec['success'] else 'FAILED'})")
    return 0 if rec["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
