# 3D view of the lab

`index.html` is an interactive 3D model of the lab, generated from a `snapshot.json`
(by default `docs/lab/snapshots/03-final/snapshot.json`). Everything it shows is read from the snapshot;
the few facts the snapshot does not record (tool versions, the name of the workspace, the six steps of
"How it works") come from the project README and live in one place, `CONTEXT` in `src/app/10-model.js`.

The page is one self-contained file: three.js, the fonts and the snapshot are embedded, so it opens from
disk and is served as-is by GitHub Pages.

## What is in the picture

| In the model | In the snapshot |
|---|---|
| Three stacked slabs | region, VPC, subnet (`infrastructure.network`) |
| Glass fence with two gates | the security group and its rules (`security_group_rules`) |
| A machine, layer by layer from the bottom | instance, AlmaLinux, OpenVox agent, `profile::base`, `profile::htcondor`, then the daemons of its role |
| Amber module docked on `cm-01` | the OpenVox server: CA and admission policy, Hiera levels |
| Small lights on the layers | `services.*.active`, and `NODE_IS_HEALTHY` on the health check |
| Cubes beside a worker | jobs it completed (`history.completed_by_host`) |
| Dashed outline | a host that completed jobs but no longer exists (`wn-03`, the scale-out worker) |
| Arcs in the air | flows between members of the security group: 8140 and 9618 |
| Traces on the floor | flows that cross the security group: SSH in, everything out, through the gateway |

The scene at rest is the snapshot. The six steps replay "How it works": each machine is assembled in the
order the tools build it. Steps 5 and 6 are animated illustrations (jobs being matched, the self-healing
demonstration), and the page says so.

## Use

- **Look around:** drag to orbit, scroll to zoom, right-drag to pan; click anything for its details.
- **Another snapshot:** "Open snapshot" (or drop a `snapshot.json` on the model). Nothing is uploaded.
- **Images:** "Export PNG" renders the README hero (2400 x 1350), a LinkedIn image, a square, or the current view,
  in the theme that is on. The export draws the same labels as the screen.

## Rebuild

```bash
python3 build.py                                   # default snapshot -> index.html
python3 build.py ../snapshots/02-scaled-out/snapshot.json --out /tmp/02
```

Python 3 only. Sources are in `src/` (`style.css`, `body.html`, `app/*.js`, concatenated in file-name order).

## Render the images without a browser window

```bash
npm install --no-save playwright && npx playwright install chromium   # once
node render.mjs                # hero-light.png hero-dark.png linkedin-light.png linkedin-dark.png
```

The options are listed at the top of `render.mjs`. A software GL is used, so no GPU is needed.

## Third-party

- three.js r128, MIT License (`vendor/three.r128.min.js`).
- IBM Plex Sans, Sans Condensed and Mono, SIL Open Font License 1.1: Latin subsets embedded as WOFF
  (`vendor/fonts.json`, made by `build_fonts.py` from the font files of github.com/google/fonts).
