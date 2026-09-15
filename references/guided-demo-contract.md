# The guided demo contract

The click-through engine lives at `src/demo/guide.js` in the scaffolded app. It
is vanilla JavaScript on purpose: it resolves targets at step-entry time and
re-resolves after DOM mutations, so it survives React re-rendering the element it
was pointing at.

## A step

```js
{
  target: () => document.querySelector('[data-testid="nav-tasks"]'),
  event: 'click',
  placement: 'right',
  gap: 12,
  script: 'Every overdue item, in one place. No status meeting required.',
  kicker: 'Try it',
  isComplete: () => location.hash.includes('/tasks'),
  onEnter: () => {}
}
```

| Field | Required | What it does |
|---|---|---|
| `target` | yes | Function returning the element. A function, not an element - the element may not exist yet. |
| `event` | no | What advances the step. Default `click`. |
| `placement` | no | Where the callout sits: `top`, `right`, `bottom`, `left`, `auto`. |
| `gap` | no | Pixels between target and callout. Default 12. |
| `script` | yes | What the viewer reads. One or two sentences. |
| `kicker` | no | The nudge. "Try it", "Click through". |
| `isComplete` | no | Advance when this returns true, instead of on the event. |
| `onEnter` | no | Side effect on entry - seed state, open a panel. |

## The two rules

**A step advances when the viewer does the thing. Never on a timer.**

Timed advancement holds together right up until somebody stops to read, or
someone asks a question, or the laptop hesitates. Then the narration is
describing a screen that is no longer on screen, and the viewer's job becomes
working out where they are instead of following the argument. There is no timer
in the engine and this is not an oversight.

**A missing target parks. It does not skip.**

Skipping looks like robustness and is not. The walkthrough keeps moving while
silently telling a different story: step four explains a filter the viewer never
saw. Parking - holding position, surfacing that the target is missing - makes the
breakage visible, and visible breakage gets fixed before it is presented.

## Writing the script

The `script` field is the demo. Some things that hold up in front of people:

**Say what it means, not what it is.** "Tasks" is a label the viewer can already
read. "Every overdue item, in one place" is a claim.

**One idea per step.** If a step needs a semicolon, it is two steps.

**Write for reading, not for being read to.** Most viewers will click through
without you. Anything that only works with your voiceover on top does not work.

**Land the close.** The last step is the only one anyone quotes afterwards. It
should state the thing from intake question 2 in plain words.

## Where steps live

`src/demo/scripts/<audience>.js`, one file per audience, registered in
`src/demo/scripts/index.js`. `demo-forge audience` creates both and stubs the
first step as a TODO. The stub is deliberate - an empty script is an obvious gap,
where a lorem-ipsum script is a gap that ships.

## Sub-site containment

Each audience is a sub-site and stays inside itself. Home inside
`/#/Finance-guide` goes to `/#/Finance-guide/home`, never to the shared front
door.

This is enforced in `src/demo/scope.js` and tested by the render gate, because
the failure mode is bad: a customer follows a link to the finance walkthrough,
presses Home out of habit, and lands on a generic front door or another
audience's story. They do not report it. They just leave.

The visitor's casing and any alias they were sent are preserved. Someone given
`/#/finance-demo` stays on `/#/finance-demo` rather than being redirected to the
canonical path, because the link they were sent is the link that has to keep
working. Aliases are kept alive permanently - a shared link outlives the sprint
that renamed the route.

## Adding an audience

```bash
node ~/.copilot/skills/demo-forge/tools/demo-forge.mjs \
  audience /Finance-guide --label "Finance" --guided --alias /finance-demo
```

This **adds** a URL. It does not change the front door. A new audience is an
addition to the registry, never a replacement of what visitors currently see -
that is a separate and deliberate decision, not a side effect of shipping a
walkthrough.

New audiences register as `coming-soon`. Flip to `ready` in
`src/demo/registry.js` once the storyline is written and you have clicked it
through yourself, start to finish, at least once.
