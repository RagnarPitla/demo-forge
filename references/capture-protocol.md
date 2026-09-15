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

## Two modes, and why they are not the same code path

**Crawl** answers "what is in this app". **Directed** answers "show me this".
They need opposite behaviour at the one point that matters, so they are separate
loops rather than one loop with a flag.

The crawler **resets to the entry URL before every hop**. It is guessing, and a
guess has to be reproducible; an SPA's state machine is not guaranteed
reversible, so replaying from a known start is the only way to get a
deterministic capture.

Directed capture **never resets**. Your steps are a sequence and a sequence
accumulates state. "Open the project, then open its documents" is two clicks
that depend on each other. Reset between them and the second click lands on an
empty documents list, and the capture records the wrong screen while reporting
success.

The cost of not resetting is that a failed step invalidates every step after it.
That is why a step that cannot be performed throws instead of continuing.

## Directed capture

```bash
node $DF capture "<url>" --do "click Overview; click Tasks; click Documents"
node $DF capture "<url>" --steps ./storyline.txt
```

| Instruction | Does |
| --- | --- |
| `click <target>` | Clicks the matching element. Records a screen. |
| `type <text> into <target>` | Fills an input. Records a screen. |
| `fill <target> with <text>` | The same thing, said the other way round. |
| `wait <ms>` / `wait <n> s` | Pauses. Records nothing. |
| `capture [as <name>]` | Forces a named screen, even if the content repeats. |
| `goto <url> [as <name>]` | Navigates. Records a screen. |
| `back` | Browser back. Records a screen. |

Blank lines and `#` comments are ignored, so a step file can be commented like
the script it is going to become.

### Target resolution

Widest-first, inside the app frame, on visible elements only:

1. exact `[data-testid]`
2. a `<label for>` pointing at the input (typing targets only)
3. exact accessible name - `aria-label`, `placeholder`, `title`, `name`, then text
4. unique substring

Exact beats substring so `click Home` does not select "Home office spend". A
substring that matches more than one element is **rejected**, not resolved to
the first hit - picking one of three is how a directed capture silently records
the wrong screen. Quote the exact label to disambiguate.

The resolver is passed to Playwright as a function, never as a string through
`eval()`. A page with a strict Content-Security-Policy blocks `eval`, and that
is exactly the kind of well-built app this is most likely to be pointed at.

### A failed step stops the run

```
step 1: click Home
  no clickable element matching "Home".
  On screen now: "Refresh", "Overview", "Project plan", "Tasks", "Team",
  "Documents", "Configuration", "WatchDog", "Integrations", "Help", "About"
```

That listing is the discovery mechanism. Guess once, read the error, write the
real steps. It is faster than reading the app's source and it cannot go stale.

### Revisits are not duplicate routes

Clicking the nav item for the screen you are already on is a real thing a person
does, and it is not a second page. When a step produces a content signature that
has already been recorded, the capture points the timeline entry at the existing
slug and says so, rather than emitting two byte-identical routes into the
generated site:

```
> click Overview
   "Overview" is the screen already captured as "home" - revisit, not a new route
```

`capture as <name>` is exempt, because that is an explicit request for a named
screen. So is a typing step: the signature digests headings and labels, which
makes it deliberately blind to a filtered list - the very thing you type into a
search box to demonstrate.

### Guards found by using it

Three things the first proof runs exposed, all of which now fail loudly:

**`back` can walk off the application.** A hash-routed SPA usually has nothing
in history before the app itself, so `goBack()` lands on `about:blank`. That
recorded a 2-element screen and then handed the design stage a blank page to
read tokens from, producing zero custom properties and a fully inferred theme.
`back` now checks the URL afterwards and refuses if it left the app.

**A screen below 12 visible elements is not a screen.** Same floor the generated
app's render gate uses. Below it, the step before probably navigated away or the
app had not finished rendering - the error says both, and suggests a longer
`--wait`.

**The design read must return to the entry route.** Both loops leave the page
wherever they finished. The final `PROBE` used to read whatever that was. It now
navigates back to the entry URL first, which is what the surrounding comment
always claimed it did.

### The timeline

Directed mode writes `mode`, `steps` and `timeline` into `capture.json`. The
timeline is the order you asked for, revisits included:

```json
{ "label": "Overview", "slug": "home", "via": "step:click", "revisit": true }
```

The scaffold generates the narration outline from the timeline when it exists,
so the beats match the clicks you specified. A revisit gets a different prompt -
"say what changed since last time" rather than "say why this matters" - because
the second visit to a screen is a different sentence.

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


## Signing in, and why those steps are `try`

`--edge-profile <email>` resolves the profile by reading each `Preferences` file's
`account_info[0].email`, copies its cookies, local storage, session storage and
IndexedDB into a scratch user data directory, and launches real Edge - `channel:
'msedge'` - against the copy.

Three things make this work, and each one breaks it if missed:

- **It must be the real browser.** On macOS the cookie store is encrypted against
  a login keychain entry named "Microsoft Edge Safe Storage". Playwright's bundled
  Chromium cannot read it, so every cookie decrypts to an empty string and the run
  looks exactly like being signed out.
- **It must be a copy.** A running browser holds an exclusive lock on its user data
  directory, so a persistent launch against the live one fails. The copy also means
  a capture can never corrupt a real profile.
- **`Local State` comes too.** It sits beside the profiles and holds the encrypted
  key the cookie store is sealed with. Copy the profile without it and you get the
  signed-out failure again, from a different cause.

Sign-in steps are written with `try` because Entra does not show a fixed sequence:
an account picker appears only when the browser cannot infer the account, a phone
approval only when policy demands one, "Stay signed in?" only sometimes. A required
step list cannot describe a set of maybes. Everywhere else the strictness stays -
a missing step means every screen after it is wrong.

A `try` step never becomes a screen. A screen that may or may not exist cannot be
part of a walkthrough that has to play the same way twice.

## Hotspots

A directed capture records where each clicked control was, as a viewport-relative
rect measured before any scrolling. The generated demo overlays that rect on the
screenshot as a button leading to the screen the click produced, which is what
turns a photograph back into a click-through.

The rect is only kept when the element was fully inside the viewport at click time.
A hotspot in the wrong place is worse than no hotspot: the viewer clicks and
nothing happens.

The click that produces a screen is not always the step that recorded it. "Save"
settles long before the app finishes, so the screen arrives on a later `capture`
step. The rect is therefore held pending and attached to whichever step next
produces a new route.

## The entry screen is recorded late

The entry is recorded just before the first non-optional step that clicks, types
or captures - not on arrival. If you had to sign in to reach the app, the sign-in
page is not the app's first screen, and an account picker with real email
addresses on it must never lead a demo that is meant to be shared.
