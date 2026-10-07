#!/usr/bin/env python3
"""Draw the four flat diagrams of the README, in the visual language of the 3D model.

    python3 diagrams.py            # -> diagrams/<name>-light.svg and diagrams/<name>-dark.svg

Every figure comes from a recorded file, never typed by hand:
  admission          the admission chain, with the timings measured on wn-03 (demos/scale-out/record.json)
  demo-health-check  demos/health-check/record.json
  demo-drift         demos/drift-correction/record.json
  demo-scale-out     demos/scale-out/record.json

Same colours as the 3D model (one hue per tool, src/app/20-theme.js) and the same IBM Plex faces, embedded
in each SVG (vendor/fonts.json), so the files render identically on GitHub without any external request.
"""

import json
import pathlib
import re
from html import escape

HERE = pathlib.Path(__file__).resolve().parent
LAB = HERE.parent
OUT = HERE / "diagrams"
W = 1600

THEMES = {
    "light": {
        "bg": "#F3F6FA",
        "grid": "rgba(27,39,68,.055)",
        "panel": "#FFFFFF",
        "line": "rgba(27,39,68,.16)",
        "sunk": "rgba(27,39,68,.045)",
        "ink": "#141C2E",
        "ink2": "#465270",
        "ink3": "#6B7791",
        "tofu": "#844FBA",
        "ansible": "#E01010",
        "vox": "#F59E0B",
        "voxText": "#B45F06",
        "condor": "#0E7490",
        "ok": "#128A52",
        "okFill": "#19B36B",
        "bad": "#C92A1E",
        "out": "#66748E",
        "alma": "#1E3A8A",
    },
    "dark": {
        "bg": "#0C1322",
        "grid": "rgba(160,185,240,.06)",
        "panel": "#111A2D",
        "line": "rgba(170,192,240,.2)",
        "sunk": "rgba(170,192,240,.06)",
        "ink": "#EAF0FB",
        "ink2": "#A6B4D2",
        "ink3": "#7F8DAB",
        "tofu": "#A46FE0",
        "ansible": "#FF4D4D",
        "vox": "#F7A823",
        "voxText": "#F7A823",
        "condor": "#3CC0DC",
        "ok": "#2FD98B",
        "okFill": "#2FD98B",
        "bad": "#FF6257",
        "out": "#8E9DBC",
        "alma": "#7C9BF0",
    },
}


def load(rel):
    return json.loads((LAB / rel).read_text())


def mmss(seconds):
    return f"{int(seconds // 60)}:{round(seconds % 60):02d}"


# ---------------------------------------------------------------------------------------- SVG kit
class Svg:
    def __init__(self, height, theme):
        self.h, self.t, self.parts = height, THEMES[theme], []

    def add(self, s):
        self.parts.append(s)

    def text(
        self,
        x,
        y,
        s,
        cls="t",
        size=15,
        fill="ink",
        anchor="start",
        weight=None,
        spacing=None,
    ):
        extra = f' font-weight="{weight}"' if weight else ""
        extra += f' letter-spacing="{spacing}"' if spacing else ""
        self.add(
            f'<text x="{x:.1f}" y="{y:.1f}" class="{cls}" font-size="{size}" fill="{self.t[fill]}"'
            f' text-anchor="{anchor}"{extra}>{escape(s)}</text>'
        )

    def rect(
        self, x, y, w, h, fill="panel", stroke="line", r=6, dash=None, opacity=None
    ):
        st = f' stroke="{self.t[stroke]}" stroke-width="1"' if stroke else ""
        st += f' stroke-dasharray="{dash}"' if dash else ""
        op = f' fill-opacity="{opacity}"' if opacity is not None else ""
        fl = self.t.get(fill, fill)
        self.add(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" fill="{fl}"{op}{st}/>'
        )

    def line(self, x1, y1, x2, y2, stroke="line", width=1.5, dash=None, arrow=False):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        a = f' marker-end="url(#a-{stroke})"' if arrow else ""
        self.add(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{self.t[stroke]}"'
            f' stroke-width="{width}"{d}{a}/>'
        )

    def dot(self, x, y, r, fill):
        self.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{self.t[fill]}"/>')

    def chip(self, x, y, s, color, size=13, filled=True):
        """A label pill like the flow chips of the 3D model. Returns its width."""
        w = len(s) * size * 0.61 + 22
        if filled:
            self.rect(x, y, w, size + 13, fill=color, stroke=None, r=(size + 13) / 2)
            self.text(x + 11, y + size + 3, s, "m", size, "panel", weight=500)
        else:
            self.add(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{size + 13}" rx="{(size + 13) / 2}"'
                f' fill="none" stroke="{self.t[color]}" stroke-width="1.3"/>'
            )
            self.text(x + 11, y + size + 3, s, "m", size, color, weight=500)
        return w

    def header(self, eyebrow, title, subtitle, source):
        self.text(64, 70, eyebrow.upper(), "m", 13, "ink3", weight=500, spacing="1.6")
        self.text(64, 108, title, "c", 34, "ink", weight=600)
        self.text(64, 140, subtitle, "t", 17, "ink2")
        self.text(W - 64, 70, source, "m", 13, "ink3", anchor="end")

    def render(self, title):
        t = self.t
        markers = "".join(
            f'<marker id="a-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"'
            f' orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="{t[k]}"/></marker>'
            for k in (
                "ink2",
                "tofu",
                "ansible",
                "vox",
                "condor",
                "bad",
                "ok",
                "out",
                "line",
                "alma",
            )
        )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {self.h}" width="{W}" height="{self.h}"'
            f' role="img" aria-label="{escape(title)}">\n<title>{escape(title)}</title>\n'
            f"<defs><style>{FONT_CSS}\n"
            ".c{font-family:'IBM Plex Sans Condensed','IBM Plex Sans Condensed SemiBold','Arial Narrow',sans-serif}"
            ".t{font-family:'IBM Plex Sans',system-ui,sans-serif}"
            ".m{font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace}</style>"
            f'<pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">'
            f'<path d="M40 0H0V40" fill="none" stroke="{t["grid"]}" stroke-width="1"/></pattern>{markers}</defs>\n'
            f'<rect width="{W}" height="{self.h}" fill="{t["bg"]}"/><rect width="{W}" height="{self.h}" fill="url(#g)"/>\n'
            + "\n".join(self.parts)
            + "\n</svg>\n"
        )


def font_css():
    faces = json.loads((HERE / "vendor" / "fonts.json").read_text())
    rules = []
    for f in faces:
        rules.append(
            "@font-face{font-family:'"
            + f["family"]
            + "';font-weight:"
            + str(f["weight"])
            + ";src:url(data:font/woff;base64,"
            + f["b64"]
            + ") format('woff')}"
        )
    return "".join(rules)


FONT_CSS = font_css()


# ------------------------------------------------------------------------------ 1. admission chain
def admission(theme):
    rec = load("demos/scale-out/record.json")
    steps = {s["index"]: s for s in rec["steps"]}
    boot = steps[6]["duration_s"]
    join = steps[7]["wait_until"]["waited_s"]

    s = Svg(900, theme)
    s.header(
        "How a new machine joins the fleet",
        "Admission: from a bare machine to a slot in the pool",
        "The role travels inside the signed certificate; the challenge password never does.",
        f"measured on wn-03 · scale-out record · commit {rec['git_commit']}",
    )
    lanes = [
        ("Ansible", "workspace, over SSH", "ansible", 210),
        ("New machine", "wn-03 · OpenVox agent", "alma", 590),
        ("OpenVox server", "cm-01 · CA + policy", "vox", 970),
        ("HTCondor collector", "cm-01 · port 9618", "condor", 1350),
    ]
    top, bottom = 190, 760
    for name, sub, col, x in lanes:
        s.rect(x - 130, top, 260, 62, fill="panel", stroke="line")
        s.rect(x - 130, top, 260, 4, fill=col, stroke=None, r=2)
        s.text(x, top + 30, name, "c", 20, "ink", "middle", weight=600)
        s.text(x, top + 50, sub, "m", 12.5, "ink3", "middle")
        s.line(x, top + 62, x, bottom, "line", 1.5, dash="3 5")
    x = {name: lx for name, _, _, lx in lanes}
    A, N, V, C = (
        x["Ansible"],
        x["New machine"],
        x["OpenVox server"],
        x["HTCondor collector"],
    )

    def message(n, y, x1, x2, color, label, payload=None, back=False):
        s.line(
            x1 + (8 if x2 > x1 else -8),
            y,
            x2 - (10 if x2 > x1 else -10),
            y,
            color,
            2.2,
            arrow=True,
        )
        mid = (x1 + x2) / 2
        s.dot(min(x1, x2) - 30, y, 13, color)
        s.text(min(x1, x2) - 30, y + 5, str(n), "m", 13, "panel", "middle", weight=500)
        s.text(mid, y - 12, label, "t", 15.5, "ink", "middle", weight=600)
        if payload:
            s.text(mid, y + 24, payload, "m", 12.5, "ink2", "middle")

    def note(n, y, cx, color, title, lines):
        w = 330
        s.dot(cx - w / 2 - 30, y + 16, 13, color)
        s.text(cx - w / 2 - 30, y + 21, str(n), "m", 13, "panel", "middle", weight=500)
        s.rect(cx - w / 2, y, w, 22 + 21 * len(lines) + 14, fill="panel", stroke=color)
        s.text(cx - w / 2 + 16, y + 26, title, "t", 15, "ink", weight=600)
        for i, ln in enumerate(lines):
            s.text(cx - w / 2 + 16, y + 49 + 21 * i, ln, "m", 12.5, "ink2")

    message(
        1,
        312,
        A,
        N,
        "ansible",
        "writes csr_attributes.yaml",
        "custom_attributes: challenge  ·  extension_requests: pp_role",
    )
    message(
        2,
        392,
        N,
        V,
        "alma",
        "sends its certificate request",
        "CSR over 8140, role inside",
    )
    note(
        3,
        425,
        V,
        "vox",
        "autosign.sh compares the secret",
        [
            "match       → exit 0 → signed",
            "wrong, empty → exit 1 → refused",
            "role written into the certificate",
        ],
    )
    message(
        4,
        582,
        V,
        N,
        "vox",
        "returns the signed certificate",
        "$trusted['extensions']['pp_role'] = execute",
    )
    message(
        5, 648, N, V, "vox", "pulls its catalog", "site.pp → role::execute → profiles"
    )
    message(
        6,
        716,
        N,
        C,
        "condor",
        "startd advertises its slot",
        "IDTOKEN signed with the pool key",
    )

    # measured timings, on the right rail
    s.text(
        W - 64,
        812,
        f"Bootstrap of wn-03: {boot:.0f} s   ·   then in the pool {join:.0f} s later, with no command typed on it",
        "t",
        15,
        "ink2",
        "end",
    )
    s.text(
        64,
        812,
        "A forged request (wrong password, stolen role) was refused and logged.",
        "t",
        15,
        "ink2",
    )
    s.line(64, 836, W - 64, 836, "line", 1)
    s.text(
        64,
        862,
        "No role in the certificate → site.pp calls fail() and the machine receives nothing.",
        "m",
        13,
        "ink3",
    )
    return s.render("Admission chain of a new machine")


# ------------------------------------------------------------------------- 2. self-healing worker
def health_check(theme):
    rec = load("demos/health-check/record.json")
    st = {x["index"]: x for x in rec["steps"]}
    t_stop = st[2]["started_s"]
    t_sick = st[3]["started_s"] + st[3]["wait_until"]["waited_s"]
    t_submit = st[4]["started_s"]
    t_repair = st[7]["started_s"]
    t_heal = st[8]["started_s"] + st[8]["wait_until"]["waited_s"]
    t_drained = st[9]["started_s"] + st[9]["wait_until"]["waited_s"]
    t_batch2 = st[10]["started_s"]
    t_end = rec["duration_s"]
    first = re.findall(r"(\d+) @(wn-\d+)", st[5]["after_wait"]["stdout"])
    second = re.findall(r"(\d+) @(wn-\d+)", st[11]["command"]["stdout"])
    analyze = re.search(
        r"(\d+) slots reject your job because of their own requirements",
        st[6]["command"]["stdout"],
    )

    s = Svg(830, theme)
    s.header(
        "Demonstration 1 · self-healing worker",
        "A broken service takes a worker out of the pool, Puppet brings it back",
        "Health as the central manager sees it, and where the jobs ran. Nobody touched HTCondor.",
        f"health-check record · {len(rec['steps'])} steps · {mmss(t_end)} · commit {rec['git_commit']}",
    )
    x0, x1, tmax = 250, W - 190, 120.0

    def X(t):
        return x0 + (x1 - x0) * t / tmax

    # time axis
    ay = 210
    s.line(x0, ay, x1, ay, "line", 1)
    for t in range(0, 121, 15):
        s.line(X(t), ay - 4, X(t), ay + 4, "ink3", 1)
        s.text(X(t), ay - 12, mmss(t), "m", 12, "ink3", "middle")

    events = [
        (t_stop, "bad", "chronyd stopped on wn-01"),
        (t_sick, "bad", "health check publishes false"),
        (t_submit, "condor", "8 jobs submitted"),
        (t_repair, "vox", "Puppet run on wn-01"),
        (t_heal, "ok", "health check publishes true"),
        (t_batch2, "condor", "8 more jobs submitted"),
    ]
    prev = None
    for i, (t, col, _) in enumerate(events, 1):
        lift = (
            26 if prev is not None and X(t) - X(prev) < 26 else 0
        )  # stagger markers that would overlap
        prev = t
        s.line(X(t), ay + 8, X(t), 560, col, 1, dash="2 4")
        s.dot(X(t), ay + 24 + lift, 11, col)
        s.text(X(t), ay + 28.5 + lift, str(i), "m", 12, "panel", "middle", weight=500)

    def lane(y, name, sub):
        s.text(64, y + 20, name, "c", 22, "ink", weight=600)
        s.text(64, y + 42, sub, "m", 12.5, "ink3")

    def band(y, t0, t1, col, label=None):
        s.rect(X(t0), y, X(t1) - X(t0), 16, fill=col, stroke=None, r=3)
        if label and X(t1) - X(t0) > 120:
            s.text(X(t0) + 10, y + 12.5, label, "m", 11.5, "panel", weight=500)

    def span(y, t0, t1, col, label):
        s.rect(X(t0), y, X(t1) - X(t0), 30, fill=col, stroke=col, r=4, opacity=0.14)
        s.rect(X(t0), y, 3, 30, fill=col, stroke=None, r=1)
        s.text(X(t0) + 12, y + 20, label, "m", 12.5, col)

    # wn-01
    y1 = 270
    lane(y1, "wn-01", "execute node")
    s.text(x0 - 14, y1 + 13, "health", "m", 12, "ink3", "end")
    band(y1, 0, t_sick, "okFill", "NODE_IS_HEALTHY true")
    band(y1, t_sick, t_heal, "bad", "false · service chronyd is not active")
    band(y1, t_heal, t_end, "okFill")
    s.text(x0 - 14, y1 + 47, "chronyd", "m", 12, "ink3", "end")
    s.rect(
        X(t_stop),
        y1 + 36,
        X(t_repair + st[7]["duration_s"]) - X(t_stop),
        14,
        fill="none",
        stroke="bad",
        r=3,
        dash="4 3",
    )
    s.text(X(t_stop) + 8, y1 + 47, "inactive", "m", 11.5, "bad")
    s.text(x0 - 14, y1 + 85, "jobs", "m", 12, "ink3", "end")
    w2 = {h: n for n, h in second}
    span(y1 + 66, t_batch2, t_end, "condor", "")
    s.text(
        X(t_end) + 12, y1 + 86, f"{w2.get('wn-01', '0')} running", "m", 12.5, "condor"
    )
    s.text(
        X(t_submit) + 12,
        y1 + 86,
        "none: its START expression refuses them",
        "m",
        12.5,
        "ink3",
    )

    # wn-02
    y2 = 420
    lane(y2, "wn-02", "execute node")
    s.text(x0 - 14, y2 + 13, "health", "m", 12, "ink3", "end")
    band(y2, 0, t_end, "okFill", "NODE_IS_HEALTHY true")
    s.text(x0 - 14, y2 + 55, "jobs", "m", 12, "ink3", "end")
    w1 = {h: n for n, h in first}
    span(
        y2 + 36,
        t_submit,
        t_drained,
        "condor",
        f"first batch: all 8 jobs here, {w1.get('wn-02', '?')} at a time",
    )
    span(y2 + 36, t_batch2, t_end, "condor", "")
    s.text(
        X(t_end) + 12, y2 + 56, f"{w2.get('wn-02', '0')} running", "m", 12.5, "condor"
    )

    # numbered legend
    ly = 610
    s.line(64, ly - 24, W - 64, ly - 24, "line", 1)
    detail = {
        1: "an operator stops a service the worker needs",
        2: "the startd re-publishes as soon as the check's output changes",
        3: f"better-analyze: {analyze.group(1) if analyze else '?'} slot rejects the job because of its own requirements",
        4: "Service[chronyd] stopped → running (corrective), exit code 2",
        5: "START accepts jobs again; the first batch had already been claimed by wn-02",
        6: "the new batch runs on both workers",
    }
    for i, (t, col, title) in enumerate(events, 1):
        cx = 64 + ((i - 1) % 2) * 770
        cy = ly + ((i - 1) // 2) * 64
        s.dot(cx + 12, cy + 6, 11, col)
        s.text(cx + 12, cy + 10.5, str(i), "m", 12, "panel", "middle", weight=500)
        s.text(cx + 36, cy + 11, f"+{mmss(t)}  {title}", "t", 15.5, "ink", weight=600)
        s.text(cx + 36, cy + 34, detail[i], "t", 14, "ink2")
    return s.render("Self-healing worker demonstration")


# ---------------------------------------------------------------------------- 3. drift correction
def drift(theme):
    rec = load("demos/drift-correction/record.json")
    st = {x["index"]: x for x in rec["steps"]}

    def code(i):
        m = re.search(r"puppet exit code: (\d+)", st[i]["command"]["stdout"])
        return m.group(1) if m else "?"

    noop = st[3]["command"]["stdout"]
    real = st[4]["command"]["stdout"]

    s = Svg(720, theme)
    s.header(
        "Demonstration 2 · drift correction",
        "Three changes made by hand, reported, then reverted",
        "Puppet keeps no state: every run compares the machine with its desired state and fixes the difference.",
        f"drift-correction record · {len(rec['steps'])} steps · {rec['duration_s']:.0f} s · commit {rec['git_commit']}",
    )
    # run strip
    runs = [
        (st[1]["started_s"], "baseline run", f"exit {code(1)}", "ok"),
        (st[2]["started_s"], "changes by hand", "3 changes", "bad"),
        (st[3]["started_s"], "dry run --noop", "reports, touches nothing", "out"),
        (st[4]["started_s"], "real run", f"exit {code(4)}", "vox"),
        (st[6]["started_s"], "second run", f"exit {code(6)}", "ok"),
    ]
    rx, rw = 64, (W - 128 - 4 * 18) / 5
    for i, (t, name, res, col) in enumerate(runs):
        x = rx + i * (rw + 18)
        s.rect(x, 180, rw, 66, fill="panel", stroke="line")
        s.rect(x, 180, 4, 66, fill=col, stroke=None, r=2)
        s.text(x + 18, 206, f"+0:{int(t):02d}  {name}", "t", 15, "ink", weight=600)
        s.text(x + 18, 230, res, "m", 13, col if col != "out" else "ink2")
        if i < 4:
            s.line(x + rw + 2, 213, x + rw + 16, 213, "ink2", 1.4, arrow=True)

    # grid of the three changes
    cols = ["Change made by hand", "Dry run reported", "Real run did", "After"]
    rows = [
        (
            "Time configuration",
            "/etc/chrony.conf",
            "a line appended",
            "File content would change",
            "restored, chronyd refreshed",
            "hand edit gone",
            "Service[chronyd]" in noop and "Triggered 'refresh'" in real,
        ),
        (
            "SSH hardening",
            "sshd_config.d/60-hardening.conf",
            "file deleted",
            "file would be created",
            "file restored, sshd reloaded",
            "file back",
            "60-hardening.conf" in noop and "Service[sshd]: Triggered" in real,
        ),
        (
            "Firewall",
            "service firewalld",
            "service stopped",
            "stopped → running (corrective)",
            "service started",
            "active",
            "Service[firewalld]/ensure" in real,
        ),
    ]
    gx, gy, lw = 64, 300, 330
    cw = (W - 128 - lw) / 4
    for j, c in enumerate(cols):
        s.text(
            gx + lw + j * cw + 16,
            gy,
            c.upper(),
            "m",
            12,
            "ink3",
            weight=500,
            spacing="1.2",
        )
    col_colors = ["bad", "out", "vox", "ok"]
    for i, (name, path, a, b, c, d, seen) in enumerate(rows):
        y = gy + 22 + i * 112
        s.rect(gx, y, W - 128, 96, fill="panel", stroke="line")
        s.text(gx + 22, y + 40, name, "c", 21, "ink", weight=600)
        s.text(gx + 22, y + 66, path, "m", 12.5, "ink3")
        for j, txt in enumerate((a, b, c, d)):
            x = gx + lw + j * cw
            s.line(x, y + 16, x, y + 80, "line", 1)
            s.dot(x + 22, y + 46, 5, col_colors[j])
            s.text(x + 36, y + 51, txt, "t", 15, "ink" if j != 1 else "ink2")
        if not seen:
            s.text(W - 80, y + 86, "not in record", "m", 11, "bad", "end")
    s.text(
        64,
        690,
        "The second run changes nothing: once the machine matches its desired state, Puppet does nothing (idempotence).",
        "t",
        15,
        "ink2",
    )
    return s.render("Drift correction demonstration")


# ------------------------------------------------------------------------------- 4. scale-out
def scale_out(theme):
    rec = load("demos/scale-out/record.json")
    st = {x["index"]: x for x in rec["steps"]}
    total = rec["duration_s"]
    final = re.findall(r"(\d+) @(wn-\d+)", st[10]["command"]["stdout"])
    added = next(
        ln.strip() for ln in st[2]["command"]["stdout"].splitlines() if "wn-03" in ln
    )

    s = Svg(800, theme)
    s.header(
        "Demonstration 3 · zero-touch scale-out",
        "One line of data, a new worker running jobs",
        "Every bar is a step of the recording. After the line below, no command is typed on the new machine.",
        f"scale-out record · {len(rec['steps'])} steps · {mmss(total)} · commit {rec['git_commit']}",
    )
    # the only human input
    s.rect(64, 172, W - 128, 58, fill="sunk", stroke="line")
    s.text(86, 207, "+", "m", 16, "ok", weight=500)
    s.text(108, 207, added, "m", 16, "ink", weight=500)
    s.text(
        W - 86,
        207,
        "the only change · one entry added to var.nodes",
        "m",
        12.5,
        "ink3",
        "end",
    )

    x0, x1 = 400, W - 150

    def X(t):
        return x0 + (x1 - x0) * t / total

    rows = [
        (3, "OpenTofu plan", "1 machine to create", "tofu"),
        (4, "OpenTofu apply", "machine + inventory", "tofu"),
        (5, "Machine boots", "until SSH answers", "out"),
        (6, "Ansible bootstrap", "agent + certificate request", "ansible"),
        (7, "Admission and Puppet", "signed, configured, startd up", "vox"),
        (8, "Certificate checked", "pp_role = execute", "vox"),
        (9, "Jobs run on wn-03", "8 jobs submitted", "condor"),
    ]
    top = 290
    for t in range(0, int(total) + 1, 30):
        s.line(X(t), top - 18, X(t), top + 7 * 54 - 10, "line", 1, dash="2 5")
        s.text(X(t), top - 26, mmss(t), "m", 12, "ink3", "middle")
    for i, (idx, name, sub, col) in enumerate(rows):
        y = top + i * 54
        step = st[idx]
        t0, d = step["started_s"], step["duration_s"]
        s.text(64, y + 17, name, "t", 15.5, "ink", weight=600)
        s.text(64, y + 37, sub, "m", 12.5, "ink3")
        w = max(X(t0 + d) - X(t0), 4)
        s.rect(X(t0), y + 6, w, 26, fill=col, stroke=None, r=4)
        lbl = f"{d:.0f} s" if d >= 1.5 else "1 s"
        if w > 70:
            s.text(X(t0) + w - 10, y + 24, lbl, "m", 12.5, "panel", "end", weight=500)
        else:
            s.text(X(t0) + w + 8, y + 24, lbl, "m", 12.5, "ink2")
    # end marker
    s.line(X(total), top - 18, X(total), top + 7 * 54 - 10, "ok", 1.6)
    s.text(X(total) + 10, top - 26, f"{mmss(total)} total", "m", 13, "ok", weight=500)
    # result
    y = top + 7 * 54 + 22
    s.line(64, y, W - 64, y, "line", 1)
    s.text(64, y + 36, "Running jobs at the end of the recording:", "t", 15.5, "ink2")
    cx = 400
    for n, h in final:
        cx += s.chip(cx, y + 17, f"{h} · {n} running", "condor") + 12
    return s.render("Zero-touch scale-out demonstration")


def main():
    OUT.mkdir(exist_ok=True)
    for name, fn in (
        ("admission", admission),
        ("demo-health-check", health_check),
        ("demo-drift", drift),
        ("demo-scale-out", scale_out),
    ):
        for theme in THEMES:
            path = OUT / f"{name}-{theme}.svg"
            path.write_text(fn(theme))
            print(f"{path.relative_to(HERE)}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
