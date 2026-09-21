# Step 3.15 — Vite build optimization and Chromium 148 target

Optimizes the webview build for the Chromium 148 compatibility ceiling and Vite's current Rolldown configuration.

## Changes

### Vite configuration migration

`webview_panels/vite.config.ts`:

1. **Set `build.target` to `"chrome148"`** — derived from `engines.vscode ^1.128.0` → VS Code 1.128.0 → Electron 42.5.0 → Chromium 148. The pinned hosts corroborate the major: VS Code runs Chromium 148.0.7778.271 and Cursor runs 148.0.7778.280.

2. **Migrated `rollupOptions` to `rolldownOptions`** — Vite 8.3.0 deprecates the former alias in favor of `rolldownOptions`. The configuration used here has the same `input` and output filename fields.

3. **Attempted deletion of `cssMinify: "esbuild"`** — tested removing the explicit CSS minifier to use Vite's Lightning CSS default. The generated stylesheet contains 11 rules such as `.\!\[-0-\:A-Za-z\] { -0-: A-Za-z !important; }`. The `-0-` property name is invalid CSS: Lightning CSS fails at the following semicolon, while esbuild emits 11 syntax warnings and ships the invalid declarations unchanged.

   The token originates in an embedded TextMate grammar inside `@altimateai/ui-components/dist`, which Tailwind scans through the dependency content glob. Patching `node_modules` is prohibited. **Decision: restore `cssMinify: "esbuild"` until D8 removes the dependency or the content glob can be narrowed without dropping required component utilities.** Generated CSS is not edited by hand.

## Verification

### Build and tests

- `just check` passed with 42 test suites, 447 tests, and 1 snapshot.
- `just webviews::typecheck` passed.
- `just webviews::test` passed 16 tests.
- `just webviews::lint` passed with 51 pre-existing warnings.
- `just package` produced the VSIX.

### Tailwind generated utility guard

Ran `scripts/workspace/check-webview-tailwind-css.sh` on the built `main.css`:

- **Base selector count:** 543 tokens
- **Minimum required:** 400 tokens
- **Required selectors present:** `.al-flex`, `.al-items-center`, `.al-bg-background`, `.al-text-muted-foreground`, `.al-tw-scope`
- **Result:** pass

### Webview payload

Measured with `scripts/benchmark/measure-payload.sh` after `npm run build`:

| Asset     |     Raw bytes |  Gzip bytes | vs. baseline v1            |
| --------- | ------------: | ----------: | -------------------------- |
| main.js   |       864,193 |     257,428 | −16 bytes / −15 bytes      |
| main.css  |     1,000,895 |     196,769 | −292 bytes / −14 bytes     |
| **Total** | **1,865,088** | **454,197** | **−308 bytes / −29 bytes** |

**Interpretation:** The measured `main.js` and `main.css` entry pair decreased by 308 raw bytes and 29 gzip bytes. This measurement does not cover lazy chunks or total `dist` size.

## Vite API evidence

Vite 8.3.0's `node_modules/vite/dist/node/index.d.ts` marks `build.rollupOptions` as a deprecated alias and defines `build.rolldownOptions` as the current option passed to Rolldown.

## Next steps

Phase 4 (Declared Projects) proceeds unchanged. The CSS minifier override remains tied to D8's component styling replacement.
