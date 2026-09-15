/* Sub-site containment.
 *
 * THE GUARANTEE: a visitor sent to an audience URL stays in that audience.
 *
 * Pressing Home or New Project inside `/#/SAP-vision-demo` lands on
 * `/#/SAP-vision-demo/new`. It must not drop them on the shared front door.
 *
 * This is not a nicety. These links go to different audiences. A customer
 * looking at the SAP walkthrough should never land on the generic front door -
 * or worse, on another customer's story - because they pressed Home.
 *
 * How it works: the router is in-memory, so navigation does not touch
 * window.location on its own. This module mirrors the whole route table beneath
 * each audience prefix and re-homes any main-site route onto the active
 * sub-site. Casing and aliases both survive, because `matchAudience` returns
 * the prefix exactly as the visitor typed it.
 */

import { matchAudience } from './registry.js';

let active = null;

/** Resolve which audience owns the current URL. Call once on boot and again on
 *  every hashchange. */
export function resolveScope(hash = window.location.hash) {
  const match = matchAudience(hash);
  active = match ? { prefix: match.matchedPath, entry: match.entry } : null;
  return active;
}

export const activeScope = () => active;
export const scopePrefix = () => active?.prefix || '';

/** Rewrite an app-internal path so it stays inside the active sub-site.
 *  Outside a sub-site this is the identity function. */
export function scopedPath(path) {
  const clean = `/${String(path || '/').replace(/^#?\/?/, '')}`;
  if (!active) return clean;
  if (clean.toLowerCase().startsWith(active.prefix.toLowerCase())) return clean;
  return `${active.prefix}${clean === '/' ? '/home' : clean}`;
}

export const scopedHref = path => `#${scopedPath(path)}`;

/** Strip the audience prefix off, to get the route the app should render. */
export function unscopedPath(path) {
  const clean = `/${String(path || '/').replace(/^#?\/?/, '')}`;
  if (!active) return clean;
  const p = active.prefix.toLowerCase();
  if (clean.toLowerCase() === p) return '/';
  if (clean.toLowerCase().startsWith(`${p}/`)) return clean.slice(active.prefix.length) || '/';
  return clean;
}

/** Install the guard. Any hash change that escapes the sub-site is rewritten
 *  back inside it before the router ever sees it. */
export function installScopeGuard() {
  resolveScope();
  if (!active) return () => {};
  const onHashChange = () => {
    const hash = window.location.hash || '#/';
    const path = hash.replace(/^#/, '') || '/';
    if (path.toLowerCase().startsWith(active.prefix.toLowerCase())) return;
    // Escaped. Re-home rather than block, so the interaction still feels like
    // it worked - it just worked inside the sub-site.
    window.location.replace(`#${scopedPath(path)}`);
  };
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}

export default { resolveScope, activeScope, scopePrefix, scopedPath, scopedHref, unscopedPath, installScopeGuard };
