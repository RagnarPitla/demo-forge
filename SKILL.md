---
name: demo-forge
description: Turn a live application URL into a deployed, click-through demo. Use when someone wants a shareable walkthrough of an app they cannot hand out access to, when a Power App or internal tool has to be shown to a customer or an executive, when a demo environment is too slow, too real or too broken to present from, when the same product needs a different story for a different audience, or when someone says "build me a demo of this app" and hands over a URL.
verified_on: 2026-09-14
provenance: "Reverse-engineered from the Project Mia build: a Power Apps canvas app at apps.powerapps.com rebuilt as a React static site at mango-desert-0f88f590f.7.azurestaticapps.net, then re-derived and tested end to end against that deployed site."
---

A demo is not a copy of an application. It is an argument about the
application, staged so a specific person reaches a specific conclusion.

That distinction decides everything downstream. A copy tries to be complete and
fails, because the real app has a thousand affordances and your viewer has four
minutes. A demo is deliberately incomplete: it carries the screens that support
the claim and drops the rest. The work is not "recreate the app". The work is
"decide what this audience needs to believe, then build only the surface that
proves it".

So the pipeline below front-loads a conversation and back-loads the code. The
tools are real and tested, and they will get you a running, deployed React app
from a URL in about fifteen minutes. But a demo built before the intake
conversation is a demo you will rebuild.

## The pipeline

```
intake -> capture -> design -> scaffold -> storyline -> verify -> deploy
  ask     measure    extract   generate    write       prove     ship
```

Each stage has a tool. The tool lives at `tools/demo-forge.mjs` in this skill
directory and is run directly:

```bash
DF=~/.copilot/skills/demo-forge/tools/demo-forge.mjs
node $DF doctor            # check the toolchain before promising anything
```

`doctor` checks Node, Playwright with chromium, the Azure CLI and its login, and
`gh`. Run it first. Every failure it reports is a failure that would otherwise
surface twenty minutes later in the middle of a capture.

## Stage 1 - intake, before any code

Ask these five. Do not skip to the capture because the URL is sitting right
there; the answers change what you capture.

**1. Who is watching, and what do they already believe?**
An executive who thinks the project is late needs a different demo from a
procurement lead who thinks it is expensive. Name the person and their current
position, not a segment.

**2. What is the one thing they should believe afterwards?**
One sentence. If it needs two, you have two demos. This sentence becomes the
spine of the storyline and the thing every screen is measured against.

**3. What kind of demo is this?** The four that recur:

| Kind | Length | Shape | Use when |
|---|---|---|---|
| Product tour | 3-5 min | Breadth. Every major area, shallow. | They have never seen it and need the map. |
| Vision pitch | 2-3 min | A future state the product does not fully have yet. | Selling the direction, not the build. |
| Audience walkthrough | 4-8 min | One role's day, end to end, in depth. | They need to see themselves in it. |
| Feature deep-dive | 2-4 min | One capability, every corner of it. | The objection is about one specific thing. |

**4. Who drives - you, or them?**
A presenter-driven demo can rely on you talking over a click path. A
self-serve link has to narrate itself, which means guided steps are mandatory
rather than optional, and the copy has to survive being read without you.

**5. What must not be in it?**
Real customer names, real financials, anything under NDA, anything that implies
a commitment the business has not made. Establish this now. Scrubbing later
means rebuilding the seed data and rewriting every screenshot caption.

Record the answers. They are the acceptance criteria for the finished demo, and
the thing to re-read when the demo starts growing extra screens.

## Stage 2 - capture

```bash
node $DF capture "<url>" --out ./demo-build/capture --routes 8
```

This drives a real browser, visits the app, walks its navigation, and records
what is actually painted: computed styles, resolved CSS custom properties, a
semantic outline per route, full-page screenshots, downloaded assets.

Two things about it are worth understanding, because both bite.

**Power Apps renders inside the player iframe.** Read `document` on the top
frame and you get the player chrome and nothing else. The capture scores every
frame on the page and picks the one that actually holds the application, which
is why it works on `apps.powerapps.com` URLs where naive scraping returns an
empty shell. See `references/capture-protocol.md`.

**Authenticated apps need a login pass.** Add `--login` and the browser opens
headed and waits for you to sign in before it starts, or use `--profile <dir>`
to reuse a stored session across runs.

Read the summary it prints. `routes` is how many distinct views it found;
`controls` is the things it clicked that turned out to mutate the view rather
than navigate. If routes is 1, the crawler could not find navigation and you
should capture the routes manually rather than trusting what comes next.

## Stage 3 - design

```bash
node $DF design --capture ./demo-build/capture
```

Produces `tokens.css`, `design.json` and a `design-report.md` you should read.

The governing rule, and the one that took four bugs to learn: **where the source
app names a token, that name wins over anything we measured.** A custom property
on `:root` is what the authors decided. An inferred role is what we counted. On
the Project Mia capture, pure inference put the canvas and the surface the wrong
way round, elected the success green as the accent because it was the most
saturated hue on the page, and read a 10px type base off a transform-scaled DOM.
Every one of those was contradicted by a `--color-*` property the app was already
publishing. Inference exists for apps with no token layer; it is not there to
second-guess one that has it.

The report states the provenance of every token, so you can see at a glance which
values are the app's own and which are our best reading. Check the contrast table
before shipping - a demo that fails contrast in front of an accessibility-minded
customer costs more than it saves.

## Stage 4 - scaffold

```bash
node $DF scaffold --capture ./demo-build/capture --out ./demo-build/app --name "Contoso demo"
```

Generates a working React app: routes, an app shell with scoped navigation, a
primitive kit built on the extracted tokens, and seeded page components carrying
the real headings and table structures from the capture.

This is a starting point, not an output. The generated pages are honest
scaffolding - correct structure, correct tokens, plausible copy - and they are
meant to be edited. The value the tool adds is that you are editing a running,
on-brand, route-complete application instead of starting at an empty file.

`references/reconstruction.md` covers what to change first and in what order.

## Stage 5 - storyline

This is the actual demo, and it is the part no tool can do for you.

```bash
node $DF audience /Finance-guide --label "Finance" --guided
```

That registers a new audience sub-site and stubs its step script. Every step
lands as a TODO on purpose.

A guided step is a contract:

```js
{
  target: () => document.querySelector('[data-testid="nav-tasks"]'),
  event: 'click',
  script: 'Every overdue item, in one place. No status meeting required.',
  kicker: 'Try it'
}
```

Two rules that are not style preferences:

**A step advances when the viewer does the thing, never on a timer.** Timed
advancement desynchronises the moment someone pauses to think, and then the
narration is describing a screen they are no longer looking at.

**A step whose target is missing parks; it does not skip.** Skipping keeps the
walkthrough moving while quietly telling the wrong story. Parking is visible,
and visible breakage gets fixed.

Full contract in `references/guided-demo-contract.md`.

## Stage 6 - verify

```bash
cd ./demo-build/app && npm run gate
```

Builds, then loads every route and every audience in a real browser and asserts
that each one painted: element count above floor, accent colour present, text
present, and - the one that matters - that Home inside an audience sub-site
lands inside that sub-site rather than on the shared front door.

That last check exists because the failure it catches is silent and
embarrassing. A customer following a link to the finance walkthrough presses
Home, and lands on a generic front door or, worse, another audience's story.
Screenshots of every screen land in `.render-evidence/`.

## Stage 7 - deploy

```bash
node $DF deploy --name contoso-demo --resource-group rg-demos --dry-run
node $DF deploy --name contoso-demo --resource-group rg-demos --repo owner/repo
```

Creates the Azure Static Web App, reads the deployment token, sets it as a repo
secret, and commits a workflow that deploys on push.

Azure constraints that are not negotiable and will waste an afternoon if
learned the hard way:

- The environment name is a **suffix only**: `<host>-<env>.<region>.azurestaticapps.net`. A prefix host cannot be created.
- Environment names are alphanumeric, 16 characters maximum.
- Custom domains are production-only. A named environment cannot have one.
- Staging environments are capped: 3 on Free, 10 on Standard.
- An empty `deployment_environment` in the workflow means **production**. That is the single most expensive typo available here.

`references/azure-swa.md` has the rest.

## Doing it in one pass

```bash
node $DF build "<url>" --name "Contoso demo" --routes 8
```

Chains capture, design, scaffold, install and gate. Use it to get something on
screen fast. Then go back and do the intake conversation properly, because the
storyline is still empty and the storyline is the demo.

## What this skill will not do

It will not clone an application. The output is a faithful-looking, fully
navigable shell with real structure and real tokens, carrying the story you
wrote. Business logic, live data and integrations are deliberately absent: a
demo that needs a backend is a demo that breaks in front of a customer when the
conference wifi drops.

It will not decide what to say. It gets you to the point where the only thing
left is the argument, which is the only part worth your time.

## References

| File | Read it when |
|---|---|
| `references/intake.md` | Running the intake conversation, with the follow-up questions. |
| `references/capture-protocol.md` | The capture misses routes, hits auth, or the app is in an iframe. |
| `references/design-extraction.md` | Tokens look wrong, or the app has no token layer at all. |
| `references/reconstruction.md` | Turning generated scaffolding into something presentable. |
| `references/guided-demo-contract.md` | Writing the steps. Read before the first one. |
| `references/azure-swa.md` | Deploying, and the constraints that shape the URL scheme. |
