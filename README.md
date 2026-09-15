# Demo Forge

Turn a live application URL into a deployed React click-through demo.

It measures the real app in a browser, adopts the app's own design tokens, rebuilds the
screens, attaches a guided storyline, gates the result headlessly, and publishes to Azure
Static Web Apps.

Project Mia was the proof: a Power Apps canvas app rebuilt by hand as a static React site.
That took weeks. This is that process turned into tooling, so the second application takes
a day, and most of that day is judgement rather than reconstruction.

## Install

Clone into your Copilot CLI skills directory:

```bash
git clone <this-repo> ~/.copilot/skills/demo-forge
cp ~/.copilot/skills/demo-forge/agents/demo-forge.md ~/.copilot/agents/
node ~/.copilot/skills/demo-forge/tools/demo-forge.mjs doctor
```

`doctor` checks Node 22+, npm, Playwright with chromium, the Azure CLI and `gh`.

## Quick start

```bash
# measure, theme, rebuild, gate
demo-forge build https://app.example.com --out ./acme-demo --routes 12

# behind a sign-in
demo-forge build https://app.example.com --out ./acme-demo --login

# add the audience that gets the link
demo-forge audience /Acme-exec --label "Acme exec brief" --guided --project ./acme-demo

# prove it before anyone sees it
demo-forge verify --project ./acme-demo --render

# plan the deploy, read it, then drop --dry-run
demo-forge deploy --project ./acme-demo --name acme-demo \
  --resource-group rg-demos --location westeurope --sku Free --dry-run
```

## The pipeline

Seven stages. Each consumes a named artifact and produces a named artifact, so any stage
can be re-run alone. Get the theme wrong and you re-run `design`; you do not re-crawl.

| Stage | Command | Writes | Human |
| --- | --- | --- | --- |
| 1 Intake | none | a brief you confirm | required |
| 2 Capture | `capture` | `capture/manifest.json`, screenshots | auto |
| 3 Design | `design` | `src/theme/tokens.css` plus a contrast report | auto |
| 4 Scaffold | `scaffold` | the whole React app | auto |
| 5 Storyline | `audience` | `src/demo/scripts/*.js` | required |
| 6 Verify | `verify` | pass or fail per screen | auto |
| 7 Deploy | `deploy` | a live Azure URL | approval |

`build` runs stages 2, 3, 4 and 6 back to back. Intake needs an answer, storyline needs an
argument, deploy needs an approval, so those three stay human-gated on purpose.

## What it will not do

- **No backend.** Every value comes from `src/data/seed.js`. The demo works on a plane.
- **No auth.** The output has no login. A session, if needed, is used once at capture time
  and never ships.
- **No live integrations.** Connectors and services are represented visually and do nothing.
- **It will not decide what to say.** Demo Forge reconstructs what the app looks like and
  how it moves. The argument is yours.

A demo that quietly pretends to compute something is worse than one that visibly cannot.

## Why the odd design choices

Demo Forge was written first and tested against a real application second. That test found
eight defects, every one of which produced output that looked correct:

- Canvas and surface came back swapped, because backgrounds were ranked by element count.
  Forty cards outnumber one canvas. Area is now the measure.
- A status green was adopted as the brand accent, because colours were ranked by saturation.
  Accent is now decided by where a colour is painted, weighted toward filled buttons.
- Base text size came back 10px instead of 13px. Section labels are numerous and short;
  body copy is rarer and long. Weighting by characters asks the right question.
- The app named 163 CSS custom properties and none were read. A named source token now
  beats an inferred role, always, and every emitted token carries a provenance comment.
- A sidebar toggle became a page called `/collapse-navigation-menu`. Clicks are now
  pre-filtered on ARIA disclosure attributes and post-tested with a content signature that
  ignores chrome. Fixing that false positive freed two slots and found two real pages.
- The render gate counted every route twice, so a pass looked twice as thorough as it was,
  and the duplicate-route check could never fire.
- `--app` was not a recognised flag, so it fell through to a default directory and the
  build landed elsewhere with a success message. Flags are now allowlisted per command.
- An outline depth cap of 7 meant the navigation rail consumed the budget and `<main>` came
  back empty. It is now a 1,200-node budget at depth 16.

The full before and after for each is in [`docs/architecture.html`](docs/architecture.html).

**The failure mode to watch for:** wrong colours look like a design choice, a phantom route
looks like a page you forgot, and a double-counted gate looks like thoroughness. The only
defence that worked was diffing the tool's output against the source app's own values. Do
that on the first run against any new application, before writing a line of storyline.

## Known gaps

- The `--login` and `--profile` authenticated-capture paths have never been exercised
  against a real tenant. Budget time for the first one.
- Route discovery is proven on single-page applications only. A server-rendered site is a
  different traversal problem and is unvalidated.
- Anything drawn to canvas or WebGL is invisible to the DOM probe and needs a hand-built
  placeholder.
- The gate proves a page has content. It cannot prove the content is the right content.
  Look at the screens.

## Layout

```
SKILL.md              the contract the agent follows
agents/               the orchestrating agent, copy to ~/.copilot/agents/
references/           six reference documents, loaded on demand
tools/demo-forge.mjs  CLI, eight commands
tools/lib/            capture, design, scaffold, deploy
assets/template/      copied into every generated demo
docs/architecture.html  how all of it works, with the before and after diffs
```

## Requirements

Node 22+, Playwright with chromium, and for deploy the Azure CLI plus `gh`. The generated
demo pins React 18.3.1, Vite 5.4.11 and `vite-plugin-singlefile`, so the output is a single
inlined `index.html` of roughly 170 kB that can be emailed or opened from a USB stick.

## Azure constraints worth knowing before you plan

- The environment name is a **suffix**. Azure owns the hostname and only appends.
- Alphanumeric, 16 characters maximum. No hyphens inside the environment name.
- Custom domains are production-only.
- Quota is 3 named environments on Free, 10 on Standard.
- An empty `deployment_environment` means **production**, not "skip". `preflight` refuses
  to proceed when it finds one.
