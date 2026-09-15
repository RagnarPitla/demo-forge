#!/usr/bin/env node
/* The audience registry is intact.
 *
 * The registry is what makes a merge additive: merging ADDS a URL, it never
 * replaces the front door. This gate asserts the shape the tooling depends on,
 * so a hand edit that breaks `audience:add` is caught here rather than in a
 * 1.8 MB diff nobody can read.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const src = await readFile(join(ROOT, 'src/demo/registry.js'), 'utf8');

let fail = 0;
const start = src.indexOf('export const audiences = [');
const end = src.indexOf('\n];', start);
if (start < 0 || end < 0) {
  console.error('FAIL  could not find the AUDIENCE REGISTRY array. It was hand edited past recognition.');
  process.exit(1);
}
const block = src.slice(start, end);

const paths = [...block.matchAll(/path:\s*'([^']+)'/g)].map(m => m[1]);
const aliasGroups = [...block.matchAll(/aliases:\s*\[([^\]]*)\]/g)].map(m =>
  [...m[1].matchAll(/'([^']+)'/g)].map(a => a[1])
);
const all = [...paths, ...aliasGroups.flat()];

const seen = new Set();
for (const p of all) {
  const k = p.toLowerCase();
  if (seen.has(k)) { console.error(`FAIL  ${p} is claimed twice across paths and aliases`); fail++; }
  seen.add(k);
  if (!/^\/[A-Za-z0-9][A-Za-z0-9-]*$/.test(p)) { console.error(`FAIL  bad audience path: ${p}`); fail++; }
}

const RESERVED = ['new', 'setup', 'dashboard', 'urls', 'assets', 'screens'];
for (const p of paths) {
  if (RESERVED.includes(p.slice(1).toLowerCase())) {
    console.error(`FAIL  ${p} shadows an app route (${RESERVED.join(', ')})`); fail++;
  }
}

if (!src.includes('// demo-forge audience:add appends here')) {
  console.error('FAIL  the audience:add anchor comment was removed. `demo-forge audience` can no longer register a route.');
  fail++;
}

console.log(fail ? `AUDIENCES FAIL - ${fail} problem(s)` : `AUDIENCES PASS - ${paths.length} audiences, ${all.length} URLs answered`);
process.exit(fail ? 1 : 0);
