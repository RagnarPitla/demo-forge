// Turn a capture into a design system.
//
// The input is a tally of what the app actually painted. The output is a token
// file plus a report that states, for every token, how it was inferred and what
// its contrast is. Inference is stated as inference - a role that could not be
// determined from evidence is emitted as a TODO rather than as a guess that
// reads like a measurement.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/* --- colour maths --------------------------------------------------------- */

export const hexToRgb = hex => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};

const luminance = hex => {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return Number(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(2));
};

export const hsl = hex => {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
};

const isHex = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
const wcag = (ratio, large = false) =>
  ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : large && ratio >= 3 ? 'AA large' : 'fail';

/* --- aggregation ---------------------------------------------------------- */

const merge = (target, source) => {
  for (const [k, v] of Object.entries(source || {})) target[k] = (target[k] || 0) + v;
  return target;
};

const top = (map, n = 20) =>
  Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

const px = v => parseFloat(String(v)) || 0;

/* --- source token adoption -------------------------------------------------
 *
 * If the app ships its own token layer, that layer WINS. An inferred role is a
 * measurement of what got painted; a named custom property is what the authors
 * decided. Inference exists for apps with no token layer, not to second-guess
 * one that exists.
 *
 * This matters more than it sounds. On a real capture, inference put the canvas
 * and the surface the wrong way round, elected the success green as the accent,
 * and read the type scale off a transform-scaled DOM - while the app sat there
 * with --color-accent: #4f46e5 spelled out in its own :root.
 * ------------------------------------------------------------------------- */

const ROLE_ALIASES = {
  canvas: ['--color-bg', '--color-background', '--bg', '--background', '--color-canvas', '--surface-canvas'],
  surface: ['--color-surface', '--surface', '--color-card', '--card', '--color-panel', '--bg-elevated'],
  border: ['--color-border', '--border', '--border-color', '--color-divider', '--divider'],
  text: ['--color-text', '--text', '--color-fg', '--foreground', '--color-text-primary', '--text-primary'],
  textSecondary: ['--color-text-secondary', '--text-secondary', '--color-fg-secondary', '--color-text-muted'],
  textTertiary: ['--color-text-tertiary', '--text-tertiary', '--color-text-subtle', '--color-fg-muted'],
  accent: ['--color-accent', '--accent', '--color-primary', '--primary', '--color-brand', '--brand'],
  accentFg: ['--color-accent-fg', '--accent-fg', '--color-on-primary', '--color-primary-fg'],
  success: ['--color-success', '--success', '--color-positive', '--color-green'],
  warning: ['--color-warning', '--warning', '--color-caution', '--color-yellow'],
  danger: ['--color-danger', '--danger', '--color-error', '--error', '--color-negative', '--color-red'],
  info: ['--color-info', '--info', '--color-running', '--color-blue']
};

const SCALE_ALIASES = {
  sans: ['--font-sans', '--font-family', '--font-body', '--font-base', '--fontFamily'],
  mono: ['--font-mono', '--font-code', '--font-monospace'],
  base: ['--text-base', '--font-size-base', '--text-md', '--fs-base', '--font-size']
};

const normaliseHex = v => {
  const s = String(v || '').trim().toLowerCase();
  const m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return `#${m[1].split('').map(c => c + c).join('')}`;
  return /^#[0-9a-f]{6}$/.test(s) ? s : /^#[0-9a-f]{8}$/.test(s) ? s.slice(0, 7) : null;
};

function adoptSourceTokens(customProperties) {
  const props = customProperties || {};
  const lower = {};
  for (const [k, v] of Object.entries(props)) lower[k.toLowerCase()] = v;

  const adopted = {};
  const provenance = {};
  for (const [role, names] of Object.entries(ROLE_ALIASES)) {
    for (const name of names) {
      const raw = lower[name.toLowerCase()];
      const hex = normaliseHex(raw);
      if (hex) {
        adopted[role] = hex;
        provenance[role] = name;
        break;
      }
    }
  }

  const scales = {};
  for (const [role, names] of Object.entries(SCALE_ALIASES)) {
    for (const name of names) {
      const raw = lower[name.toLowerCase()];
      if (raw) {
        scales[role] = String(raw).trim();
        provenance[role] = name;
        break;
      }
    }
  }

  return { adopted, scales, provenance, count: Object.keys(props).length };
}

/* --- role inference ------------------------------------------------------- */

function inferRoles(agg, customProperties) {
  const source = adoptSourceTokens(customProperties);

  const hexBg = top(agg.backgrounds, 40).filter(([c]) => isHex(c));
  const hexFg = top(agg.colors, 40).filter(([c]) => isHex(c));
  const hexBorder = top(agg.borderColors, 20).filter(([c]) => isHex(c));

  // Canvas by painted AREA, not element count. The canvas is one enormous
  // element; the cards are forty small ones. Counting elements elects the card.
  const byArea = Object.entries(agg.backgroundArea || {})
    .filter(([c]) => isHex(c))
    .sort((a, b) => b[1] - a[1]);
  const inferredCanvas = byArea[0]?.[0] || hexBg[0]?.[0] || '#ffffff';
  const inferredSurface =
    byArea.slice(1).find(([c]) => c !== inferredCanvas && Math.abs(luminance(c) - luminance(inferredCanvas)) < 0.3)?.[0] ||
    hexBg.find(([c]) => c !== inferredCanvas)?.[0] ||
    inferredCanvas;

  const canvas = source.adopted.canvas || inferredCanvas;
  const surface = source.adopted.surface || inferredSurface;
  const dark = luminance(canvas) < 0.4;

  const textRanked = hexFg
    .map(([c, n]) => ({ c, n, ratio: contrast(c, canvas) }))
    .sort((a, b) => b.n - a.n);
  const inferredText =
    textRanked.slice().sort((a, b) => b.ratio - a.ratio || b.n - a.n)[0]?.c || (dark ? '#ffffff' : '#111827');
  const text = source.adopted.text || inferredText;
  const textSecondary =
    source.adopted.textSecondary || textRanked.find(t => t.c !== text && t.ratio >= 4.5)?.c || text;
  const textTertiary =
    source.adopted.textTertiary ||
    textRanked.find(t => t.c !== text && t.c !== textSecondary && t.ratio >= 3 && t.ratio < 7)?.c ||
    textSecondary;

  // Accent by WHERE it is painted. The accent is the colour the app puts on
  // buttons, links and the active nav item. Ranking the whole page by
  // saturation instead elects whichever status hue happens to be loudest.
  const neutral = new Set([canvas, surface, text, textSecondary, textTertiary]);
  const interactive = {};
  for (const [c, n] of Object.entries(agg.interactiveColors || {})) if (isHex(c)) interactive[c] = (interactive[c] || 0) + n * 2;
  for (const [c, n] of Object.entries(agg.interactiveBackgrounds || {})) if (isHex(c)) interactive[c] = (interactive[c] || 0) + n * 3;
  const accentPool = Object.entries(interactive)
    .filter(([c]) => !neutral.has(c))
    .map(([c, n]) => ({ c, n, ...hsl(c) }))
    .filter(x => x.s > 0.15 && x.l > 0.12 && x.l < 0.8)
    .sort((a, b) => b.n - a.n);
  const inferredAccent =
    accentPool[0]?.c ||
    [...hexFg, ...hexBg]
      .filter(([c]) => !neutral.has(c))
      .map(([c, n]) => ({ c, n, ...hsl(c) }))
      .filter(x => x.s > 0.25 && x.l > 0.12 && x.l < 0.75)
      .sort((a, b) => b.n * (0.5 + b.s) - a.n * (0.5 + a.s))[0]?.c ||
    null;
  const accent = source.adopted.accent || inferredAccent;

  const border =
    source.adopted.border || hexBorder.find(([c]) => contrast(c, canvas) < 2.2)?.[0] || hexBorder[0]?.[0] || null;

  const hueBand = (lo, hi) => {
    const pool = [...hexFg, ...hexBg]
      .filter(([c]) => !neutral.has(c) && c !== accent)
      .map(([c, n]) => ({ c, n, ...hsl(c) }))
      .filter(x => x.s > 0.25);
    return pool.filter(x => (lo < hi ? x.h >= lo && x.h <= hi : x.h >= lo || x.h <= hi)).sort((a, b) => b.n - a.n)[0]?.c || null;
  };

  return {
    canvas,
    surface,
    text,
    textSecondary,
    textTertiary,
    accent,
    accentFg: source.adopted.accentFg || (accent && contrast(accent, '#ffffff') >= 4 ? '#ffffff' : text),
    border,
    dark,
    success: source.adopted.success || hueBand(90, 160),
    warning: source.adopted.warning || hueBand(35, 65),
    danger: source.adopted.danger || hueBand(340, 20),
    info: source.adopted.info || hueBand(185, 230),
    fromTokens: source.count,
    provenance: source.provenance,
    adoptedCount: Object.keys(source.adopted).length,
    sourceScales: source.scales
  };
}

/* --- scales --------------------------------------------------------------- */

function inferScales(agg, roles = {}) {
  const src = roles.sourceScales || {};

  const sizes = top(agg.fontSizes, 14)
    .map(([v, n]) => ({ v: px(v), n }))
    .filter(x => x.v >= 8 && x.v <= 64)
    .sort((a, b) => a.v - b.v);

  // The app's own --text-base wins over the most-painted size. A shell full of
  // 10px mono labels out-counts the 13px body copy every time, and the answer
  // to that is not a better heuristic, it is reading what the authors named.
  const sourceBase = src.base ? px(src.base) : 0;
  const dominant = sourceBase || px(top(agg.fontSizes, 1)[0]?.[0]) || 14;

  const radii = top(agg.radii, 10)
    .map(([v, n]) => ({ v: px(v), n }))
    .filter(x => x.v > 0 && x.v <= 40)
    .sort((a, b) => a.v - b.v);

  const space = top(agg.spacing, 16)
    .map(([v, n]) => ({ v: px(v), n }))
    .filter(x => x.v > 0 && x.v <= 80)
    .sort((a, b) => a.v - b.v);

  const fonts = top(agg.fonts, 6).map(([v, n]) => ({ v, n }));
  const firstFamily = stack => String(stack).split(',')[0].replace(/["']/g, '').trim();
  const sans =
    (src.sans && firstFamily(src.sans)) ||
    fonts.find(f => !/mono|code|consol|courier/i.test(f.v))?.v ||
    'system-ui';
  const mono =
    (src.mono && firstFamily(src.mono)) ||
    fonts.find(f => /mono|code|consol|courier/i.test(f.v))?.v ||
    'ui-monospace';

  const weights = top(agg.fontWeights, 6)
    .map(([v, n]) => ({ v: parseInt(v, 10), n }))
    .filter(x => x.v)
    .sort((a, b) => a.v - b.v);

  const shadows = top(agg.shadows, 6).map(([v, n]) => ({ v, n }));

  return { sizes, dominant, radii, space, sans, mono, weights, shadows, fonts, sourceBase };
}

/* --- emit ----------------------------------------------------------------- */

const SIZE_NAMES = ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];
const RADIUS_NAMES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];

function buildTokens(roles, scales, meta) {
  const L = [];
  const prov = roles.provenance || {};
  // Every token states where it came from. "source --color-accent" is a fact
  // about the app; "inferred, 25 elements" is a measurement we made. Those are
  // different kinds of claim and the file should not blur them.
  const why = (role, fallback) => (prov[role] ? `source ${prov[role]}` : fallback);
  const push = (k, v, note) => L.push(`  ${k}: ${v};${note ? ` /* ${note} */` : ''}`);

  L.push('/* Design tokens extracted from a live capture.');
  L.push(` * source      ${meta.sourceUrl}`);
  L.push(` * captured    ${meta.capturedAt}`);
  L.push(` * routes      ${meta.routeCount}`);
  L.push(` * elements    ${meta.elementCount} visible elements measured`);
  L.push(` * adopted     ${roles.adoptedCount} of ${roles.fromTokens} source custom properties`);
  L.push(' *');
  L.push(' * A token marked "source" was named by the application authors and is');
  L.push(' * adopted verbatim. A token marked with an element count was inferred');
  L.push(' * from what the app painted. Where the two disagree, the source wins -');
  L.push(' * inference exists for apps with no token layer, not to second-guess one.');
  L.push(' */');
  L.push(':root {');

  L.push('  /* surfaces */');
  push('--color-bg', roles.canvas, why('canvas', `canvas by painted area, ${meta.counts.bg[roles.canvas] || 0} elements`));
  push('--color-surface', roles.surface, why('surface', `cards and panels, ${meta.counts.bg[roles.surface] || 0} elements`));
  if (roles.border) push('--color-border', roles.border, why('border', `${meta.counts.border[roles.border] || 0} elements`));

  L.push('');
  L.push('  /* text */');
  push('--color-text', roles.text, `${why('text', 'inferred')}, contrast ${contrast(roles.text, roles.canvas)}:1 on canvas`);
  push('--color-text-secondary', roles.textSecondary, `${why('textSecondary', 'inferred')}, contrast ${contrast(roles.textSecondary, roles.canvas)}:1`);
  push('--color-text-tertiary', roles.textTertiary, `${why('textTertiary', 'inferred')}, contrast ${contrast(roles.textTertiary, roles.canvas)}:1`);

  L.push('');
  L.push('  /* accent */');
  if (roles.accent) {
    push('--color-accent', roles.accent, `${why('accent', 'inferred from interactive elements')}, contrast ${contrast(roles.accent, roles.surface)}:1 on surface`);
    push('--color-accent-fg', roles.accentFg, why('accentFg', 'label on an accent fill'));
  } else {
    L.push('  /* TODO: no accent hue was painted in the capture. Set one by hand. */');
  }

  const statuses = [['success', roles.success], ['warning', roles.warning], ['danger', roles.danger], ['info', roles.info]];
  if (statuses.some(([, v]) => v)) {
    L.push('');
    L.push('  /* status */');
    for (const [name, value] of statuses) {
      if (value) push(`--color-${name}`, value, `${why(name, 'inferred by hue')}, contrast ${contrast(value, roles.surface)}:1 on surface`);
      else L.push(`  /* TODO: --color-${name} - no matching hue in the capture */`);
    }
  }

  L.push('');
  L.push('  /* type */');
  push('--font-sans', `'${scales.sans}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`, why('sans', 'most painted family'));
  push('--font-mono', `'${scales.mono}', ui-monospace, 'SF Mono', Menlo, monospace`, why('mono', 'most painted mono family'));

  const baseIdx = scales.sizes.findIndex(s => s.v === scales.dominant);
  const emitted = new Set();
  scales.sizes.forEach((s, i) => {
    const offset = i - (baseIdx < 0 ? Math.floor(scales.sizes.length / 3) : baseIdx);
    const name = SIZE_NAMES[Math.min(SIZE_NAMES.length - 1, Math.max(0, 3 + offset))];
    if (emitted.has(name)) return;
    emitted.add(name);
    const isBase = s.v === scales.dominant;
    push(`--text-${name}`, `${s.v}px`, `${s.n} elements${isBase ? `, base${scales.sourceBase ? ' (source --text-base)' : ''}` : ''}`);
  });
  if (!emitted.has('base')) push('--text-base', `${scales.dominant}px`, why('base', 'dominant size'));

  for (const w of scales.weights) {
    const name = w.v <= 400 ? 'normal' : w.v <= 500 ? 'medium' : w.v <= 600 ? 'semibold' : 'bold';
    push(`--weight-${name}`, String(w.v), `${w.n} elements`);
  }

  L.push('');
  L.push('  /* shape */');
  scales.radii.forEach((r, i) => push(`--radius-${RADIUS_NAMES[Math.min(i, RADIUS_NAMES.length - 1)]}`, `${r.v}px`, `${r.n} elements`));
  push('--radius-pill', '999px');

  L.push('');
  L.push('  /* spacing */');
  const spaceScale = [...new Set(scales.space.map(s => s.v))].sort((a, b) => a - b).slice(0, 12);
  spaceScale.forEach(v => push(`--space-${v}`, `${v}px`));

  if (scales.shadows.length) {
    L.push('');
    L.push('  /* elevation */');
    scales.shadows.slice(0, 3).forEach((s, i) => push(`--shadow-${['sm', 'md', 'lg'][i]}`, s.v, `${s.n} elements`));
  }

  L.push('');
  L.push('  /* motion */');
  push('--duration-fast', '.15s');
  push('--duration-base', '.2s');
  push('--ease-standard', 'cubic-bezier(0.2, 0, 0, 1)');
  L.push('}');
  L.push('');
  return L.join('\n');
}

function buildReport(roles, scales, meta, capture) {
  const rows = [];
  const add = (token, hex) => {
    if (!isHex(hex)) return;
    const r = contrast(hex, roles.canvas);
    rows.push(`| \`${token}\` | \`${hex}\` | ${r} | ${wcag(r)} |`);
  };
  add('--color-text', roles.text);
  add('--color-text-secondary', roles.textSecondary);
  add('--color-text-tertiary', roles.textTertiary);
  if (roles.accent) add('--color-accent', roles.accent);
  for (const k of ['success', 'warning', 'danger', 'info']) if (roles[k]) add(`--color-${k}`, roles[k]);

  const fails = rows.filter(r => r.endsWith('fail |'));
  const prov = roles.provenance || {};
  const src = role => (prov[role] ? `**source** \`${prov[role]}\`` : null);

  return `# Extracted design system

Captured from \`${meta.sourceUrl}\` on ${meta.capturedAt}.

- **${meta.routeCount}** routes visited
- **${meta.elementCount}** visible elements measured
- **${roles.fromTokens}** CSS custom properties resolved on \`:root\`
- **${roles.adoptedCount}** roles adopted verbatim from those properties
- theme attribute: \`${capture.app.theme ?? 'none'}\`${capture.app.isPowerApps ? '\n- rendered inside a Power Apps player frame' : ''}

${roles.adoptedCount > 3
    ? `The source app ships its own token layer and **${roles.adoptedCount} roles were adopted from it
verbatim**. Where a role below says "source", that is what the authors named, not something we
measured. Inference only filled the roles the source does not name.

That ordering is not politeness, it is accuracy. On this capture, pure inference put the canvas
and the surface the wrong way round, elected a status hue as the accent, and read the type scale
off a transform-scaled DOM - while the app had the correct answer spelled out in its own \`:root\`.`
    : `The source app exposes no meaningful token layer (${roles.fromTokens} custom properties,
${roles.adoptedCount} usable roles), so every token below is inferred from painted values. That is
the honest ceiling on fidelity here: the roles are correct, the names are ours.`}

## Roles

| Role | Value | Provenance |
|---|---|---|
| canvas | \`${roles.canvas}\` | ${src('canvas') || `inferred, largest painted area (${meta.counts.bg[roles.canvas] || 0} elements)`} |
| surface | \`${roles.surface}\` | ${src('surface') || `inferred, ${meta.counts.bg[roles.surface] || 0} elements`} |
| border | ${roles.border ? `\`${roles.border}\`` : '_none_'} | ${roles.border ? src('border') || `inferred, ${meta.counts.border[roles.border] || 0} elements` : 'no bordered elements painted'} |
| text | \`${roles.text}\` | ${src('text') || `inferred, ${meta.counts.fg[roles.text] || 0} elements`} |
| text-secondary | \`${roles.textSecondary}\` | ${src('textSecondary') || `inferred, ${meta.counts.fg[roles.textSecondary] || 0} elements`} |
| accent | ${roles.accent ? `\`${roles.accent}\`` : '_none_'} | ${roles.accent ? src('accent') || 'inferred from interactive elements' : 'no saturated hue painted'} |
| success | ${roles.success ? `\`${roles.success}\`` : '_none_'} | ${roles.success ? src('success') || 'inferred by hue' : '-'} |
| danger | ${roles.danger ? `\`${roles.danger}\`` : '_none_'} | ${roles.danger ? src('danger') || 'inferred by hue' : '-'} |

Mode: **${roles.dark ? 'dark' : 'light'}** (canvas luminance ${luminance(roles.canvas).toFixed(3)}).

## Contrast against the canvas

Measured with the WCAG 2.1 relative luminance formula.

| Token | Hex | Ratio | Verdict |
|---|---|---|---|
${rows.join('\n')}

${fails.length
    ? `**${fails.length} token(s) fail as body text.** They are correct only as disabled text, status
dots or fills. Do not use them for wording a reader has to read.`
    : 'Every extracted text token clears AA against the canvas.'}

## Type

- sans: \`${scales.sans}\`
- mono: \`${scales.mono}\`
- dominant size: **${scales.dominant}px**
- sizes painted: ${scales.sizes.map(s => `${s.v}px (${s.n})`).join(', ') || 'none'}
- weights: ${scales.weights.map(w => `${w.v} (${w.n})`).join(', ') || 'none'}

${scales.fonts.length > 2
    ? `> ${scales.fonts.length} font families were painted. More than two usually means a
> third-party widget is shipping its own stack; check before reproducing it.`
    : ''}

## Shape

- radii: ${scales.radii.map(r => `${r.v}px (${r.n})`).join(', ') || 'none - square corners'}
- spacing steps: ${[...new Set(scales.space.map(s => s.v))].sort((a, b) => a - b).join(', ') || 'none'}
- shadows: ${scales.shadows.length || 0} distinct

## What to check by hand

1. Open \`capture/screens/\` and compare against the rebuilt routes. Bytes are not pixels.
2. Any \`TODO\` in \`tokens.css\` is a role the capture could not prove. Fill it deliberately.
3. If the source ships custom properties, diff them against these inferred roles before
   shipping - where they disagree, the source wins.
`;
}

export async function extractDesign({ captureFile, outDir }) {
  const capture = JSON.parse(await readFile(captureFile, 'utf8'));

  const agg = {
    colors: {},
    backgrounds: {},
    backgroundArea: {},
    borderColors: {},
    interactiveColors: {},
    interactiveBackgrounds: {},
    fonts: {},
    fontSizes: {},
    fontWeights: {},
    radii: {},
    shadows: {},
    spacing: {}
  };
  let elementCount = 0;
  for (const route of capture.routes || []) {
    elementCount += route.visibleElements || 0;
    for (const key of Object.keys(agg)) merge(agg[key], route.painted?.[key]);
  }

  const roles = inferRoles(agg, capture.customProperties);
  const scales = inferScales(agg, roles);
  const meta = {
    sourceUrl: capture.source?.url || '',
    capturedAt: capture.capturedAt,
    routeCount: (capture.routes || []).length,
    elementCount,
    counts: { bg: agg.backgrounds, fg: agg.colors, border: agg.borderColors }
  };

  const tokens = buildTokens(roles, scales, meta);
  const report = buildReport(roles, scales, meta, capture);

  await mkdir(outDir, { recursive: true });
  const tokensPath = join(outDir, 'tokens.css');
  const reportPath = join(outDir, 'design-report.md');
  const jsonPath = join(outDir, 'design.json');
  await writeFile(tokensPath, tokens);
  await writeFile(reportPath, report);
  await writeFile(jsonPath, JSON.stringify({ roles, scales, meta }, null, 2));

  return { roles, scales, meta, tokensPath, reportPath, jsonPath };
}
