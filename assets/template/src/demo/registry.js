/* AUDIENCE REGISTRY
 *
 * One entry per audience. This is the only place an audience is defined, and it
 * drives the routes, the address-bar scoping, the narrated overlay and the
 * seeded data. Adding an audience must never mean editing the app in five
 * places and hoping they stay in step.
 *
 * The rule this file exists to enforce:
 *
 *     A merge ADDS a URL. A merge never REPLACES the front door.
 *
 * Merging a workstream adds `/#/Finance-guide`. It does not change what a
 * visitor sees at the root. If a change would alter the front door, that is a
 * separate, deliberate decision - not a side effect of shipping a walkthrough.
 *
 * Fields
 *   path     canonical route. Letters, digits and hyphens. Becomes a URL, so
 *            keep it boring.
 *   label    what a human calls this audience.
 *   status   'ready'       - has a storyline, safe to send to a customer
 *            'coming-soon' - routable placeholder, renders the default entry
 *   guided   true runs the narrated walkthrough for THIS audience only
 *   aliases  URLs already shared with someone. Kept alive forever so a rename
 *            never breaks a link that is sitting in an email.
 *   seed     optional seeded record id to select on entry
 *   script   optional narration module id, resolved in scripts/index.js
 */

export const audiences = [
  {
    path: '/guide',
    label: 'Guided walkthrough',
    status: 'ready',
    guided: true,
    aliases: ['/guided-demo', '/demo-guide'],
    script: 'default'
  }
  // demo-forge audience:add appends here
];

/** Every URL an entry answers to. The canonical path is what we narrate and
 *  publish; the aliases are history we refuse to break. */
export const pathsFor = entry => [entry.path, ...(entry.aliases || [])];

/** Case-insensitive lookup that preserves the casing the visitor used. Someone
 *  sent `/#/SCM-demo` stays on `/#/SCM-demo`, because the link they were given
 *  is the link that has to keep working. */
export function matchAudience(hashPath) {
  const raw = String(hashPath || '').replace(/^#/, '') || '/';
  const lower = raw.toLowerCase();
  for (const entry of audiences) {
    for (const p of pathsFor(entry)) {
      const pl = p.toLowerCase();
      if (lower === pl || lower.startsWith(`${pl}/`) || lower.startsWith(`${pl}?`)) {
        return { entry, matchedPath: raw.slice(0, p.length), rest: raw.slice(p.length) || '/' };
      }
    }
  }
  return null;
}

export const readyAudiences = () => audiences.filter(a => a.status === 'ready');

export default audiences;
