# Design extraction

Turning a capture into a token set. The output is `tokens.css`, `design.json`
and `design-report.md`.

## The rule that matters

**A named custom property beats an inferred role, every time.**

A property on `:root` is a decision the authors wrote down. An inferred role is a
count of what happened to be painted. When they disagree, the measurement is
wrong, not the decision.

This is not a stylistic preference, it is the outcome of four bugs found by
diffing an inference-only extraction against the source app's own `:root` on the
Project Mia capture:

| Role | Source said | Inference said | Why inference was wrong |
|---|---|---|---|
| canvas | `#f9fafb` | `#ffffff` | Ranked backgrounds by element **count**. Cards outnumber the single canvas. |
| surface | `#ffffff` | `#f9fafb` | Same error, inverted. |
| accent | `#4f46e5` | `#22c55e` | Ranked by **saturation**. The success green beat the indigo. |
| text base | `13px` | `10px` | 10px mono section labels out-counted 13px body copy. |

Each is individually plausible and collectively produces a demo that is subtly,
pervasively the wrong product. The app had been publishing the right answer all
along.

`ROLE_ALIASES` maps the names apps actually use - `--color-bg`, `--bg`,
`--background`, `--surface-primary` and so on - onto the roles the template
needs. `adoptSourceTokens()` runs first and inference only fills what is left.

## When there is no token layer

Plenty of apps resolve zero useful custom properties. Then inference is all
there is, and these are the heuristics, each chosen against a specific failure:

**Canvas by painted area, not element count.** The canvas is one enormous
element; cards are many small ones. Counting elements elects the cards.

**Accent by where it is painted, not by saturation.** Colours appearing on
interactive elements are weighted - 2x on foregrounds, 3x on backgrounds. A status
green can be the most saturated hue on a page while being nobody's brand colour.
The accent is the colour the app asks you to click.

**Status colours by hue bucket.** Greens near 140 degrees, reds near 0, ambers
near 45. Only claimed when the hue sits in the bucket and the saturation is
meaningful; otherwise the role is left empty. An empty role is better than a
confident wrong one.

**Type scale anchored on body copy.** The base is the size carrying the most text,
not the most elements. Sizes are then bucketed into a scale. Where the source
publishes `--text-base`, that wins outright.

## Contrast

Every text-on-surface pair gets a WCAG contrast ratio in the report, with a
pass/fail at AA. Fixing a contrast failure is a five-minute edit now and an
awkward conversation later. The report will not block you, but it does tell you.

Worth noting: status colours frequently fail as text on white - `#22c55e` on
`#ffffff` is 2.28:1. That is fine when the colour is a dot or a fill, and a
problem when it is a label. The report cannot tell which you are doing.

## Output

`tokens.css` carries the full set with a provenance comment on each line:

```css
--color-bg: #f9fafb;        /* source --color-bg */
--text-xs: 11px;            /* 40 elements */
```

"source" means adopted verbatim. An element count means inferred. You can read
the file and know which values to trust and which to check.

`design.json` is the machine-readable equivalent, consumed by `scaffold`.

`design-report.md` is for a human. Read the roles table and the contrast table
before scaffolding, because fixing a token afterwards means regenerating or
hand-editing every page that used it.

## Editing afterwards

Edit `src/theme/tokens.css` in the scaffolded app directly. It is a plain CSS
file and nothing regenerates it. The primitive kit and every generated page read
from these variables, so a single change propagates.

Do not re-run `design` against a capture after editing the app's tokens; it
writes to the design directory, but a later `scaffold` into the same output
directory would overwrite your edits.
