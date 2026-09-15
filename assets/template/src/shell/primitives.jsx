/* The primitive kit.
 *
 * Reconstructed routes compose these rather than emitting raw divs, so a token
 * change lands everywhere at once and a generated screen is readable by a human
 * who has to edit it later. Every primitive styles itself from the extracted
 * token file - there are no hard-coded colours below this line.
 */

import React from 'react';

export const SectionLabel = ({ children, style }) => (
  <div
    style={{
      fontFamily: 'var(--font-mono)',
      fontWeight: 'var(--weight-bold, 700)',
      fontSize: 'var(--text-2xs, 10px)',
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      color: 'var(--color-text-tertiary)',
      ...style
    }}
  >
    {children}
  </div>
);

export const Card = ({ children, padding = 16, style, ...rest }) => (
  <div
    style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-xl, 12px)',
      boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(17,24,39,.08))',
      padding,
      ...style
    }}
    {...rest}
  >
    {children}
  </div>
);

export const Button = ({ children, variant = 'secondary', ...rest }) => {
  const base = {
    padding: '7px 13px',
    borderRadius: 'var(--radius-md, 8px)',
    fontSize: 'var(--text-xs, 11px)',
    fontWeight: 'var(--weight-bold, 700)',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    lineHeight: 1.4
  };
  const variants = {
    primary: {
      background: 'var(--color-accent)',
      color: 'var(--color-accent-fg, #fff)',
      border: '1px solid var(--color-accent)'
    },
    secondary: {
      background: 'var(--color-surface)',
      color: 'var(--color-accent)',
      border: '1px solid var(--color-border)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      border: '1px solid transparent'
    }
  };
  return (
    <button type="button" style={{ ...base, ...variants[variant] }} {...rest}>
      {children}
    </button>
  );
};

export const Pill = ({ children, tone = 'neutral' }) => {
  const tones = {
    neutral: ['var(--color-surface-sunken, #f3f4f6)', 'var(--color-text-secondary)'],
    success: ['color-mix(in srgb, var(--color-success, #22c55e) 16%, transparent)', 'var(--color-text)'],
    warning: ['color-mix(in srgb, var(--color-warning, #eab308) 18%, transparent)', 'var(--color-text)'],
    danger: ['color-mix(in srgb, var(--color-danger, #ef4444) 14%, transparent)', 'var(--color-text)'],
    accent: ['color-mix(in srgb, var(--color-accent) 12%, transparent)', 'var(--color-accent)']
  };
  const [bg, fg] = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 'var(--radius-pill, 999px)',
        background: bg,
        color: fg,
        fontSize: 'var(--text-sm, 12px)',
        fontWeight: 'var(--weight-semibold, 600)'
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: tone === 'neutral' ? 'var(--color-text-tertiary)' : `var(--color-${tone}, var(--color-accent))`
        }}
      />
      {children}
    </span>
  );
};

export const StatTile = ({ value, caption }) => (
  <Card padding={16}>
    <div
      style={{
        color: 'var(--color-accent)',
        fontSize: 'var(--text-4xl, 28px)',
        fontWeight: 'var(--weight-bold, 700)',
        lineHeight: 1.1
      }}
    >
      {value}
    </div>
    <SectionLabel style={{ marginTop: 8 }}>{caption}</SectionLabel>
  </Card>
);

export const PageHeader = ({ title, subtitle, actions }) => (
  <header
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      marginBottom: 20
    }}
  >
    <div>
      <h1
        style={{
          margin: 0,
          fontSize: 'var(--text-4xl, 28px)',
          fontWeight: 'var(--weight-bold, 700)',
          color: 'var(--color-text)',
          letterSpacing: '-.01em'
        }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 'var(--text-base, 13px)',
            color: 'var(--color-text-secondary)',
            maxWidth: '70ch'
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
    {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
  </header>
);

export const Grid = ({ children, min = 220, gap = 12, style }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
      gap,
      ...style
    }}
  >
    {children}
  </div>
);

export const DataTable = ({ headers = [], rows = [], testid }) => (
  <Card padding={0} data-testid={testid} style={{ overflow: 'hidden' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs, 11px)' }}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={i}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                borderBottom: '1px solid var(--color-border)',
                background: 'var(--color-surface-sunken, #f9fafb)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-2xs, 10px)',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'var(--color-text-tertiary)',
                fontWeight: 700
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td
                key={c}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--color-border)',
                  color: c === 0 ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  fontWeight: c === 0 ? 'var(--weight-semibold, 600)' : 400
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
);

export const Empty = ({ title, body }) => (
  <Card padding={32} style={{ textAlign: 'center' }}>
    <SectionLabel>Not reconstructed yet</SectionLabel>
    <h2 style={{ margin: '10px 0 6px', fontSize: 'var(--text-xl, 18px)', color: 'var(--color-text)' }}>{title}</h2>
    <p style={{ margin: 0, fontSize: 'var(--text-base, 13px)', color: 'var(--color-text-secondary)' }}>{body}</p>
  </Card>
);
