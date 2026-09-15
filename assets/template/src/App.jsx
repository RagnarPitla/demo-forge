import React, { useEffect, useState, useCallback, useRef } from 'react';
import AppShell from './shell/AppShell.jsx';
import { Empty } from './shell/primitives.jsx';
import { routes, nav } from './routes/index.jsx';
import { matchAudience, audiences } from './demo/registry.js';
import { resolveScope, installScopeGuard, unscopedPath, scopedPath } from './demo/scope.js';
import { startGuide } from './demo/guide.js';
import { scriptFor } from './demo/scripts/index.js';

const currentPath = () => (window.location.hash || '#/').replace(/^#/, '') || '/';

function AudienceLanding({ entry }) {
  return (
    <Empty
      title={entry.label}
      body={`This audience is registered and shareable, but its storyline has not landed yet. It is routable on purpose: the URL can be sent now and filled in later.`}
    />
  );
}

export default function App() {
  const [path, setPath] = useState(currentPath);
  const stopGuideRef = useRef(null);

  useEffect(() => {
    resolveScope();
    const removeGuard = installScopeGuard();
    const onHash = () => {
      resolveScope();
      setPath(currentPath());
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      removeGuard();
    };
  }, []);

  const navigate = useCallback(next => {
    const target = scopedPath(next);
    if (`#${target}` === window.location.hash) return;
    window.location.hash = target;
  }, []);

  const match = matchAudience(path);
  const entry = match?.entry || null;
  const innerPath = entry ? unscopedPath(path) : path;

  // The narrated walkthrough runs for a guided audience only, and it is torn
  // down when the audience changes. Leaving a previous audience's overlay
  // mounted is how a demo ends up narrating the wrong story.
  useEffect(() => {
    if (stopGuideRef.current) {
      stopGuideRef.current();
      stopGuideRef.current = null;
    }
    if (!entry?.guided) return undefined;
    const steps = scriptFor(entry.script || 'default');
    if (!steps?.length) return undefined;
    const id = window.setTimeout(() => {
      stopGuideRef.current = startGuide(steps, {
        label: entry.label,
        storageKey: `guide:${entry.path}`
      });
    }, 500);
    return () => {
      window.clearTimeout(id);
      if (stopGuideRef.current) {
        stopGuideRef.current();
        stopGuideRef.current = null;
      }
    };
  }, [entry?.path, entry?.guided, entry?.script, entry?.label]);

  const normalised = innerPath === '' ? '/' : innerPath;
  const route =
    routes.find(r => r.path === normalised) ||
    // Inside an audience, scopedPath('/') deliberately gives the sub-site home
    // a URL of its own - `<prefix>/home` - so that pressing Home is a real
    // navigation instead of a no-op back to the bare prefix. Nothing registers
    // `/home`, so it has to be inverted here or every guided audience opens on
    // "No such screen". The exact match above runs first, so a captured screen
    // that genuinely claimed /home still wins.
    (normalised === '/home' ? routes.find(r => r.path === '/') : null) ||
    routes.find(r => r.path !== '/' && normalised.startsWith(`${r.path}/`)) ||
    null;

  let content;
  if (entry && entry.status !== 'ready' && normalised === '/') content = <AudienceLanding entry={entry} />;
  else if (route) content = <route.Component navigate={navigate} audience={entry} />;
  else
    content = (
      <Empty
        title="No such screen"
        body={`Nothing is registered at ${normalised}. Registered screens: ${routes.map(r => r.path).join(', ')}.`}
      />
    );

  return (
    <AppShell nav={nav} route={normalised} onNavigate={navigate}>
      {content}
    </AppShell>
  );
}

export { audiences };
