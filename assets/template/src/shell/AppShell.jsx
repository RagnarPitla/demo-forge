/* The application shell: header, navigation rail, content well.
 *
 * Every link routes through `scopedHref` so a visitor inside an audience
 * sub-site stays inside it. That is the containment guarantee in src/demo/scope.js,
 * and it is enforced here rather than left to each screen to remember.
 */

import React from 'react';
import { SectionLabel } from './primitives.jsx';
import { scopedPath, activeScope } from '../demo/scope.js';
import { APP } from '../data/seed.js';

const RAIL_WIDTH = 216;

export default function AppShell({ nav, route, onNavigate, children }) {
  const scope = activeScope();
  const go = path => e => {
    e.preventDefault();
    onNavigate(scopedPath(path));
  };

  const groups = nav.reduce((acc, item) => {
    const g = item.group || 'Menu';
    (acc[g] = acc[g] || []).push(item);
    return acc;
  }, {});

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--color-bg)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base, 13px)',
        color: 'var(--color-text-secondary)'
      }}
    >
      <nav
        aria-label="Primary"
        style={{
          width: RAIL_WIDTH,
          flexShrink: 0,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          padding: '16px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto'
        }}
      >
        <a
          href={`#${scopedPath('/')}`}
          onClick={go('/')}
          data-testid="shell-home"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '2px 6px 0',
            textDecoration: 'none',
            color: 'var(--color-text)'
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 'var(--radius-sm, 6px)',
              background: 'var(--color-accent)',
              color: 'var(--color-accent-fg, #fff)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0
            }}
          >
            {(APP.name || 'A').slice(0, 1).toUpperCase()}
          </span>
          <span style={{ fontWeight: 'var(--weight-semibold, 600)', fontSize: 'var(--text-md, 14px)' }}>
            {APP.name}
          </span>
        </a>

        {Object.entries(groups).map(([group, items]) => (
          <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <SectionLabel style={{ padding: '0 8px 6px' }}>{group}</SectionLabel>
            {items.map(item => {
              const isActive = route === item.path || (item.path !== '/' && route.startsWith(item.path));
              return (
                <a
                  key={item.path}
                  href={`#${scopedPath(item.path)}`}
                  onClick={go(item.path)}
                  data-testid={item.testid || `nav-${item.path.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home'}`}
                  aria-current={isActive ? 'page' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 8px',
                    borderRadius: 'var(--radius-md, 8px)',
                    textDecoration: 'none',
                    fontSize: 'var(--text-base, 13px)',
                    fontWeight: isActive ? 'var(--weight-semibold, 600)' : 400,
                    color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    background: isActive ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent'
                  }}
                >
                  {item.label}
                </a>
              );
            })}
          </div>
        ))}

        <div style={{ marginTop: 'auto' }}>
          <SectionLabel style={{ padding: '0 8px 6px' }}>Demo</SectionLabel>
          <div style={{ padding: '0 8px', fontSize: 'var(--text-xs, 11px)', color: 'var(--color-text-tertiary)' }}>
            {scope ? scope.entry.label : 'Standard'}
          </div>
        </div>
      </nav>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            height: 48,
            flexShrink: 0,
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            gap: 12,
            position: 'sticky',
            top: 0,
            zIndex: 10
          }}
        >
          <span style={{ fontSize: 'var(--text-md, 14px)', fontWeight: 'var(--weight-semibold, 600)', color: 'var(--color-text)' }}>
            {APP.title}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs, 11px)', color: 'var(--color-text-tertiary)' }}>
            Demonstration only. No live data.
          </span>
        </header>

        <main style={{ flex: 1, padding: '24px 28px 56px', minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}
