// Turn a capture into a working, editable React application.
//
// This does NOT try to clone the DOM byte for byte. A byte-exact clone of a
// minified SPA is unreadable, unmaintainable, and wrong the moment anyone needs
// to change a number before a customer call. What it produces instead is a
// faithful *structural* reconstruction: the same shell, the same navigation,
// the same screens, the same tables and headings, composed from a small
// primitive kit and painted with the extracted tokens.
//
// The result is a real application that a person can open, read, and edit.

import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, '../../assets/template');

const pascal = s =>
  String(s || 'Screen')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Screen';

const routePath = slug => (slug === 'home' || slug === 'root' ? '/' : `/${slug}`);
const jsx = s => String(s ?? '').replace(/[{}]/g, m => `{'${m}'}`).replace(/</g, '&lt;').replace(/>/g, '&gt;');
const js = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');

/* ---------------------------------------------------------------------------
 * Outline -> blocks
 *
 * Walk the captured outline and classify regions into things the primitive kit
 * can render. Classification is deliberately conservative: anything that cannot
 * be confidently identified becomes a labelled Card rather than a wrong guess.
 * ------------------------------------------------------------------------- */

const STAT = /^[£$€]?[\d.,]+\s*[%kKmM]?$/;

function collectBlocks(node, route, depth = 0, out = []) {
  // Depth 16 to match the capture's outline budget. A shallow cap here silently
  // reproduces the bug it was meant to avoid: on this app the stat strip sits at
  // depth 9 and a cap of 6 renders the page as "not reconstructed".
  if (!node || depth > 16 || out.length > 24) return out;
  // Never mine the furniture for content. The nav rail's link text is not this
  // page's story, and on every route it would tell the same one.
  if (node.chrome) return out;

  const kids = (node.children || []).filter(k => !k.chrome);

  // A row of sibling boxes with a short numeric value each is a stat strip.
  const statish = kids.filter(k => {
    const flat = [];
    const walk = n => {
      if (n.label) flat.push(n.label.trim());
      (n.children || []).forEach(walk);
    };
    walk(k);
    // A tile is a number plus a caption and little else. Requiring the whole
    // subtree to be small is what separates a KPI tile from a card that merely
    // happens to contain a digit.
    return flat.length > 0 && flat.length <= 4 && flat.some(t => STAT.test(t));
  });
  if (statish.length >= 2 && statish.length <= 8) {
    const tiles = statish.map(k => {
      const flat = [];
      const walk = n => {
        if (n.label) flat.push(n.label.trim());
        (n.children || []).forEach(walk);
      };
      walk(k);
      const value = flat.find(t => STAT.test(t)) || flat[0] || '-';
      const caption = flat.find(t => t !== value && t.length > 1 && t.length < 40) || 'Metric';
      return { value, caption };
    });
    out.push({ kind: 'stats', tiles });
    return out;
  }

  // Repeated siblings that are boxy and carry text are a card grid.
  // "Repeated" is the load-bearing word. A page section stack - header, then a
  // stepper, then a stat strip, then an activity panel - is also several boxy
  // children with text, and collapsing it into cards throws away the structure
  // underneath. Cards are siblings that resemble each other; sections do not.
  const boxy = kids.filter(
    k => k.box && k.box.w > 140 && k.box.h > 60 && (k.children || []).length && !STAT.test(k.label || '')
  );
  const similar = (() => {
    if (boxy.length < 2) return false;
    const hs = boxy.map(k => k.box.h);
    const ws = boxy.map(k => k.box.w);
    const ratio = (a, b) => Math.max(a, b) / Math.max(1, Math.min(a, b));
    return (
      ratio(Math.max(...hs), Math.min(...hs)) <= 1.6 &&
      ratio(Math.max(...ws), Math.min(...ws)) <= 1.6
    );
  })();
  const cardish = similar ? boxy : [];
  if (cardish.length >= 2 && cardish.length <= 12 && depth > 0) {
    const cards = cardish.slice(0, 9).map(k => {
      const flat = [];
      const walk = n => {
        if (n.label && n.label.length > 1) flat.push(n.label.trim());
        (n.children || []).forEach(walk);
      };
      walk(k);
      return {
        title: flat[0] || 'Item',
        lines: flat.slice(1, 4),
        action: (k.children || []).some(c => c.tag === 'button') ? flat.find(t => t.length < 24) : null,
        testid: k.testid || null
      };
    });
    out.push({ kind: 'cards', cards });
    return out;
  }

  for (const k of kids) {
    if (k.tag === 'table') continue;
    const before = out.length;
    collectBlocks(k, route, depth + 1, out);
    // Nothing in that subtree classified as stats or cards, but it may still be
    // a titled panel worth keeping - "Recent activity / No activity yet" is the
    // shape. Without this the sections either side of a stat strip vanish and
    // the page reads as emptier than the app it came from.
    if (out.length === before && depth >= 1) {
      const flat = [];
      const walk = n => {
        if (n.label && n.label.trim().length > 1) flat.push(n.label.trim());
        (n.children || []).forEach(walk);
      };
      walk(k);
      const box = k.box || { w: 0, h: 0 };
      if (flat.length >= 2 && flat.length <= 8 && box.w > 200 && box.h > 50) {
        out.push({ kind: 'panel', title: flat[0], lines: flat.slice(1, 5) });
      }
    }
    if (out.length > 24) break;
  }
  return out;
}

function buildRouteComponent(route, index) {
  const name = pascal(route.slug);
  const heads = (route.headings || []).filter(h => h && h.length > 1);
  const title = heads[0] || route.label || 'Screen';
  const subtitle = heads.find(h => h !== title && h.length > 24 && h.length < 220) || null;

  let outline = null;
  try {
    outline = route._outline || null;
  } catch {
    outline = null;
  }

  const blocks = outline ? collectBlocks(outline, route) : [];
  const tables = (route.tables || []).filter(t => (t.headers || []).length);

  const body = [];

  for (const block of blocks.slice(0, 6)) {
    if (block.kind === 'stats') {
      body.push(
        `      <Grid min={180} style={{ marginBottom: 20 }}>\n` +
          block.tiles
            .map(t => `        <StatTile value="${jsx(t.value)}" caption="${jsx(t.caption)}" />`)
            .join('\n') +
          `\n      </Grid>`
      );
    }
    if (block.kind === 'cards') {
      body.push(
        `      <Grid min={260} style={{ marginBottom: 20 }}>\n` +
          block.cards
            .map(
              c =>
                `        <Card${c.testid ? ` data-testid="${jsx(c.testid)}"` : ''}>\n` +
                `          <h3 style={{ margin: '0 0 6px', fontSize: 'var(--text-md, 14px)', color: 'var(--color-text)' }}>${jsx(c.title)}</h3>\n` +
                c.lines
                  .map(
                    l =>
                      `          <p style={{ margin: '0 0 4px', fontSize: 'var(--text-xs, 11px)', color: 'var(--color-text-tertiary)' }}>${jsx(l)}</p>`
                  )
                  .join('\n') +
                (c.action ? `\n          <div style={{ marginTop: 10 }}><Button variant="secondary">${jsx(c.action)}</Button></div>` : '') +
                `\n        </Card>`
            )
            .join('\n') +
          `\n      </Grid>`
      );
    }
    if (block.kind === 'panel') {
      body.push(
        `      <Card style={{ marginBottom: 20 }}>\n` +
          `        <SectionLabel>${jsx(block.title)}</SectionLabel>\n` +
          block.lines
            .map(
              l =>
                `        <p style={{ margin: '0 0 6px', fontSize: 'var(--text-sm, 12px)', color: 'var(--color-text-secondary)' }}>${jsx(l)}</p>`
            )
            .join('\n') +
          `\n      </Card>`
      );
    }
  }

  tables.slice(0, 3).forEach((t, i) => {
    body.push(
      `      <div style={{ marginBottom: 20 }}>\n` +
        `        <SectionLabel style={{ marginBottom: 8 }}>${jsx(t.headers[0] ? `${t.headers[0]} table` : 'Records')}</SectionLabel>\n` +
        `        <DataTable\n` +
        `          testid="table-${route.slug}-${i}"\n` +
        `          headers={SEED.tables['${js(route.slug)}'][${i}].headers}\n` +
        `          rows={SEED.tables['${js(route.slug)}'][${i}].rows}\n` +
        `        />\n` +
        `      </div>`
    );
  });

  if (!body.length) {
    body.push(
      `      <Empty\n` +
        `        title="${jsx(title)}"\n` +
        `        body="The capture recorded this screen but did not find structure it could classify. Open capture/screens/${route.slug}.png and build it out here."\n` +
        `      />`
    );
  }

  return `/* ${route.label} - reconstructed from ${route.url}
 *
 * Evidence: capture/screens/${route.slug}.png
 *           capture/dom/${route.slug}.outline.json
 *
 * Generated as a starting point. Edit freely - nothing regenerates this file
 * unless you re-run \`demo-forge scaffold --force\`.
 */
import React from 'react';
import { PageHeader, Card, Grid, StatTile, DataTable, SectionLabel, Button, Pill, Empty } from '../shell/primitives.jsx';
import { SEED } from '../data/seed.js';

export default function ${name}({ navigate }) {
  return (
    <>
      <PageHeader
        title="${jsx(title)}"
${subtitle ? `        subtitle="${jsx(subtitle)}"\n` : ''}        actions={<Button variant="primary" data-testid="action-${route.slug}">${jsx(route.primaryAction || 'New')}</Button>}
      />
${body.join('\n')}
    </>
  );
}
`;
}

/* --- narration ------------------------------------------------------------ */

function buildScript(routes, timeline = []) {
  // A directed capture already knows the order the story is told in, including
  // the moments that return to a screen you have seen. Use it when it exists;
  // fall back to route order for a crawl, which has no intended sequence.
  const beats = timeline.length
    ? timeline.map(t => ({ slug: t.slug, label: t.label, revisit: t.revisit }))
    : routes.map(r => ({ slug: r.slug, label: r.label, revisit: false }));

  const steps = beats.slice(0, 12).map((b, i) => {
    const target =
      i === 0
        ? `document.querySelector('[data-testid="shell-home"]')`
        : `document.querySelector('[data-testid="nav-${b.slug}"]')`;
    const what = b.label === 'Home' ? 'the landing screen' : b.label.toLowerCase();
    const hint = b.revisit
      ? `TODO: you come back to ${js(what)} here. Say what changed since last time, or why the comparison matters.`
      : `TODO: say why ${js(what)} matters to this audience. Name the decision it supports, not the button being pressed.`;
    return `  {
    target: () => ${target},
    event: 'click',
    kicker: 'Step ${i + 1}',
    script: '${hint}'
  }`;
  });

  return `/* Narration for the default audience.
 *
 * A step advances when the viewer does the thing, never on a timer. The script
 * is what a presenter would SAY, so write the reason, not the mechanic:
 *
 *   bad   "Click Waves in the sidebar."
 *   good  "Open Waves to move from scope into executable work, so the customer
 *          can see dependencies and sequencing before anyone commits a date."
 *
 * Every step below is generated with a TODO on purpose. A demo narrated by a
 * placeholder is worse than a demo with no narration, so the gate will not let
 * you ship these unedited - see scripts/verify-audiences.mjs.
 */

export const steps = [
${steps.join(',\n')}
];

export default steps;
`;
}

/* --- seed data ------------------------------------------------------------ */

function buildSeed(capture, routes) {
  const tables = {};
  for (const r of routes) {
    tables[r.slug] = (r.tables || []).slice(0, 3).map(t => ({
      headers: t.headers || [],
      rows: (t.sampleRows || []).filter(row => row.length)
    }));
  }
  return `/* Seeded data, lifted from the capture.
 *
 * This is demonstration data. It is not live, it is not connected to anything,
 * and it must never be replaced with real customer records - the whole point of
 * a shareable click-through is that there is nothing sensitive in it.
 */

export const APP = {
  name: ${JSON.stringify(capture.app?.title?.split(/[-|]/)[0].trim() || 'Demo')},
  title: ${JSON.stringify(capture.app?.title || 'Demo')},
  source: ${JSON.stringify(capture.source?.url || '')},
  capturedAt: ${JSON.stringify(capture.capturedAt || '')}
};

export const SEED = {
  tables: ${JSON.stringify(tables, null, 2).replace(/\n/g, '\n  ')}
};

export default SEED;
`;
}

/* --- route table ---------------------------------------------------------- */

function buildRouteIndex(routes) {
  const imports = routes.map(r => `import ${pascal(r.slug)} from './${pascal(r.slug)}.jsx';`).join('\n');
  const table = routes
    .map(r => `  { path: '${routePath(r.slug)}', label: '${js(r.label)}', Component: ${pascal(r.slug)} }`)
    .join(',\n');
  const navItems = routes
    .map(
      r =>
        `  { path: '${routePath(r.slug)}', label: '${js(r.label)}', testid: 'nav-${r.slug}', group: '${
          routePath(r.slug) === '/' ? 'Menu' : 'Workspace'
        }' }`
    )
    .join(',\n');

  return `/* The route table.
 *
 * One entry per screen. \`scripts/verify-routes.mjs\` fails the build on a
 * duplicate path, because the second one silently never renders and that is
 * only ever noticed in front of a customer.
 */
${imports}

export const routes = [
${table}
];

export const nav = [
${navItems}
];

export default routes;
`;
}

/* --- main ----------------------------------------------------------------- */

export async function scaffold({ captureDir, outDir, designDir, name, force = false }) {
  const capture = JSON.parse(await readFile(join(captureDir, 'capture.json'), 'utf8'));
  if (existsSync(join(outDir, 'src')) && !force) {
    throw new Error(`${outDir} already has a src/. Pass --force to regenerate over it.`);
  }

  const routes = [];
  for (const r of capture.routes || []) {
    let outline = null;
    const f = join(captureDir, r.outlineFile || `dom/${r.slug}.outline.json`);
    if (existsSync(f)) outline = JSON.parse(await readFile(f, 'utf8'));
    routes.push({ ...r, _outline: outline });
  }
  if (!routes.length) throw new Error('The capture contains no routes. Re-run capture with a longer --wait.');

  // Home first, then capture order. The shell needs a root route to exist.
  routes.sort((a, b) => (a.slug === 'home' ? -1 : b.slug === 'home' ? 1 : 0));

  await mkdir(outDir, { recursive: true });
  await cp(TEMPLATE, outDir, {
    recursive: true,
    force: true,
    filter: src => !src.endsWith('package.json.tpl')
  });

  const slug = name || (capture.app?.title || 'demo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const title = capture.app?.title || 'Demo';

  // package.json and the dev entry carry the app identity.
  const pkg = (await readFile(join(TEMPLATE, 'package.json.tpl'), 'utf8'))
    .replace(/__SLUG__/g, slug)
    .replace(/__TITLE__/g, title.replace(/"/g, ''))
    .replace(/__SOURCE__/g, capture.source?.url || '');
  await writeFile(join(outDir, 'package.json'), pkg);

  const html = (await readFile(join(TEMPLATE, 'index.html'), 'utf8')).replace(/__TITLE__/g, title);
  await writeFile(join(outDir, 'index.html'), html);

  // Tokens come from the design extraction when it ran, otherwise a neutral
  // starting palette so the app still builds.
  const tokensSrc = designDir ? join(designDir, 'tokens.css') : null;
  if (tokensSrc && existsSync(tokensSrc)) {
    await cp(tokensSrc, join(outDir, 'src/theme/tokens.css'));
  } else {
    await writeFile(
      join(outDir, 'src/theme/tokens.css'),
      `/* TODO: no design extraction was supplied. Run:\n *   demo-forge design --capture <dir>\n * and copy tokens.css here. */\n:root {\n  --color-bg: #f9fafb;\n  --color-surface: #ffffff;\n  --color-border: #e5e7eb;\n  --color-text: #111827;\n  --color-text-secondary: #374151;\n  --color-text-tertiary: #6b7280;\n  --color-accent: #4f46e5;\n  --color-accent-fg: #ffffff;\n  --font-sans: system-ui, -apple-system, 'Segoe UI', sans-serif;\n  --font-mono: ui-monospace, Menlo, monospace;\n  --text-base: 13px;\n  --radius-md: 8px;\n  --radius-xl: 12px;\n}\n`
    );
  }

  await mkdir(join(outDir, 'src/routes'), { recursive: true });
  await mkdir(join(outDir, 'src/demo/scripts'), { recursive: true });
  await mkdir(join(outDir, 'src/data'), { recursive: true });

  for (const [i, r] of routes.entries()) {
    await writeFile(join(outDir, `src/routes/${pascal(r.slug)}.jsx`), buildRouteComponent(r, i));
  }
  await writeFile(join(outDir, 'src/routes/index.jsx'), buildRouteIndex(routes));
  await writeFile(join(outDir, 'src/data/seed.js'), buildSeed(capture, routes));
  await writeFile(join(outDir, 'src/demo/scripts/default.js'), buildScript(routes, capture.timeline || []));
  await writeFile(
    join(outDir, 'src/demo/scripts/index.js'),
    `/* Narration modules, one per audience.
 *
 * The registry's \`script\` field names the key. An audience with no script
 * falls back to 'default', which is the generic product tour.
 */
import defaultSteps from './default.js';

const SCRIPTS = {
  default: defaultSteps
  // demo-forge audience:add appends here
};

export const scriptFor = key => SCRIPTS[key] || SCRIPTS.default;
export default SCRIPTS;
`
  );

  // Carry the evidence into the project. A demo whose screenshots live in
  // somebody's Downloads folder cannot be checked against its source later.
  const evidenceDir = join(outDir, 'capture');
  await mkdir(evidenceDir, { recursive: true });
  await cp(captureDir, evidenceDir, { recursive: true, force: true });

  await writeFile(
    join(outDir, '.gitignore'),
    'node_modules/\ndist/\n.render-evidence/\n.DS_Store\n*.log\n'
  );

  return {
    outDir,
    slug,
    title,
    routes: routes.map(r => ({ slug: r.slug, label: r.label, path: routePath(r.slug) })),
    tokens: tokensSrc && existsSync(tokensSrc) ? 'extracted' : 'placeholder'
  };
}

/* --- audience registration ------------------------------------------------ */

export async function addAudience({ projectDir, path, label, guided = false, aliases = [], dryRun = false }) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (!/^\/[A-Za-z0-9][A-Za-z0-9-]*$/.test(clean)) {
    throw new Error(`Refusing "${clean}" - use letters, digits and hyphens only, e.g. /Finance-guide.`);
  }
  const RESERVED = ['new', 'setup', 'dashboard', 'urls', 'assets', 'screens'];
  if (RESERVED.includes(clean.slice(1).toLowerCase())) {
    throw new Error(`Refusing "${clean}" - that name is an app route (${RESERVED.join(', ')}).`);
  }

  const regFile = join(projectDir, 'src/demo/registry.js');
  const src = await readFile(regFile, 'utf8');
  if (new RegExp(`path:\\s*'${clean}'`).test(src)) {
    return { alreadyRegistered: true, path: clean };
  }
  const ANCHOR = '  // demo-forge audience:add appends here';
  if (!src.includes(ANCHOR)) {
    throw new Error('The audience:add anchor is missing from src/demo/registry.js. It was hand edited; restore the comment first.');
  }

  const scriptKey = clean.slice(1).toLowerCase();
  const entry =
    `  ,{\n` +
    `    path: '${clean}',\n` +
    `    label: '${js(label || clean.slice(1).replace(/-/g, ' '))}',\n` +
    `    status: 'coming-soon',\n` +
    (guided ? `    guided: true,\n    script: '${scriptKey}',\n` : '') +
    (aliases.length ? `    aliases: [${aliases.map(a => `'${js(a)}'`).join(', ')}],\n` : '') +
    `  }\n`;

  const next = src.replace(ANCHOR, `${entry}${ANCHOR}`);

  const files = [[regFile, next]];

  if (guided) {
    const idxFile = join(projectDir, 'src/demo/scripts/index.js');
    const idx = await readFile(idxFile, 'utf8');
    const SANCHOR = '  // demo-forge audience:add appends here';
    const varName = pascal(scriptKey) + 'Steps';
    if (!idx.includes(`'${scriptKey}'`)) {
      files.push([
        idxFile,
        idx
          .replace(/^import defaultSteps/m, `import ${varName} from './${scriptKey}.js';\nimport defaultSteps`)
          .replace(SANCHOR, `  ,'${scriptKey}': ${varName}\n${SANCHOR}`)
      ]);
      files.push([
        join(projectDir, `src/demo/scripts/${scriptKey}.js`),
        `/* Narration for "${js(label || clean)}".
 *
 * Write what a presenter would SAY, and why this audience should care. Every
 * step advances on a real interaction, never on a timer.
 */
import defaultSteps from './default.js';

export const steps = defaultSteps.map(step => ({ ...step }));

export default steps;
`
      ]);
    }
  }

  if (dryRun) return { dryRun: true, path: clean, files: files.map(f => f[0]) };
  for (const [file, content] of files) await writeFile(file, content);
  return { path: clean, guided, files: files.map(f => f[0]) };
}
