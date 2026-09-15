/* Guided walkthrough overlay.
 *
 * Framework agnostic on purpose. It drives off DOM selectors and real user
 * events, so it survives a React re-render, a router swap and a version bump
 * without being rewritten. The app does not import anything from here except
 * `startGuide`; the overlay owns its own DOM, styles and teardown.
 *
 * A step is:
 *
 *   {
 *     target:     () => Element | null      required. Re-run on every tick, so
 *                                           a target that has not mounted yet
 *                                           simply parks the step.
 *     script:     string                    required. What the narrator says.
 *     event:      'click' | 'change' | 'input' | 'auto'
 *     placement:  'auto' | 'top' | 'bottom' | 'left' | 'right' | 'top-right' ...
 *     gap:        number                    px between target and bubble
 *     isComplete: (target) => boolean       gate before the step can advance
 *     onEnter:    (target) => void          side effect when the step opens
 *     kicker:     string                    small label above the script
 *   }
 *
 * The rule that matters: a step advances when the user does the thing, not on a
 * timer. A click-through demo that advances itself is a video.
 */

const NS = 'dfg';
const PLACEMENTS = ['bottom', 'top', 'right', 'left', 'bottom-right', 'top-right', 'bottom-left', 'top-left'];

const style = `
:root {
  --${NS}-accent: var(--color-accent, #4f46e5);
  --${NS}-accent-soft: color-mix(in srgb, var(--${NS}-accent) 14%, transparent);
  --${NS}-accent-glow: color-mix(in srgb, var(--${NS}-accent) 34%, transparent);
  --${NS}-surface: var(--color-surface, #fff);
  --${NS}-text: var(--color-text, #111827);
  --${NS}-muted: var(--color-text-tertiary, #6b7280);
  --${NS}-shadow: 0 12px 32px rgba(17, 24, 39, .18), 0 2px 8px rgba(17, 24, 39, .08);
}
.${NS}-target {
  position: relative !important;
  z-index: 2147483000 !important;
  outline: 2px solid var(--${NS}-accent) !important;
  outline-offset: 3px !important;
  border-radius: var(--radius-md, 8px);
  animation: ${NS}-pulse 1.8s cubic-bezier(.4, 0, .6, 1) infinite;
}
@keyframes ${NS}-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--${NS}-accent-glow); }
  50%      { box-shadow: 0 0 0 8px transparent; }
}
#${NS}-bubble {
  position: fixed;
  z-index: 2147483001;
  max-width: 330px;
  padding: 16px;
  border-radius: var(--radius-xl, 12px);
  background: var(--${NS}-surface);
  color: var(--${NS}-text);
  box-shadow: var(--${NS}-shadow);
  border: 1px solid var(--color-border, #e5e7eb);
  font-family: var(--font-sans, system-ui, sans-serif);
  transition: top .22s cubic-bezier(.2,0,0,1), left .22s cubic-bezier(.2,0,0,1);
}
#${NS}-bubble[hidden] { display: none; }
.${NS}-kicker {
  margin: 0 0 6px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--${NS}-muted);
}
.${NS}-script { margin: 0; font-size: 13px; line-height: 1.5; }
.${NS}-footer {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; margin-top: 12px;
}
.${NS}-progress {
  color: var(--${NS}-muted);
  font: 600 10px/1 var(--font-mono, ui-monospace, monospace);
}
.${NS}-actions { display: flex; gap: 12px; }
.${NS}-btn {
  padding: 3px 0; border: 0; background: transparent;
  color: var(--${NS}-accent);
  font: 700 11px/1 var(--font-sans, system-ui, sans-serif);
  cursor: pointer;
}
.${NS}-btn:hover { text-decoration: underline; }
.${NS}-btn[disabled] { color: var(--${NS}-muted); cursor: default; text-decoration: none; }
#${NS}-toggle {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483002;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; border-radius: 999px; border: 1px solid var(--color-border, #e5e7eb);
  background: var(--${NS}-surface); color: var(--${NS}-text);
  box-shadow: var(--${NS}-shadow); cursor: pointer;
  font: 600 12px/1 var(--font-sans, system-ui, sans-serif);
}
#${NS}-toggle:hover { border-color: var(--${NS}-accent); }
.${NS}-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--${NS}-accent);
}
.${NS}-dot[data-on="false"] { background: var(--${NS}-muted); }
@media (max-width: 640px) {
  #${NS}-toggle { right: 12px; bottom: 12px; }
  #${NS}-bubble { max-width: calc(100vw - 24px); padding: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .${NS}-target { animation: none !important; }
  #${NS}-bubble { transition: none; }
}
`;

function place(bubble, rect, preferred, gap) {
  const bw = bubble.offsetWidth || 330;
  const bh = bubble.offsetHeight || 120;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  const candidates = preferred === 'auto' ? PLACEMENTS : [preferred, ...PLACEMENTS];
  for (const p of candidates) {
    let top;
    let left;
    if (p.startsWith('bottom')) top = rect.bottom + gap;
    else if (p.startsWith('top')) top = rect.top - bh - gap;
    else top = rect.top + rect.height / 2 - bh / 2;

    if (p === 'right') left = rect.right + gap;
    else if (p === 'left') left = rect.left - bw - gap;
    else if (p.endsWith('-right')) left = rect.right - bw;
    else if (p.endsWith('-left')) left = rect.left;
    else left = rect.left + rect.width / 2 - bw / 2;

    const fits = top >= 8 && top + bh <= vh - 8 && left >= 8 && left + bw <= vw - 8;
    if (fits || p === candidates[candidates.length - 1]) {
      return { top: clamp(top, 8, vh - bh - 8), left: clamp(left, 8, vw - bw - 8) };
    }
  }
  return { top: 8, left: 8 };
}

export function startGuide(steps, options = {}) {
  if (!Array.isArray(steps) || !steps.length) return () => {};
  if (document.getElementById(`${NS}-bubble`)) return () => {};

  const {
    autoStart = true,
    label = 'Guided walkthrough',
    storageKey = null,
    onStep = null,
    onFinish = null
  } = options;

  const styleEl = document.createElement('style');
  styleEl.id = `${NS}-style`;
  styleEl.textContent = style;
  document.head.append(styleEl);

  const bubble = document.createElement('div');
  bubble.id = `${NS}-bubble`;
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-live', 'polite');
  bubble.setAttribute('aria-label', label);
  bubble.innerHTML = `
    <p class="${NS}-kicker"></p>
    <p class="${NS}-script"></p>
    <div class="${NS}-footer">
      <span class="${NS}-progress"></span>
      <span class="${NS}-actions">
        <button type="button" class="${NS}-btn" data-act="back">Back</button>
        <button type="button" class="${NS}-btn" data-act="skip">Skip</button>
        <button type="button" class="${NS}-btn" data-act="restart">Restart</button>
      </span>
    </div>`;
  document.body.append(bubble);

  const toggle = document.createElement('button');
  toggle.id = `${NS}-toggle`;
  toggle.type = 'button';
  toggle.innerHTML = `<span class="${NS}-dot"></span><span class="${NS}-toggle-label">${label}</span>`;
  document.body.append(toggle);

  const kickerEl = bubble.querySelector(`.${NS}-kicker`);
  const scriptEl = bubble.querySelector(`.${NS}-script`);
  const progressEl = bubble.querySelector(`.${NS}-progress`);
  const dot = toggle.querySelector(`.${NS}-dot`);

  let index = 0;
  let on = autoStart;
  let current = null;
  let raf = 0;

  if (storageKey) {
    const saved = Number(sessionStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved > 0 && saved < steps.length) index = saved;
  }

  const clearTarget = () => {
    if (current) current.classList.remove(`${NS}-target`);
    current = null;
  };

  const finish = () => {
    on = false;
    clearTarget();
    bubble.hidden = true;
    dot.dataset.on = 'false';
    if (storageKey) sessionStorage.removeItem(storageKey);
    if (onFinish) onFinish();
  };

  const advance = () => {
    index += 1;
    if (storageKey) sessionStorage.setItem(storageKey, String(index));
    if (index >= steps.length) finish();
    else render(true);
  };

  function bindAdvance(step, el) {
    if (el.dataset[`${NS}Bound`] === String(index)) return;
    el.dataset[`${NS}Bound`] = String(index);
    const evt = step.event || 'click';
    if (evt === 'auto') return;
    const handler = () => {
      // Let the app's own handler run first, then test the gate. A gate that
      // reads the post-interaction state is the only kind worth having.
      setTimeout(() => {
        if (!on) return;
        if (step.isComplete && !step.isComplete(el)) return;
        el.removeEventListener(evt, handler);
        delete el.dataset[`${NS}Bound`];
        advance();
      }, evt === 'click' ? 120 : 30);
    };
    el.addEventListener(evt, handler);
  }

  function render(announce) {
    if (!on) return;
    const step = steps[index];
    if (!step) return finish();

    let el = null;
    try {
      el = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
    } catch {
      el = null;
    }

    if (!el) {
      // Park. The target has not mounted yet - the user is mid-navigation, or
      // an animation is running. Parking beats skipping, because skipping
      // silently desynchronises the narration from the screen.
      bubble.hidden = true;
      clearTarget();
      return;
    }

    if (el !== current) {
      clearTarget();
      current = el;
      el.classList.add(`${NS}-target`);
      if (step.onEnter) {
        try {
          step.onEnter(el);
        } catch {
          /* a broken side effect must not stop the walkthrough */
        }
      }
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }

    bindAdvance(step, el);

    kickerEl.textContent = step.kicker || `Step ${index + 1}`;
    kickerEl.hidden = false;
    scriptEl.textContent = step.script || '';
    progressEl.textContent = `${index + 1} / ${steps.length}`;
    bubble.querySelector('[data-act="back"]').disabled = index === 0;
    bubble.hidden = false;

    const pos = place(bubble, el.getBoundingClientRect(), step.placement || 'auto', step.gap ?? 16);
    bubble.style.top = `${pos.top}px`;
    bubble.style.left = `${pos.left}px`;

    if (announce && onStep) onStep(index, step);
  }

  const tick = () => {
    if (on) render(false);
    raf = requestAnimationFrame(tick);
  };

  bubble.addEventListener('click', e => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    if (act === 'back' && index > 0) {
      clearTarget();
      index -= 1;
      render(true);
    }
    if (act === 'skip') advance();
    if (act === 'restart') {
      clearTarget();
      index = 0;
      on = true;
      dot.dataset.on = 'true';
      render(true);
    }
  });

  toggle.addEventListener('click', () => {
    on = !on;
    dot.dataset.on = String(on);
    if (on) render(true);
    else {
      clearTarget();
      bubble.hidden = true;
    }
  });

  const onKey = e => {
    if (e.key === 'Escape' && on) {
      on = false;
      dot.dataset.on = 'false';
      clearTarget();
      bubble.hidden = true;
    }
    // A presenter needs to get out of a stuck step without touching the mouse.
    if (e.key === 'ArrowRight' && e.shiftKey && on) advance();
    if (e.key === 'ArrowLeft' && e.shiftKey && on && index > 0) {
      clearTarget();
      index -= 1;
      render(true);
    }
  };
  window.addEventListener('keydown', onKey);

  dot.dataset.on = String(on);
  if (on) render(true);
  raf = requestAnimationFrame(tick);

  return function stopGuide() {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    clearTarget();
    bubble.remove();
    toggle.remove();
    styleEl.remove();
  };
}

export default startGuide;
