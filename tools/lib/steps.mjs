// A tiny instruction language for directed capture.
//
// The crawler in capture.mjs decides for itself what to visit. That is right
// when you do not yet know the app, and wrong the moment you do: you cannot
// tell it "show me the approval path, not the settings page". These steps are
// the other half of that - you say what to do, in order, and the capture
// follows you.
//
// The language is deliberately small. Every verb maps to one thing a person
// does with a mouse or a keyboard, because the steps double as the outline of
// the storyline the demo will eventually narrate.

const QUOTED = /^"([^"]*)"|^'([^']*)'/;

// A step that cannot be performed is an error, never a skip. Silently dropping
// "click Approve" produces a demo that is missing the entire point and reports
// success, which is the failure mode this whole tool is built to avoid.
export class StepError extends Error {
  constructor(step, detail) {
    super(`step ${step.line}: ${step.raw}\n  ${detail}`);
    this.name = 'StepError';
    this.step = step;
    this.detail = detail;
  }
}

const unquote = s => {
  const t = String(s || '').trim();
  const m = t.match(QUOTED);
  if (m) return (m[1] ?? m[2]).trim();
  return t.replace(/^["']|["']$/g, '').trim();
};

/**
 * Parse plain-language steps into an executable list.
 *
 *   click Home
 *   click "Project Documents"
 *   type acme into Search
 *   fill Search with acme
 *   wait 1500
 *   capture as Overview
 *   goto https://example.com/reports
 *   back
 *
 * Blank lines and lines starting with # are ignored, so a step file can be
 * commented like the script it is going to become.
 */
export function parseSteps(text) {
  const steps = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = i + 1;
    let s = raw.trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) return;

    const step = { line, raw: s };
    let m;

    // "try click Sign in" - a step that is allowed not to happen.
    //
    // Sign-in is the reason this exists. A tenant shows an account picker only
    // when the browser does not already know which account to use, and a "Stay
    // signed in?" page only sometimes, and a phone approval only when the
    // policy says so. Those screens are not a sequence, they are a set of
    // maybes, so a required step list can never describe them. Everywhere else
    // the strictness is the point and stays: a missing step means the screens
    // after it are wrong, and a wrong screen recorded as a success is the one
    // failure this tool must not have.
    if ((m = s.match(/^(?:try|optional)\s+(.+)$/i))) {
      const inner = parseSteps(m[1])[0];
      if (!inner) throw new StepError(`line ${line}: cannot parse "${s}"`, { line, raw: s });
      return steps.push({ ...inner, line, raw: s, optional: true });
    }

    // 'click Save as "Creating the agent"' - what the screen is called in the
    // demo, rather than what you had to click to reach it. Without this a step
    // that types three sentences into an editor names the route after all three
    // sentences, because the only label available is the instruction itself.
    // Only a quoted name counts, so a target that genuinely contains " as " is
    // still matched whole.
    let explicitName = null;
    if ((m = s.match(/^(.*?)\s+as\s+(?:"([^"]+)"|'([^']+)')\s*$/))) {
      explicitName = m[2] ?? m[3];
      s = m[1];
    }

    if ((m = s.match(/^click\s+(.+)$/i))) {
      step.verb = 'click';
      step.target = unquote(m[1]);
      step.name = step.target;
    } else if ((m = s.match(/^type\s+(.+?)\s+into\s+(.+)$/i))) {
      step.verb = 'fill';
      step.value = unquote(m[1]);
      step.target = unquote(m[2]);
      step.name = `${step.target} ${step.value}`;
    } else if ((m = s.match(/^fill\s+(.+?)\s+with\s+(.+)$/i))) {
      step.verb = 'fill';
      step.target = unquote(m[1]);
      step.value = unquote(m[2]);
      step.name = `${step.target} ${step.value}`;
    } else if ((m = s.match(/^wait\s+(\d+)\s*(ms|s|seconds?)?$/i))) {
      const n = Number(m[1]);
      step.verb = 'wait';
      step.ms = /^s|^seconds?$/i.test(m[2] || '') ? n * 1000 : n;
    } else if ((m = s.match(/^capture(?:\s+as\s+(.+))?$/i))) {
      step.verb = 'capture';
      step.name = m[1] ? unquote(m[1]) : null;
    } else if ((m = s.match(/^goto\s+(\S+)(?:\s+as\s+(.+))?$/i))) {
      step.verb = 'goto';
      step.target = unquote(m[1]);
      step.name = m[2] ? unquote(m[2]) : null;
    } else if (/^back$/i.test(s)) {
      step.verb = 'back';
      step.name = 'back';
    } else {
      throw new StepError(
        step,
        `unknown instruction. Supported: click <target> | type <text> into <target> | ` +
          `fill <target> with <text> | wait <ms> | capture [as <name>] | goto <url> [as <name>] | back`
      );
    }

    if (explicitName) step.name = explicitName;
    steps.push(step);
  });

  return steps;
}

/* ---------------------------------------------------------------------------
 * Target resolution, evaluated inside the app frame.
 *
 * Runs widest-first: an exact data-testid, then an exact accessible name, then
 * an exact visible text, then a unique substring. Exact wins so that "Home"
 * does not select "Home office spend" when both are on the page, and the
 * substring pass is rejected when it is ambiguous rather than picking the
 * first hit - guessing which of three matches you meant is how a directed
 * capture silently records the wrong screen.
 *
 * This is passed to Playwright as a function rather than as a string run
 * through eval(), because a page with a strict Content-Security-Policy blocks
 * eval and would fail every step on exactly the kind of well-built app this
 * tool is most likely to be pointed at.
 * ------------------------------------------------------------------------- */
function actInPage([target, kind, value]) {
  const norm = t => String(t || '').replace(/\s+/g, ' ').trim();
  const CLICKABLE =
    'a[href],button,[role="button"],[role="tab"],[role="link"],[role="menuitem"],' +
    '[role="option"],[onclick],summary,label,li[tabindex],div[tabindex],span[tabindex]';
  const TYPEABLE =
    'input:not([type=hidden]),textarea,[contenteditable="true"],[role="textbox"],' +
    '[role="searchbox"],[role="combobox"]';

  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.01;
  };
  const nameOf = el =>
    norm(
      el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('name') ||
        el.textContent
    );

  const want = norm(target);
  const wantLc = want.toLowerCase();
  const pool = Array.from(document.querySelectorAll(kind === 'type' ? TYPEABLE : CLICKABLE)).filter(visible);

  let el = null;
  let how = null;
  let extra = 0;

  const byId = document.querySelector(`[data-testid="${want.replace(/"/g, '')}"]`);
  if (byId && visible(byId)) {
    el = byId;
    how = 'data-testid';
  }

  // A typeable target is usually labelled by a <label for> rather than by its
  // own attributes, so fold that in before falling back to text matching.
  if (!el && kind === 'type') {
    for (const lab of Array.from(document.querySelectorAll('label'))) {
      if (norm(lab.textContent).toLowerCase() !== wantLc) continue;
      const f = lab.getAttribute('for');
      const cand = f ? document.getElementById(f) : lab.querySelector(TYPEABLE);
      if (cand && visible(cand)) {
        el = cand;
        how = 'label';
        break;
      }
    }
  }

  if (!el) {
    const exact = pool.filter(e => nameOf(e).toLowerCase() === wantLc);
    if (exact.length) {
      el = exact[0];
      how = 'exact';
      extra = exact.length - 1;
    }
  }

  if (!el) {
    const partial = pool.filter(e => nameOf(e).toLowerCase().includes(wantLc));
    if (partial.length === 1) {
      el = partial[0];
      how = 'contains';
    } else if (partial.length > 1) {
      return { ok: false, ambiguous: partial.slice(0, 6).map(nameOf) };
    }
  }

  if (!el) {
    return {
      ok: false,
      available: Array.from(new Set(pool.map(nameOf).filter(Boolean))).slice(0, 25)
    };
  }

  // Where this element sits on the screen that was just photographed. It is
  // read before scrollIntoView, because scrolling moves the element relative to
  // a screenshot that has already been taken - and a hotspot in the wrong place
  // is worse than no hotspot, since the viewer clicks and nothing happens.
  const r = el.getBoundingClientRect();
  const rect =
    r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight
      ? {
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
          vw: window.innerWidth,
          vh: window.innerHeight
        }
      : null;

  el.scrollIntoView({ block: 'center', inline: 'center' });

  if (kind === 'type') {
    el.focus();

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // React tracks the previous value on the node and swallows an assignment
      // it thinks is a no-op, so go through the native setter and then announce
      // the change the way the browser would.
      const proto =
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, how, extra, rect };
    }

    // A rich-text editor is not a form field. Lexical, ProseMirror, Slate and
    // Draft all keep the text in their own model and rewrite the DOM from it,
    // so assigning textContent is reverted on the next render - and, worse,
    // reverted silently, leaving a screenshot of an empty box under a step that
    // reported success. The only input they all believe is a real keystroke,
    // which has to come from the driver rather than from page script. Select
    // what is there so the typing replaces it, then hand back to the caller.
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return { ok: true, how, extra, rect, keyboard: true };
  }

  el.click();
  return { ok: true, how, extra, rect };
}

/**
 * Perform one step against the resolved app frame.
 * Returns { recorded, label } - recorded says whether this step should produce
 * a screen in the capture manifest.
 */
export async function runStep(page, frame, step, { waitMs = 1200, settle }) {
  switch (step.verb) {
    case 'wait':
      await page.waitForTimeout(step.ms);
      return { recorded: false, label: null };

    case 'capture':
      await settle(page, Math.min(waitMs, 900));
      return { recorded: true, label: step.name || 'capture' };

    case 'back': {
      const before = page.url();
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await settle(page, waitMs);
      const after = page.url();
      // A hash-routed SPA often has nothing in history before the app itself,
      // so "back" walks off it into about:blank. That records a screen with no
      // content and, worse, poisons the design read that happens afterwards.
      if (after === before || !/^https?:/.test(after)) {
        throw new StepError(
          step,
          `going back left the application (now at "${after}").\n` +
            `  There was no in-app history to return to. Click the destination directly instead.`
        );
      }
      return { recorded: true, label: 'back' };
    }

    case 'goto':
      await page.goto(step.target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await settle(page, waitMs);
      return { recorded: true, label: step.name || step.target };

    case 'click':
    case 'fill': {
      const kind = step.verb === 'fill' ? 'type' : 'click';
      const result = await frame.evaluate(actInPage, [step.target, kind, step.value ?? '']);

      if (!result.ok) {
        if (result.ambiguous) {
          throw new StepError(
            step,
            `"${step.target}" matches ${result.ambiguous.length} elements: ` +
              `${result.ambiguous.map(a => `"${a}"`).join(', ')}.\n` +
              `  Quote the exact label to disambiguate.`
          );
        }
        throw new StepError(
          step,
          `no ${kind === 'type' ? 'input' : 'clickable element'} matching "${step.target}".\n` +
            `  On screen now: ${(result.available || []).map(a => `"${a}"`).join(', ') || '(nothing matched)'}`
        );
      }

      // The editor is focused with its contents selected; real keystrokes are
      // the only thing its model will accept. A small delay keeps editors that
      // debounce their reconciler from dropping characters.
      if (result.keyboard) {
        await page.keyboard.type(step.value ?? '', { delay: 12 });
      }

      await settle(page, waitMs);
      return {
        recorded: true,
        label: step.name || step.target,
        how: result.how,
        extra: result.extra,
        rect: result.rect
      };
    }

    default:
      throw new StepError(step, `unhandled verb "${step.verb}"`);
  }
}
