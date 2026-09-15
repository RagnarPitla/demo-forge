#!/usr/bin/env node
/* Render gate.
 *
 * Changed bytes are not the same claim as changed pixels. This builds nothing -
 * it serves `dist/` and reads the result back out of a live DOM, asserting that
 * every registered route actually paints, that the token palette reached the
 * screen, that the console is clean, and that a visitor inside an audience
 * sub-site cannot escape to the front door by pressing Home.
 *
 * Exit 0 means those four things were observed, not assumed.
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const EVIDENCE = join(ROOT, '.render-evidence');
const PORT = Number(process.env.GATE_PORT || 4319);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('FAIL  dist/index.html is missing. Run `npm run build` first.');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  let file = join(DIST, url === '/' ? 'index.html' : url.replace(/^\/+/, ''));
  if (!existsSync(file)) file = join(DIST, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(r => server.listen(PORT, r));

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

await mkdir(EVIDENCE, { recursive: true });

// Read the route and audience tables straight out of the source, so the gate
// cannot drift from what ships.
const routesSrc = await readFile(join(ROOT, 'src/routes/index.jsx'), 'utf8');
const registrySrc = await readFile(join(ROOT, 'src/demo/registry.js'), 'utf8');
// Scope to the routes export. The same file also declares navItems with an
// identical shape, and an unscoped match counts every route twice - which looks
// like a passing gate over twice the surface it actually tested.
const routesBlock = routesSrc.match(/export const routes\s*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? '';
const routePaths = [...routesBlock.matchAll(/path:\s*'([^']+)'/g)].map(m => m[1]);
if (!routePaths.length) {
  console.error('FAIL - no routes found in src/routes/index.jsx (expected `export const routes = [`)');
  process.exit(1);
}
const audiencePaths = [...registrySrc.matchAll(/path:\s*'(\/[^']+)'/g)].map(m => m[1]);
const accent = (await readFile(join(ROOT, 'src/theme/tokens.css'), 'utf8')).match(
  /--color-accent:\s*(#[0-9a-f]{3,8})/i
)?.[1];

const results = [];
let failed = 0;

async function visit(hash, name, { expectContained = null } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

  await page.goto(`http://127.0.0.1:${PORT}/#${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const probe = await page.evaluate(acc => {
    const els = Array.from(document.querySelectorAll('*')).filter(e => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    const toHex = c => {
      const m = String(c).match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
      if (!m) return null;
      const h = n => Math.round(Number(n)).toString(16).padStart(2, '0');
      return `#${h(m[1])}${h(m[2])}${h(m[3])}`.toLowerCase();
    };
    let accentHits = 0;
    if (acc) {
      const want = acc.toLowerCase().slice(0, 7);
      for (const e of els) {
        const cs = getComputedStyle(e);
        if (toHex(cs.color) === want || toHex(cs.backgroundColor) === want || toHex(cs.borderTopColor) === want) accentHits++;
      }
    }
    return {
      elements: els.length,
      text: (document.body.innerText || '').trim().length,
      accentHits,
      hash: location.hash,
      hasShell: !!document.querySelector('[data-testid="shell-home"]'),
      guide: !!document.getElementById('dfg-toggle')
    };
  }, accent);

  let containment = null;
  if (expectContained) {
    await page.click('[data-testid="shell-home"]').catch(() => {});
    await page.waitForTimeout(500);
    const after = page.url().split('#')[1] || '/';
    containment = { after, stayed: after.toLowerCase().startsWith(expectContained.toLowerCase()) };
  }

  await page.screenshot({ path: join(EVIDENCE, `${name}.png`) });

  const ok =
    probe.elements >= 12 &&
    probe.text > 0 &&
    errors.length === 0 &&
    (!expectContained || containment.stayed);
  if (!ok) failed++;

  results.push({ name, hash, ok, ...probe, errors, containment });
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} els=${String(probe.elements).padStart(4)} ` +
      `accent=${String(probe.accentHits).padStart(3)} text=${probe.text}` +
      (containment ? ` home->${containment.after}` : '') +
      (errors.length ? `\n         errors: ${errors.join(' | ')}` : '')
  );
  await page.close();
}

console.log('\nRender gate\n-----------');
console.log(`accent token: ${accent || 'NOT SET'}`);
console.log(`routes:       ${routePaths.length}`);
console.log(`audiences:    ${audiencePaths.length}\n`);

for (const p of routePaths) await visit(p, `route${p.replace(/\W+/g, '-')}`);
for (const p of audiencePaths) await visit(p, `audience${p.replace(/\W+/g, '-')}`, { expectContained: p });

await writeFile(join(EVIDENCE, 'render.json'), JSON.stringify({ accent, results }, null, 2));

await browser.close();
server.close();

const paintedAccent = results.some(r => r.accentHits > 0);
if (accent && !paintedAccent) {
  console.log('\n  FAIL  the accent token is defined but never painted on any route.');
  failed++;
}

console.log(`\n${failed ? `RENDER FAIL - ${failed} check(s) failed` : `RENDER PASS - ${results.length} screens`}`);
console.log(`evidence: .render-evidence/\n`);
process.exit(failed ? 1 : 0);
