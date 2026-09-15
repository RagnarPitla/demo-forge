# Capture protocol

The capture stage answers one question: what does this application actually look
like and how does it move? Everything downstream is derived from its output, so a
bad capture is not recoverable later.

## What it records

Per route: a full-page screenshot, a viewport screenshot, the body HTML, a
semantic outline, the headings, table structures, images, and a tally of every
painted colour, font size, radius and spacing value with the element count behind
each. Once for the whole app: every CSS custom property resolved on `:root`,
downloaded assets, console and network errors, and the frame the app was found
in.

The colour tallies carry both a count and a painted area, because those answer
different questions. Count tells you what is common. Area tells you what is the
canvas. Confusing the two is how the background and the card surface end up the
wrong way round.

## The iframe problem

Power Apps, Dynamics, embedded Power BI and most "code app" hosts render the
application inside an iframe. Evaluate against the top frame and you measure the
player chrome: a handful of elements, no custom properties, no application.

`findAppFrame()` walks every frame on the page and scores it:

```
elements * 1
+ interactive * 40
+ customProperties * 25
+ themed * 3000
+ reactRoot * 1500
+ min(textLength, 5000)
```

The weights are deliberate. A themed root or a React root is near-decisive because
those are things a player chrome does not have. Interactive element count outruns
raw element count because a shell full of buttons is an application and a shell
full of divs might be a splash screen. Cross-origin frames throw on evaluate;
those are caught and skipped rather than crashing the run.

Run with `--headed` and the chosen frame is printed with its score and the runners
up. If the capture comes back nearly empty, read that line first.

## Route discovery, and the toggle trap

The crawler seeds its queue from the entry route's navigation candidates, then
returns to the entry URL before each hop. Replaying from a known start is the only
way to get a deterministic capture out of a stateful SPA, whose back button may
not be honest.

The hard part is not finding clickable things. It is telling a link from a
control. "Collapse navigation menu" sits in the nav, is a button, has a label, and
clicking it changes the URL not at all and the element count substantially. Judged
on URL or element count it looks exactly like a new route, and it will consume a
route slot to produce a screen that is the home page with the furniture moved.

Two defences, both evidence-based rather than a blocklist of words:

**Before clicking.** An element carrying `aria-expanded`, `aria-controls` or
`aria-haspopup="true"` is declaring that it operates on the current view. Those
are dropped from the queue.

**After clicking.** The probe digests the content region - headings, table
headers and labels, excluding nav, sidebar and header chrome - into a content
signature. If a click produces a signature already seen, it was a control, not a
navigation. It gets recorded under `controls` in the manifest and the route slot
is returned to the queue.

On the Project Mia capture this is the difference between six routes with a bogus
`/collapse-navigation-menu` in them, and seven genuine ones.

## Authentication

`--login` opens headed and waits on stdin until you press a key, so you can sign
in, dismiss the tenant picker and land on the app before capture starts.

`--profile <dir>` persists the browser profile. First run with `--login --profile
./auth`, subsequent runs with `--profile ./auth` alone and no interaction. Useful
when iterating on a capture of an app behind SSO.

Do not commit a profile directory. It contains live session cookies.

## Render scale

Some hosts apply a transform or zoom to the app root. Font sizes then come back
fractional - 8.5px, 10.5px - and every derived scale is wrong by that factor.

The probe detects the effective scale from the root transform and normalises font
sizes, radii and spacing before reporting them, recording `renderScale` so the
adjustment is visible rather than silent. Fractional pixel values surviving into
the output are a signal the detection missed something; check `renderScale`
against what you see on screen.

## Tuning

| Flag | When |
|---|---|
| `--routes <n>` | Default 8. Raise for broad apps; each route costs a page load. |
| `--wait <ms>` | Default 2200. Raise for slow first paint or heavy data loads. |
| `--viewport <wxh>` | Default 1440x900. Match the screen the demo will be shown on. |
| `--headed` | Watch it work. The first thing to try when results look wrong. |

## Reading the output

`capture.json` is the manifest and the only file downstream stages read. Worth
checking by hand before moving on:

- `routes.length` - 1 means navigation was not found. Capture routes manually.
- `customProperties` - an empty object means the design stage will be inferring everything.
- `diagnostics.consoleErrors` - errors here often explain a blank route.
- `app.appFrameUrl` - confirms which frame was measured.
- `controls` - the things that turned out not to be routes. Useful demo affordances even so.
