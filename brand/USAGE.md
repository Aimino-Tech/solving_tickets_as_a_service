# SYNTARO Brand Usage Guidelines

## Logo Overview

The SYNTARO brand uses the **"Checkmark Hero"** concept — a ticket icon that morphs into a checkmark through negative space. The design communicates the core value proposition: turning tickets (issues) into solutions (PRs).

## Logo Variants

| File | Use Case |
|---|---|
| `logo-primary.svg` | Website header, docs, app nav, marketing materials |
| `logo-dark.svg` | Dark backgrounds (hero sections, dark mode UIs) |
| `logo-monochrome.svg` | Grayscale/print, favicon fallback, single-color contexts |
| `logo-icon.svg` | Standalone icon (no wordmark) — app nav, badges, social avatars |
| `favicon.svg` | Browser tab icon, 16×16–32×32 contexts |

## Color Palette

| Token | Hex | Usage |
|---|---|---|
| Brand Primary | `#6366f1` | Logo mark, primary CTAs, links |
| Brand Dark | `#4f46e5` | Gradient end, hover states |
| Success/Checkmark | `#22c55e` | Checkmark stroke, positive indicators |
| Text (light bg) | `#374151` | Wordmark on light backgrounds |
| Text (dark bg) | `#818cf8` | Wordmark on dark backgrounds |

## Clear Space

Minimum clear space around the logo: **24px** (or 0.5× the logo height). No other elements should intrude into this space.

## Minimum Size

- **Full lockup (icon + wordmark):** 120px wide
- **Icon only:** 24px (app nav), 32px (favicon)
- **Wordmark only:** 60px wide

## Incorrect Usage

- Do not recolor the checkmark — always use the green (#22c55e) shade
- Do not stretch or distort the logo
- Do not apply drop shadows or 3D effects
- Do not place on low-contrast backgrounds
- Do not rotation or flip the logo
- Do not replace the wordmark font with a different typeface
- Do not add outlines or strokes to the wordmark

## Dark Mode

On dark backgrounds, always use `logo-dark.svg`. The primary variant is optimized for light/white backgrounds. The monochrome variant works on both but loses the brand color identity.

## File Format

SVG is the primary format. For raster fallback contexts:
- **PNG** at 2× resolution for Retina displays
- **ICO** for legacy favicon support (convert from `favicon.svg`)

## Brand Lockup

The SYNTARO wordmark uses system font stack: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` with 800 weight and 4px letter-spacing. The tagline "SOLVING TICKETS AS A SERVICE" uses 400 weight with 6px letter-spacing.
