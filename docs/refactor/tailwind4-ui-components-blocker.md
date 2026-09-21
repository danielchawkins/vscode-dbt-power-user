# Tailwind 4 blocked on `@altimateai/ui-components`

Tailwind 4 cannot land in `webview_panels` until `@altimateai/ui-components` is replaced or republished for Tailwind 4 prefix semantics. A package-and-PostCSS swap builds, but webview UI loses almost all Tailwind utilities.

## Baseline (Tailwind 3.4)

With `tailwindcss@^3.4.19`, `vite@^8.3.0`, and `@altimateai/ui-components@^0.0.88`, `npm run build --prefix webview_panels` emits `webview_panels/dist/assets/main.css` with:

| Metric                                          | Value                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Bundle size                                     | 1,281,908 bytes                                                                  |
| Base `.al-*` selector tokens (regression floor) | ≥400 (see regression guard; excludes preflight and variant/compound tokens)      |
| Representative utilities (exact membership)     | `.al-flex`, `.al-items-center`, `.al-bg-background`, `.al-text-muted-foreground` |
| Scoped preflight anchor                         | `.al-tw-scope` (hand-written in `tailwind-globals.css`)                          |

Configuration: `webview_panels/tailwind.config.ts` uses `prefix: "al-"` and scans `./src/**/*.{ts,tsx}` plus `./node_modules/@altimateai/ui-components/dist/**/*.js`.

## Failed Tailwind 4 spike (2026-09-20)

Dependencies: `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`. PostCSS plugin only (no Vite plugin). CSS entry split so `@import` precedes other rules:

- `tailwind-globals.css` — scoped preflight and CSS variables (unchanged prose)
- `tailwind-utilities.css` — `@import "tailwindcss" prefix(al)`, `@config`, `@source` for owned sources and ui-components dist

### Build vs CSS output

Vite 8 build succeeded (`cssMinify: "esbuild"` unchanged). Output was not equivalent:

| Metric                                     | Tailwind 3        | Tailwind 4 spike                                              |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------- |
| Bundle size                                | 1,281,908 bytes   | 1,249,804 bytes                                               |
| Base `.al-*` selector tokens (guard count) | ≥400              | 0 (preflight anchor present; no guard-counted base utilities) |
| Variant-prefixed selectors (e.g. `.al\:*`) | present in bundle | not generated                                                 |

A green Vite build is not sufficient; base utility tokens did not reach the bundle.

### Root cause: v3 class prefix vs v4 variant prefix

Tailwind 3 `prefix: "al-"` produces HTML classes like `al-flex` and CSS selectors like `.al-flex`.

Tailwind 4 `prefix(al)` requires variant syntax (`al:flex`, `hover:al:bg-blue-800`) and emits selectors like `.al\:flex`. Prefix letters must be lowercase `a-z` only; the trailing hyphen from v3 is invalid.

`@altimateai/ui-components@0.0.88` bakes v3-style strings into published dist JS. Examples from `node_modules/@altimateai/ui-components/dist/2678.js`:

```javascript
className: "al-flex al-items-center al-justify-center"
className: yr("al-absolute al-top-0 al-flex al-items-center al-pointer-events-none")
```

Quoted v3-style utility strings in dist (reproduce with standard tools):

```bash
grep -Rho '"al-[a-zA-Z0-9_-]\+"' webview_panels/node_modules/@altimateai/ui-components/dist --include='*.js' | sort -u | wc -l
```

ui-components does not ship Tailwind utility CSS (`dist/lineage.css` uses CSS-module hashes, zero `.al-*` selectors). The extension must generate utilities at build time from those strings.

Tailwind 4 content detection does not treat v3 prefixed strings as utilities:

```css
@import "tailwindcss" prefix(al);
@source inline("al-flex al-items-center al-bg-background");
```

→ `@layer utilities;` with **no rules**.

v4 syntax works:

```css
@import "tailwindcss" prefix(al);
@source inline("al:flex al:items-center al:bg-background");
```

→ `.al\:flex`, `.al\:items-center`, … — which still do **not** match DOM classes `al-flex`, `al-items-center`.

Scanning `node_modules/@altimateai/ui-components/dist/**/*.js` with `@source` under `prefix(al)` yields theme variables (`--al-font-sans`, …) and base preflight, but an empty utilities layer.

## Required order

**`@altimateai/ui-components` replacement (booked with React 19) precedes Tailwind 4.** No supported in-repo workaround:

- Do not patch `node_modules`.
- Do not add a compatibility generator for v3 class strings.
- Do not declare success from build green alone.

## Regression guard

`scripts/workspace/check-webview-tailwind-css.sh` runs at the end of `npm run build` in `webview_panels/package.json` — the same path `vsce package` uses via `npm run build --prefix webview_panels`. It counts distinct base `.al-*` selector tokens as a broad regression floor: tokens containing `al-tw-scope`, whitespace (compound selectors), or `\:` (variant-prefixed classes such as `hover\:al-*`) are excluded. A separate check asserts the exact `.al-tw-scope` preflight anchor; four representative utilities are checked by exact membership. The Tailwind 4 spike passes preflight but reports **0** guard-counted base tokens.

## Revisit checklist

When ui-components is replaced or republished for Tailwind 4:

1. Upgrade `tailwindcss` and add `@tailwindcss/postcss` (or `@tailwindcss/vite`).
2. Split CSS entry so `@import`/`@source`/`@config` precede scoped preflight; keep utilities after preflight in bundle order.
3. Migrate owned markup to `al:*` variant syntax if any utilities remain in `src/`.
4. Add explicit `@source` for the new component package dist.
5. Confirm `check-webview-tailwind-css.sh` passes on built `main.css` before merging.
6. Re-evaluate Vite `cssMinify: "esbuild"` once lightningcss accepts scanned dependency output.
