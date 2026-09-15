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
    const s = raw.trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) return;

    const step = { line, raw: s };
    let m;

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

  el.scrollIntoView({ block: 'center', inline: 'center' });

  if (kind === 'type') {
    el.focus();
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    // React tracks the previous value on the node and swallows an assignment it
    // thinks is a no-op, so go through the native setter and then announce the
    // change the way the browser would.
    if (setter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      setter.call(el, value);
    } else {
      el.textContent = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.click();
  }

  return { ok: true, how, extra };
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

      await settle(page, waitMs);
      return { recorded: true, label: step.name || step.target, how: result.how, extra: result.extra };
    }

    default:
      throw new StepError(step, `unhandled verb "${step.verb}"`);
  }
}
