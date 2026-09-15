// Capture a live web application into a reproducible evidence bundle.
//
// The output is deliberately *evidence*, not a copy. It records what the app
// actually paints - resolved custom properties, painted colour/font/radius
// tallies, a semantic outline per route, and a screenshot per route - so the
// reconstruction is grounded in a measurement rather than in somebody's memory
// of the design.
//
// The single most common reason a scrape of a Power Apps "code app" comes back
// empty is that the app renders inside the player iframe. Reading `document` on
// the top frame returns a shell with no theme and no content. findAppFrame()
// walks every frame and scores them, so this works on both a plain SPA and a
// Power Apps player without the caller having to know which one it is.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

const VIEWPORTS = {
  desktop: { width: 1536, height: 960 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 414, height: 896 }
};

const ASSET_TYPES = new Set(['image', 'font', 'stylesheet']);
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export const slugify = s =>
  String(s || 'route')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'root';

/* ---------------------------------------------------------------------------
 * Frame resolution
 *
 * Score every frame in the page and pick the one that owns the application.
 * A Power Apps player nests the real app two or three frames deep, and the top
 * frame is a loading shell. Scoring beats "take the biggest iframe" because a
 * consent dialog or a telemetry pixel can also be large.
 * ------------------------------------------------------------------------- */
export async function findAppFrame(page, { verbose = false } = {}) {
  const scored = [];
  for (const frame of page.frames()) {
    try {
      const score = await frame.evaluate(() => {
        const d = document;
        if (!d || !d.body) return null;
        const themed = d.querySelector('[data-theme],[data-color-mode],[data-mui-color-scheme]');
        const root = d.documentElement;
        const props = root ? getComputedStyle(root) : null;
        let customProps = 0;
        if (props) {
          for (let i = 0; i < props.length; i++) {
            if (props[i].startsWith('--')) customProps++;
          }
        }
        const elements = d.querySelectorAll('*').length;
        const text = (d.body.innerText || '').trim().length;
        const interactive = d.querySelectorAll(
          'button,a[href],input,select,textarea,[role="button"],[role="tab"]'
        ).length;
        const reactRoot = !!d.querySelector('#root,#app,[data-reactroot],[id^="__next"]');
        return {
          elements,
          text,
          interactive,
          customProps,
          themed: !!themed,
          reactRoot,
          title: d.title || '',
          url: location.href
        };
      });
      if (!score) continue;
      // Weighted so that "has a theme + custom properties + interactive controls"
      // beats "has a lot of DOM", which is what a loading shell looks like.
      const weight =
        score.elements * 1 +
        score.interactive * 40 +
        score.customProps * 25 +
        (score.themed ? 3000 : 0) +
        (score.reactRoot ? 1500 : 0) +
        Math.min(score.text, 5000);
      scored.push({ frame, score, weight });
    } catch {
      // Cross-origin frames throw. They are not ours, so skipping is correct.
    }
  }
  scored.sort((a, b) => b.weight - a.weight);
  if (verbose) {
    for (const s of scored.slice(0, 5)) {
      console.log(
        `    frame weight=${s.weight} els=${s.score.elements} props=${s.score.customProps} ` +
          `themed=${s.score.themed} ${s.score.url.slice(0, 80)}`
      );
    }
  }
  if (!scored.length) return page.mainFrame();
  return scored[0].frame;
}

/* ---------------------------------------------------------------------------
 * In-page probe
 *
 * Everything below runs inside the app frame. It returns a plain object, so it
 * has to be self-contained - no imports, no closures over Node scope.
 * ------------------------------------------------------------------------- */
const PROBE = () => {
  const d = document;
  const norm = c => {
    if (!c) return null;
    const s = String(c).trim().toLowerCase();
    if (!s || s === 'none' || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null;
    const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (!m) return s.startsWith('#') ? s.slice(0, 7) : s;
    const hex = n => Math.round(Number(n)).toString(16).padStart(2, '0');
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  };
  const bump = (map, key) => {
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  };

  // 1. Resolved custom properties on :root. This is the design system, if the
  //    app has one. Reading the cssRules is required because getComputedStyle
  //    does not enumerate custom properties in every engine.
  const customProperties = {};
  const rootStyle = getComputedStyle(d.documentElement);
  for (let i = 0; i < rootStyle.length; i++) {
    const name = rootStyle[i];
    if (name.startsWith('--')) customProperties[name] = rootStyle.getPropertyValue(name).trim();
  }
  for (const sheet of Array.from(d.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules || [])) {
      if (!rule.style || !rule.selectorText) continue;
      if (!/(^|,)\s*(:root|html|\[data-theme[^\]]*\])\s*(,|$)/.test(rule.selectorText)) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const name = rule.style[i];
        if (!name.startsWith('--')) continue;
        const resolved = rootStyle.getPropertyValue(name).trim();
        customProperties[name] = resolved || rule.style.getPropertyValue(name).trim();
      }
    }
  }

  // 2. What is actually painted. A token file can define 200 properties and the
  //    app can use 12 of them, so the tally is the honest signal.
  //
  //    Three tallies, not one, because element COUNT alone gets two roles wrong
  //    every time:
  //      - backgroundArea: the canvas is one huge element and the cards are
  //        forty small ones, so counting elements elects the card colour as the
  //        canvas. Area does not make that mistake.
  //      - interactive:    the accent is defined by WHERE it is painted - on
  //        buttons, links and the active nav item - not by how saturated it is.
  //        Ranking by saturation elects the success green.
  const colors = {};
  const backgrounds = {};
  const backgroundArea = {};
  const borderColors = {};
  const interactiveColors = {};
  const interactiveBackgrounds = {};
  const fonts = {};
  const fontSizes = {};
  const fontWeights = {};
  const radii = {};
  const shadows = {};
  const spacing = {};
  let visible = 0;

  const INTERACTIVE =
    'button,a[href],[role="button"],[role="link"],[role="tab"],summary,' +
    'input[type="submit"],input[type="button"],[aria-current],[aria-selected="true"]';

  // The app may be scaled by a zoom or a transform, in which case every computed
  // px is the SCALED value and the whole type scale comes out wrong. Measure the
  // factor once so the scale can be reported in real units.
  let scale = 1;
  try {
    const probeEl = d.createElement('div');
    probeEl.style.cssText = 'position:absolute;width:100px;height:0;visibility:hidden;pointer-events:none';
    d.body.appendChild(probeEl);
    const measured = probeEl.getBoundingClientRect().width;
    if (measured > 0) scale = measured / 100;
    probeEl.remove();
  } catch {
    scale = 1;
  }

  const all = d.querySelectorAll('*');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    visible++;
    const isInteractive = el.matches(INTERACTIVE);
    const hasText = Array.from(el.childNodes).some(
      n => n.nodeType === 3 && n.textContent.trim().length
    );
    if (hasText) {
      bump(colors, norm(cs.color));
      if (isInteractive) bump(interactiveColors, norm(cs.color));
      bump(fonts, (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim());
      // Normalise the scale back out, then snap to the nearest half pixel so a
      // 12.999 and a 13.001 are the same token rather than two.
      bump(fontSizes, `${Math.round((parseFloat(cs.fontSize) / scale) * 2) / 2}px`);
      bump(fontWeights, cs.fontWeight);
    }
    const bg = norm(cs.backgroundColor);
    bump(backgrounds, bg);
    if (bg) backgroundArea[bg] = (backgroundArea[bg] || 0) + Math.round(rect.width * rect.height);
    if (isInteractive) bump(interactiveBackgrounds, bg);
    if (cs.borderTopWidth !== '0px') bump(borderColors, norm(cs.borderTopColor));
    if (cs.borderTopLeftRadius !== '0px') {
      bump(radii, `${Math.round(parseFloat(cs.borderTopLeftRadius) / scale)}px`);
    }
    if (cs.boxShadow && cs.boxShadow !== 'none') bump(shadows, cs.boxShadow);
    for (const p of ['paddingTop', 'paddingLeft', 'gap']) {
      const v = cs[p];
      if (v && v !== '0px' && v !== 'normal') bump(spacing, `${Math.round(parseFloat(v) / scale)}px`);
    }
  }

  // 3. A semantic outline. Full HTML is unusable for reconstruction because it
  //    is minified class soup; the outline keeps structure, role and label.
  const LANDMARK = /^(header|nav|main|aside|footer|section|form|table|ul|ol|dialog)$/i;
  // A node budget, not a depth cap. Real apps nest deeply - styled-components,
  // flex wrappers, portal roots - and a shallow cap spends the whole budget on
  // the nav rail and truncates exactly where the page content starts. Depth 7
  // on this app stopped at <main> with zero children.
  let outlineBudget = 1200;
  const outline = (el, depth) => {
    if (depth > 16 || outlineBudget <= 0) return null;
    outlineBudget--;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|noscript|svg|path|meta|link)$/.test(tag)) return null;
    const rect = el.getBoundingClientRect();
    const role = el.getAttribute('role');
    const testid =
      el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    const label =
      el.getAttribute('aria-label') ||
      (el.children.length === 0 ? (el.textContent || '').trim().slice(0, 120) : '');
    const interactive = /^(button|a|input|select|textarea)$/.test(tag) || !!role;
    // Mark the furniture. The sidebar and the header repeat on every route, so
    // treating their text as page content produces a "navigation" card on each
    // screen and buries the content that actually differs.
    const chrome =
      /^(nav|header|aside)$/.test(tag) ||
      role === 'navigation' ||
      role === 'banner' ||
      /sidebar|rail|topbar|navbar|app-?bar/i.test(el.className && el.className.baseVal !== undefined ? '' : String(el.className || ''));
    const kids = [];
    for (const child of el.children) {
      const c = outline(child, depth + 1);
      if (c) kids.push(c);
      if (kids.length > 40) break;
    }
    const keep =
      interactive ||
      testid ||
      LANDMARK.test(tag) ||
      label ||
      kids.length ||
      rect.width * rect.height > 20000;
    if (!keep) return null;
    return {
      tag,
      ...(role ? { role } : {}),
      ...(chrome ? { chrome: true } : {}),
      ...(testid ? { testid } : {}),
      ...(el.id ? { id: el.id } : {}),
      ...(label ? { label } : {}),
      ...(el.getAttribute('href') ? { href: el.getAttribute('href') } : {}),
      ...(tag === 'input' || tag === 'select'
        ? { inputType: el.getAttribute('type') || tag, placeholder: el.placeholder || '' }
        : {}),
      box: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      },
      style: {
        bg: norm(cs.backgroundColor),
        fg: norm(cs.color),
        radius: cs.borderTopLeftRadius,
        border: cs.borderTopWidth === '0px' ? null : `${cs.borderTopWidth} solid ${norm(cs.borderTopColor)}`,
        font: `${cs.fontWeight} ${cs.fontSize} ${(cs.fontFamily || '').split(',')[0].replace(/["']/g, '')}`,
        display: cs.display,
        ...(cs.display.includes('flex') || cs.display.includes('grid')
          ? { direction: cs.flexDirection, gap: cs.gap, cols: cs.gridTemplateColumns }
          : {})
      },
      ...(kids.length ? { children: kids } : {})
    };
  };

  // 4. Candidate navigation. This is what the crawler will click next, and what
  //    becomes the click-through demo's step targets.
  const navCandidates = [];
  const navSel =
    'a[href],button,[role="tab"],[role="menuitem"],[role="link"],[data-testid*="nav"],' +
    'nav li,[class*="sidebar"] button,[class*="nav"] button,[class*="menu"] a';
  for (const el of d.querySelectorAll(navSel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!text || text.length > 60) continue;
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test');
    const href = el.getAttribute('href') || null;
    // A control mutates the current view; a link changes which view you are on.
    // aria tells us which is which far more reliably than the label text does.
    const expands =
      el.hasAttribute('aria-expanded') ||
      el.hasAttribute('aria-controls') ||
      el.getAttribute('aria-haspopup') === 'true';
    navCandidates.push({
      text,
      href,
      testid: testid || null,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      expands,
      current: el.getAttribute('aria-current') || null,
      inNav: !!el.closest('nav,[class*="sidebar"],[class*="rail"],[role="navigation"]'),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
    });
    if (navCandidates.length > 160) break;
  }

  // 5. Text content, so the reconstruction can seed plausible copy.
  const headings = Array.from(d.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="heading"]'))
    .map(h => (h.textContent || '').trim().replace(/\s+/g, ' '))
    .filter(t => t && t.length < 120)
    .slice(0, 60);

  // 5a. Content signature. The question the crawler needs answered after every
  //     click is "did that change the view, or just the chrome?". Collapsing a
  //     nav rail changes the element count and the URL stays put, so neither is
  //     a reliable answer. Digesting the *content region* is: a real navigation
  //     replaces it, a toggle leaves it alone.
  const contentRoot =
    d.querySelector('main,[role="main"],[class*="content"]:not([class*="sidebar"])') || d.body;
  const chrome = 'nav,[role="navigation"],[class*="sidebar"],[class*="rail"],header,[class*="topbar"]';
  const sigParts = [];
  for (const el of contentRoot.querySelectorAll('h1,h2,h3,th,[class*="title"],[class*="label"]')) {
    if (el.closest(chrome)) continue;
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (t && t.length < 90) sigParts.push(t);
    if (sigParts.length >= 40) break;
  }
  let hash = 5381;
  const sigSource = sigParts.join('|');
  for (let i = 0; i < sigSource.length; i++) hash = ((hash << 5) + hash + sigSource.charCodeAt(i)) | 0;
  const contentSignature = `${sigParts.length}:${(hash >>> 0).toString(36)}`;

  const tables = Array.from(d.querySelectorAll('table')).slice(0, 8).map(t => ({
    headers: Array.from(t.querySelectorAll('thead th, tr:first-child th')).map(th =>
      (th.textContent || '').trim()
    ),
    sampleRows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 6).map(tr =>
      Array.from(tr.children).map(td => (td.textContent || '').trim().slice(0, 80))
    )
  }));

  const images = Array.from(d.querySelectorAll('img')).slice(0, 80).map(i => ({
    src: i.currentSrc || i.src,
    alt: i.alt || '',
    w: i.naturalWidth,
    h: i.naturalHeight
  }));

  return {
    url: location.href,
    title: d.title,
    theme: d.documentElement.getAttribute('data-theme') || null,
    lang: d.documentElement.lang || null,
    visibleElements: visible,
    renderScale: scale,
    customProperties,
    painted: {
      colors,
      backgrounds,
      backgroundArea,
      borderColors,
      interactiveColors,
      interactiveBackgrounds,
      fonts,
      fontSizes,
      fontWeights,
      radii,
      shadows,
      spacing
    },
    outline: outline(d.body, 0),
    navCandidates,
    headings,
    contentSignature,
    tables,
    images
  };
};

/* ------------------------------------------------------------------------ */

async function settle(page, ms = 900) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    /* a long-polling SPA never goes idle; the fixed wait below covers it */
  }
  await page.waitForTimeout(ms);
}

export async function captureSite(options) {
  const {
    url,
    outDir,
    maxRoutes = 12,
    viewport = 'desktop',
    headed = false,
    profileDir = null,
    storageState = null,
    waitMs = 2500,
    manualLogin = false,
    verbose = true
  } = options;

  const { chromium } = await import('playwright');
  const vp = VIEWPORTS[viewport] || VIEWPORTS.desktop;

  await mkdir(join(outDir, 'screens'), { recursive: true });
  await mkdir(join(outDir, 'dom'), { recursive: true });
  await mkdir(join(outDir, 'assets'), { recursive: true });

  let browser = null;
  let context;
  if (profileDir) {
    // A persistent profile is how an authenticated app gets captured: sign in
    // once by hand with --headed, and every later run reuses the session.
    context = await chromium.launchPersistentContext(profileDir, {
      headless: !headed && !manualLogin,
      viewport: vp,
      args: ['--disable-blink-features=AutomationControlled']
    });
  } else {
    browser = await chromium.launch({ headless: !headed && !manualLogin });
    context = await browser.newContext({
      viewport: vp,
      ...(storageState && existsSync(storageState) ? { storageState } : {})
    });
  }

  const assets = [];
  const seenAssets = new Set();
  const networkErrors = [];

  context.on('response', async res => {
    try {
      const req = res.request();
      const type = req.resourceType();
      if (res.status() >= 400) {
        networkErrors.push({ url: res.url().slice(0, 200), status: res.status(), type });
        return;
      }
      if (!ASSET_TYPES.has(type)) return;
      const u = res.url();
      if (u.startsWith('data:') || seenAssets.has(u)) return;
      seenAssets.add(u);
      const body = await res.body().catch(() => null);
      if (!body || body.length > MAX_ASSET_BYTES) return;
      const hash = createHash('sha1').update(u).digest('hex').slice(0, 10);
      let ext = extname(new URL(u).pathname).split('?')[0] || '';
      if (!ext) ext = type === 'font' ? '.woff2' : type === 'stylesheet' ? '.css' : '.bin';
      const name = `${type}-${hash}${ext}`;
      await writeFile(join(outDir, 'assets', name), body);
      assets.push({ type, url: u, file: `assets/${name}`, bytes: body.length });
    } catch {
      /* asset capture is best effort and must never fail the run */
    }
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));

  if (verbose) console.log(`  -> ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await settle(page, waitMs);

  if (manualLogin) {
    console.log('\n  MANUAL LOGIN. Sign in in the open browser window.');
    console.log('  Press Enter here when the app has finished loading...');
    await new Promise(resolve => {
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.pause();
        resolve();
      });
    });
    await settle(page, waitMs);
  }

  const routes = [];
  const controls = [];
  const visited = new Set();
  const signatures = new Map();
  const queue = [{ label: 'Home', via: 'entry' }];

  while (queue.length && routes.length < maxRoutes) {
    const job = queue.shift();

    if (job.via !== 'entry') {
      // Return to the entry point before each hop. An SPA's state machine is
      // not guaranteed reversible, so replaying from a known start is the only
      // way to get a deterministic capture.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await settle(page, waitMs);
      const frame = await findAppFrame(page);
      const clicked = await frame
        .evaluate(sel => {
          const pick = () => {
            if (sel.testid) {
              const byId = document.querySelector(`[data-testid="${sel.testid}"]`);
              if (byId) return byId;
            }
            const all = Array.from(
              document.querySelectorAll('a[href],button,[role="tab"],[role="menuitem"],[role="link"]')
            );
            return all.find(
              e => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ') === sel.text
            );
          };
          const el = pick();
          if (!el) return false;
          el.scrollIntoView({ block: 'center' });
          el.click();
          return true;
        }, job)
        .catch(() => false);
      if (!clicked) {
        if (verbose) console.log(`     skip "${job.label}" (target not found on replay)`);
        continue;
      }
      await settle(page, Math.max(800, waitMs - 800));
    }

    const frame = await findAppFrame(page, { verbose: verbose && routes.length === 0 });
    let data;
    try {
      data = await frame.evaluate(PROBE);
    } catch (e) {
      if (verbose) console.log(`     probe failed for "${job.label}": ${String(e).slice(0, 120)}`);
      continue;
    }

    const key = `${data.url}::${(data.headings[0] || '')}::${data.visibleElements}`;
    if (visited.has(key)) continue;
    visited.add(key);

    // Did that click actually navigate? A control that toggles a rail or opens
    // a panel leaves the content region untouched. Recording it as a route
    // would give the demo a page that is really just the home page with the
    // furniture moved - and would burn one of the route slots doing it.
    if (job.via !== 'entry' && signatures.has(data.contentSignature)) {
      controls.push({
        label: job.label,
        text: job.text,
        testid: job.testid || null,
        effect: 'mutates the current view',
        sameContentAs: signatures.get(data.contentSignature)
      });
      if (verbose) console.log(`     control "${job.label}" (content unchanged, not a route)`);
      continue;
    }
    signatures.set(data.contentSignature, job.label);

    const slug = slugify(job.label === 'Home' ? 'home' : job.label);
    const shot = `screens/${slug}.png`;
    await page.screenshot({ path: join(outDir, shot), fullPage: false }).catch(() => {});
    await page
      .screenshot({ path: join(outDir, `screens/${slug}-full.png`), fullPage: true })
      .catch(() => {});

    const html = await frame.evaluate(() => document.body.outerHTML).catch(() => '');
    await writeFile(join(outDir, `dom/${slug}.html`), html);
    await writeFile(join(outDir, `dom/${slug}.outline.json`), JSON.stringify(data.outline, null, 2));

    routes.push({
      slug,
      label: job.label,
      via: job.via,
      url: data.url,
      title: data.title,
      screenshot: shot,
      fullScreenshot: `screens/${slug}-full.png`,
      outlineFile: `dom/${slug}.outline.json`,
      domFile: `dom/${slug}.html`,
      visibleElements: data.visibleElements,
      headings: data.headings,
      tables: data.tables,
      images: data.images,
      painted: data.painted,
      navCandidates: data.navCandidates
    });
    if (verbose) console.log(`  [${routes.length}/${maxRoutes}] ${job.label} - ${data.visibleElements} els`);

    if (routes.length === 1) {
      // Only the entry route seeds the queue. Following nav from every page
      // explodes combinatorially and mostly rediscovers the same shell.
      const seen = new Set(['Home']);
      const ranked = data.navCandidates
        .filter(c => c.inNav || c.tag === 'a')
        // An element that declares aria-expanded/controls/haspopup is telling us
        // outright that it operates on this view rather than leaving it. Trust it.
        .filter(c => !c.expands)
        .sort((a, b) => Number(b.inNav) - Number(a.inNav) || a.box.y - b.box.y);
      for (const c of ranked) {
        if (seen.has(c.text)) continue;
        if (/^(sign out|log out|logout|help|close|cancel|back)$/i.test(c.text)) continue;
        seen.add(c.text);
        queue.push({ label: c.text, text: c.text, testid: c.testid, via: 'nav' });
        if (queue.length >= maxRoutes * 2) break;
      }
    }
  }

  // The design system is read from the entry route: it is the one guaranteed to
  // have the shell mounted with every token resolved.
  const entryFrame = await findAppFrame(page);
  const entry = await entryFrame.evaluate(PROBE).catch(() => null);

  const manifest = {
    capturedAt: new Date().toISOString(),
    source: { url, viewport, viewportSize: vp },
    app: {
      title: entry?.title || routes[0]?.title || '',
      theme: entry?.theme || null,
      lang: entry?.lang || null,
      isPowerApps: /powerapps\.com|dynamics\.com|powerplatform/i.test(url),
      appFrameUrl: entryFrame.url()
    },
    customProperties: entry?.customProperties || {},
    routes,
    controls,
    assets,
    diagnostics: {
      consoleErrors: consoleErrors.slice(0, 40),
      networkErrors: networkErrors.slice(0, 40),
      frameCount: page.frames().length
    }
  };

  await writeFile(join(outDir, 'capture.json'), JSON.stringify(manifest, null, 2));

  await context.close();
  if (browser) await browser.close();
  return manifest;
}
