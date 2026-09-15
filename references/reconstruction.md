# Reconstruction

Turning generated scaffolding into something you would put in front of a
customer.

## What you start with

`scaffold` produces a running React app: a route per captured view, an app shell
with scoped navigation, a primitive kit on the extracted tokens, and page
components seeded with the real headings and table structures from the capture.

It is correct in structure and honest about being scaffolding. The point is that
you begin from a running, on-brand, route-complete application rather than an
empty file.

## Order of work

Do these in order. Each one makes the next cheaper.

### 1. Cut routes

Open the app and delete every route the storyline does not need. A feature
deep-dive that captured eight routes probably needs three.

Cutting first means you never polish a page that gets deleted. Remove from
`src/routes/index.jsx` - both the `routes` array and `navItems` - and delete the
file. The route gate will catch a nav item pointing at a route you removed.

### 2. Fix the shell

The header and nav rail are what viewers see on every screen, so errors here are
seen the most and cost the least to fix. Product name, nav labels, nav order,
the user chip in the corner.

Nav order should follow the storyline, not the source app's information
architecture. The viewer reads top to bottom and assumes that is the sequence.

### 3. Seed the data

`src/data/` holds the seed. This is where a demo becomes plausible or does not.

Plausible seed data:
- Names that are clearly fictional but not jokey. "Priya Raman", not "Test User 1" and not "Bob Loblaw".
- Dates clustered around the actual demo date. A dashboard showing last quarter reads as abandoned.
- Numbers that survive arithmetic. If three line items are shown, the total should be their sum. Someone will add them up.
- Enough variety to look real - some overdue, some done, some unassigned. Twelve rows of "In progress" looks like a fixture, because it is one.
- Status distributions that support the argument. A demo about catching overdue work needs overdue work in it.

### 4. Build the hero screens

One or two screens carry the argument. Give them the time. The rest only need to
be good enough that clicking into them does not break the spell.

Identify them from intake question 2: the screen where the belief lands.

### 5. Write the storyline

Only now. Steps written before the screens exist end up describing screens you
did not build. See `references/guided-demo-contract.md`.

## The primitive kit

`src/shell/primitives.jsx`: `Card`, `Button`, `Pill`, `StatTile`, `PageHeader`,
`Grid`, `DataTable`, `SectionLabel`, `Empty`. All read from the token variables.

Build pages out of these rather than bare markup. A page assembled from the kit
inherits the extracted design and stays consistent with every other page; one
built from scratch drifts, and the drift is visible precisely because everything
around it does not.

Need something the kit does not have? Add it to the kit rather than inlining it
in a page. The second page that needs it is coming.

## Fidelity, and where to stop

The goal is a demo that reads as the product, not a reimplementation. Some
deliberate stopping points:

**No backend.** Everything is seeded and local. A demo that needs a network is a
demo that fails on conference wifi, and it will be conference wifi.

**No authentication.** The viewer is already signed in. A login screen costs a
click and proves nothing.

**No real integrations.** An integration that works in the demo and not in the
product is a promise someone has to keep later.

**Broken affordances are fine if they are inert.** A filter dropdown that opens
and does nothing is acceptable. One that throws an error is not. Inert is
invisible; broken is the only thing they will remember.

## Screenshots from the capture

`capture/screens/` holds full-page screenshots of every route. Useful for:

- Checking your reconstruction against the original side by side
- Dropping into a slide when a screen is not worth rebuilding
- Showing the customer what the source actually looked like

Do not embed them as images in the demo app in place of real components. They do
not respond to hover, they do not scale, and they look exactly like what they
are the moment someone tries to click one.

## Verifying

```bash
npm run gate
```

Builds, then loads every route and audience in a real browser and asserts each
painted, with screenshots in `.render-evidence/`.

Run it before every share. A route that renders blank is the kind of thing that
is obvious in retrospect and invisible until someone else clicks it.
