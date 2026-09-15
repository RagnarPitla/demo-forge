# Intake

The conversation before the code. Fifteen minutes here saves a rebuild.

## The five questions

Asked in order, because each one constrains the next.

### 1. Who is watching, and what do they already believe?

Name a person or a role plus their current position. "A CFO" is not enough. "A
CFO who has already been told this will take eighteen months and does not believe
the number" is a brief.

The current belief matters more than the audience label, because a demo is an
argument and an argument needs something to move.

Follow-ups worth asking:
- Have they seen the real product? A demo that re-explains what they already know reads as filler.
- Who else will be in the room? A champion forwarding the link to a sceptic changes the tone.
- What did the last conversation end on? Demos usually exist because something stalled.

### 2. What is the one thing they should believe afterwards?

One sentence. Write it down verbatim. It becomes the acceptance criterion: a
screen either supports it or it goes.

If two sentences come back, that is two demos. Build the more urgent one.

Common trap: the answer comes back as a feature list. "They should see the
planning module, the approvals flow and the dashboards" is not a belief. Push
once: "and what will that make them think?" The answer to that is the sentence.

### 3. What kind of demo is this?

| Kind | Length | Shape | Use when |
|---|---|---|---|
| Product tour | 3-5 min | Breadth. Every major area, shallow. | Never seen it, needs the map. |
| Vision pitch | 2-3 min | A future state not fully built. | Selling direction, not the build. |
| Audience walkthrough | 4-8 min | One role's day, end to end. | They need to see themselves in it. |
| Feature deep-dive | 2-4 min | One capability, every corner. | The objection is one specific thing. |

The kind sets the route budget. A tour needs every area and shallow pages. A
deep-dive needs three routes and dense ones. Capturing eight routes for a
deep-dive wastes the time on screens that get cut.

Say out loud when it is a vision pitch. A demo of something that does not exist
yet is legitimate and common, and it has to be labelled as such in the artefact
so nobody later mistakes it for a commitment. Put it on the screen, not just in
the email.

### 4. Who drives - you, or them?

**Presenter-driven**: you talk over a click path. Guided steps optional. Copy can
be terse because your voice carries the argument.

**Self-serve**: a link goes out and you are not there. Guided steps are
mandatory. Every screen must make sense cold, and the last step must land the
close without you.

Assume self-serve unless told otherwise. Presenter demos get forwarded; a
forwarded presenter demo is a self-serve demo that nobody wrote the words for.

### 5. What must not be in it?

- Real customer names, logos, contract values
- Real people's names in assignee and approver fields
- Financials that are internal, forecast or unapproved
- Anything implying a delivery commitment not actually made
- Anything under NDA from a third party

Establish this before capture, not after. Seed data threads through every screen,
and scrubbing it later means regenerating pages and re-shooting every screenshot.

Ask specifically about the data visible in the source app. A capture of a live
system records whatever was on screen, including the customer names in row three.

## Writing it down

Record the answers in the demo repo, next to the code:

```
Audience      Regional CFO, told 18 months, does not believe it
Belief        The planning workflow is already built and running
Kind          Feature deep-dive, 3 min
Driver        Self-serve link, forwarded internally
Excluded      No real customer names. No dates implying a GA commitment.
Routes        /plan, /tasks, /approvals
```

Six lines. Re-read them when the demo starts growing a fourth route, and when
someone asks for "just one more screen".

## When intake is skipped

Sometimes a URL arrives with "build me a demo of this" and no more. Then:

1. Run `build` to get something on screen. It is cheap and it makes the conversation concrete.
2. Show it and ask the five questions against it. People answer far better with a thing in front of them than in the abstract.
3. Expect to throw away most of the storyline. That is fine. The capture, tokens and shell are the expensive parts and they survive.
