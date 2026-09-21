# Extension and webview architecture north star, September 2026

## Scope

This document answers one question: what should the Fusion Power User extension host and webview layer look like when the refactor is finished, if nothing about the inherited stack is protected? It is architecture research, not an implementation plan and not a validation of what exists.

Two layers are treated separately throughout, because they have different compatibility floors and different failure modes:

- **Extension host** — Node inside the editor, bundled by rsbuild, constrained by the Extensions API version the declared `engines.vscode` range admits.
- **Webview** — Chromium inside the editor, bundled by Vite, constrained by the Chromium version shipped by the oldest Electron in that same range.

The previous research in [`vscode-extension-development-september-2026.md`](vscode-extension-development-september-2026.md) and its guidance file is treated as input, not authority.

Out of scope: the LSP migration, project scoping, manifest replacement, and anything in [`../refactor/fusion-lsp-plan.md`](../refactor/fusion-lsp-plan.md). The last section proposes deltas to that plan; it does not edit it.

Every quantity below is reproduced by a stated command. Where a claim is an expectation rather than a measurement, it is labelled as one.

## Executive summary

The webview layer's cost is concentrated in assets and vendored code, not in framework choice, and the largest items are removable without architectural commitment.

1. **Images are 83.5% of the compressed VSIX.** 42.7 MB raw / 36.3 MB compressed out of a 43.5 MB compressed archive. Most of it is unreferenced or referenced only by surfaces the plan already deletes. This is a packaging defect, not an architecture problem, and it is the cheapest available win.
2. **Two vendored Altimate component libraries own the lineage graph, the code block, the docs renderer, and the chatbot.** One is `@altimateai/ui-components@0.0.88` (557 MB installed, 7.4 MB of the eager bundle); the other is 3,895,758 bytes of generated JavaScript and CSS committed to `webview_panels/src/lib/altimate/`. Between them they carry the only critical advisory in the tree and the entire reason the Tailwind toolchain exists.
3. **Removing them is ordered work, not a delete.** `CodeBlock` from the vendored bundle is used by seven files across the query panel, documentation editor, and markdown renderer — all retained surfaces. `antd` reaches the retained documentation editor through one `noop` import. Each retained consumer needs a replacement before the bundle or the package can go, and four dependencies that look dead are live imports of the vendored bundle.
4. **One panel bundle serves every panel.** Six routes behind one Vite entry with `cssCodeSplit: false` means every panel parses 10,409,958 bytes of JavaScript and 1,281,908 bytes of CSS before first render. Per-panel entry points are the highest-leverage build change and are independent of every UI framework question.
5. **The webview has one Chromium floor, and it is high.** The declared `engines.vscode: ^1.128.0` floor is VS Code 1.128.0 → Electron 42.5.0 → Chromium 148; the installed Cursor 3.20.14 observes Electron 42.10.0 → Chromium 148. No `build.target` is set, so Vite transpiles for Chrome 111, Firefox 114, and Safari 16.4.
6. **The UI framework decision is deferred, deliberately.** React 19 with Lit-based custom elements is the provisional recommendation, but the honest comparison — React versus a coherent Lit and semantic-DOM webview — can only be made against the post-deletion codebase, which is roughly 10,342 lines rather than today's 13,523.

Two conditional positions carry forward unchanged from the earlier analysis: the Tailwind decision depends on the replacement's styling contract and cannot be settled before the lineage renderer is chosen, and generated dependency output must never be vendored into `src/` regardless of what replaces it.

## Measured baseline

### Method

All figures measured in `/Users/daniel/projects/fusion-pu-webview-north-star` on 2026-09-20, on the commit that is the parent of this document's change.

Hardware and toolchain, fixed for every timing below: Apple M5 Pro, 18 cores, 64 GiB, macOS 26.5.2, Node 24.21.0, npm 11.19.0, all resolved through `mise` as `just` does. Timings are the median of three consecutive runs after one warm-up build; sizes are exact byte counts, not rounded display values.

```bash
export PATH="$(mise bin-paths | tr '\n' ':')$PATH"
npm run build --prefix webview_panels    # webview bundle
npm run build                            # extension host bundle
npm run package:vsix                     # VSIX
```

### VSIX composition

Measured by reading the zip central directory, which gives per-entry compressed size rather than an estimate:

```bash
python3 -c "
import zipfile;z=zipfile.ZipFile('fusion-power-user-0.1.0-alpha.0.vsix')
print(len(z.infolist()), sum(i.file_size for i in z.infolist()), sum(i.compress_size for i in z.infolist()))"
```

| Quantity                  | Value            |
| ------------------------- | ---------------- |
| Archive on disk           | 43,631,948 bytes |
| Entries                   | 621              |
| Unpacked                  | 71,780,750 bytes |
| Sum of compressed entries | 43,506,656 bytes |

By class, sorted by compressed contribution:

| Class                      | Files | Raw bytes  | Compressed bytes | Share of compressed |
| -------------------------- | ----- | ---------- | ---------------- | ------------------- |
| `media/images` GIF         | 44    | 27,460,069 | 24,152,173       | 55.5%               |
| `webview_panels/dist` GIF  | 17    | 13,669,382 | 11,013,089       | 25.3%               |
| `webview_panels/dist` JS   | 397   | 22,961,771 | 5,784,548        | 13.3%               |
| `media/images` PNG         | 7     | 1,125,341  | 1,009,853        | 2.3%                |
| Python bridge and packages | 94    | 2,081,498  | 489,541          | 1.1%                |
| `webview_panels/dist` CSS  | 2     | 1,315,607  | 331,143          | 0.8%                |
| Extension host `dist`      | 6     | 1,177,488  | 243,872          | 0.6%                |
| Everything else            | 54    | 1,989,594  | 482,437          | 1.1%                |

**Images are 42,714,733 bytes raw and 36,308,281 bytes compressed — 83.5% of the compressed archive.** JavaScript, CSS, and the extension host together are 14.6%.

### Image assets by reference status

A reference scan over owned source and the manifest separates icons from tutorial payload:

```bash
grep -rho -E '[A-Za-z0-9._-]+\.(gif|png|svg)' src webview_panels/src package.json README.md | sort -u
```

| Location and type         | Status                                  | Files  | Raw bytes   | Compressed bytes |
| ------------------------- | --------------------------------------- | ------ | ----------- | ---------------- |
| `media/images` GIF        | referenced only by deleted surfaces     | 17     | 13,708,195  | 11,066,856       |
| `media/images` GIF        | unreferenced                            | 27     | 13,751,874  | 13,085,317       |
| `webview_panels/dist` GIF | build output of the same 17 images      | 17     | 13,669,382  | 11,013,089       |
| `media/images` PNG        | unreferenced                            | 6      | 1,018,991   | 904,179          |
| `webview_panels/dist` SVG | `codicon.svg`, copied by the build      | 1      | 377,947     | 97,998           |
| `media/images` SVG        | unreferenced by literal name            | 13     | 35,296      | 14,069           |
| **`media/images` PNG**    | **`dbt.png`, the manifest icon**        | **1**  | **106,350** | **105,674**      |
| **`media/images` SVG**    | **manifest command and treeview icons** | **24** | **46,698**  | **21,099**       |

The last two rows are preserved. `media/images/dbt.png` is the extension icon in `package.json`; the 24 referenced SVGs are `contributes.commands[].icon` entries and the treeview icons resolved in `src/`. The 13 SVGs with no literal reference must be confirmed file by file before deletion, because icon paths can be assembled from fragments rather than written whole.

The 17 referenced GIFs appear twice — once under `media/images` and once as Vite output of `webview_panels/src/assets/tutorial-images`. Their only consumers are the onboarding `TutorialsStep` and the `window.tutorialImages` injection in `altimateWebviewProvider.getHtml`.

The lone `webview_panels/dist` SVG is `codicon.svg`, which is build output rather than a checked-in asset and is handled separately below.

**Candidate set after preserving icons and excluding build output: 42,183,738 bytes raw, 36,083,510 bytes compressed.**

### The Codicons copy is unscoped

The `copy-codicons` plugin in `webview_panels/vite.config.ts` runs `cpSync("./node_modules/@vscode/codicons/dist", "./dist/assets/codicons/", { recursive: true })`, so the package's entire `dist` is shipped. Only `codicon.css` and the `codicon.ttf` its `@font-face` references are used:

```bash
cd webview_panels/node_modules/@vscode/codicons/dist && python3 -c "
import zlib,os
for f in sorted(os.listdir('.')):
    b=open(f,'rb').read(); print(f, len(b), len(zlib.compress(b,9)))"
```

| File                 | Raw bytes | Deflate | Needed |
| -------------------- | --------- | ------- | ------ |
| `codicon.html`       | 1,223,376 | 246,321 | no     |
| `codicon.svg`        | 377,947   | 98,150  | no     |
| `codicon.ttf`        | 125,828   | 61,457  | yes    |
| `metadata.json`      | 81,367    | 15,362  | no     |
| `codicon.css`        | 33,699    | 5,619   | yes    |
| `codiconsLibrary.ts` | 31,309    | 7,829   | no     |
| `codicon.csv`        | 11,360    | 5,327   | no     |

**1,725,359 bytes raw and roughly 372,989 compressed are shipped for nothing** — including a 1.2 MB HTML preview page and a TypeScript source file. Local deflate is a valid proxy here: it puts `codicon.svg` at 98,150 bytes against the 97,998 the VSIX actually records.

The fix is to narrow the copy, not to delete the output. Deleting files from `webview_panels/dist/assets/codicons/` is undone by the next build, so it is not a durable change. Two durable options: give the plugin an explicit allowlist of `codicon.css` and `codicon.ttf`, or leave the copy alone and exclude the unwanted entries in `.vscodeignore`. The plugin allowlist is preferable because it also shrinks the working tree and the dev server's served surface. Verify by asserting that `webview_panels/dist/assets/codicons/` contains exactly the two files after `npm run build --prefix webview_panels`, and that `vsce ls` shows no `codicon.html`.

### The Python payload is not a candidate

`dist/altimate_python_packages/` and `node_python_bridge.py` are 94 entries, 2,081,498 bytes raw and 489,541 bytes compressed, copied by the `copyAssetsPlugin` in `rsbuild.config.ts`. They are runtime-required today:

```bash
grep -rn 'createPythonBridge\|getPythonBridgeStatus' src --include='*.ts' | grep -v src/test
```

`DBTProject.validateSql` calls `executionInfrastructure.createPythonBridge` (`src/dbt_client/dbtProject.ts`), and `src/commands/index.ts` gates a command on `getPythonBridgeStatus`. The canonical plan removes those callers at step 7.1, which narrows `DBTProjectIntegration` and drops `validateSql` and `getPythonBridgeStatus`, and deletes the bridge itself at step 8.2. The asset copy must be deleted with 8.2, not before.

### Eager payload

`main.js` statically imports three chunks, so every panel pays all of it regardless of route:

```bash
grep -o 'from"\./[A-Za-z0-9~.-]*\.js"' webview_panels/dist/assets/main.js | sort -u
```

| Chunk            | Bytes          | Gzip (Vite report) | Identity                                                      |
| ---------------- | -------------- | ------------------ | ------------------------------------------------------------- |
| `main.js`        | 999,409        | 307.74 kB          | application entry, all six routes                             |
| `chunk-2678.js`  | 7,402,954      | 2,164.58 kB        | `@altimateai/ui-components` (contains `regl`, `elk`, `dagre`) |
| `chunk-main.js`  | 1,232,588      | 354.21 kB          | shared vendor                                                 |
| `chunk-prism.js` | 775,007        | 275.29 kB          | Prism, via `react-code-blocks` → `react-syntax-highlighter`   |
| **Total**        | **10,409,958** | **≈3,101.82 kB**   |                                                               |

Plus `main.css` at 1,281,908 bytes, also unconditional, because `build.cssCodeSplit` is `false`.

### Build times

Median of three runs on the fixed hardware above:

| Step                           | Median real | Detail                                     |
| ------------------------------ | ----------- | ------------------------------------------ |
| Webview `npm run build`        | 17.86 s     | 19.32 / 17.86 / 16.85                      |
| └─ `vite build` alone          | 14.37 s     | 15.66 / 14.37 / 14.01                      |
| └─ `vite:css-post transform`   | 9.2 s       | 62–65% of the Vite build, 42 calls         |
| Extension host `npm run build` | 2.35 s      | 2.59 / 2.35 / 2.21; rsbuild reports 1.57 s |
| `npm run package:vsix`         | 41.3 s      | single run                                 |

`vite:css-post` dominating the webview build is a measurement, not an explanation. Whether deleting the generated stylesheet reduces it proportionally is an experiment defined below, not a prediction.

### Source and dependency volume

```bash
find src -name '*.ts' -not -path '*/test/*' | xargs wc -l | tail -1
find webview_panels/src -name '*.ts' -o -name '*.tsx' | grep -v '/lib/' | xargs wc -l | tail -1
npm ls --all --parseable | tail -n +2 | wc -l
python3 -c "import json;print(len([k for k in json.load(open('package-lock.json'))['packages'] if k]))"
```

| Measure                                                                                | Value                    |
| -------------------------------------------------------------------------------------- | ------------------------ |
| Extension host TypeScript, excluding `src/test`                                        | 21,512 lines             |
| `src/test`                                                                             | 11,693 lines             |
| Webview TypeScript and TSX, excluding the vendored bundle                              | 13,523 lines             |
| └─ retained surfaces only (excluding onboarding, What's New, Home, `lib`, `testUtils`) | 10,342 lines             |
| Webview owned CSS and SCSS, excluding the vendored bundle                              | 203,072 bytes, 36 files  |
| └─ onboarding plus What's New                                                          | 117,937 bytes (58%)      |
| Vendored `webview_panels/src/lib/altimate/`                                            | 5 files, 3,895,758 bytes |
| Webview installed dependency instances (`npm ls --all`)                                | 1,631                    |
| Webview lockfile package entries                                                       | 1,737                    |
| Webview `node_modules` on disk                                                         | 1.5 GB                   |
| └─ `@altimateai/ui-components`                                                         | 557.3 MB                 |
| Extension host installed dependency instances                                          | 781                      |
| Extension host lockfile package entries                                                | 857                      |
| Extension host `node_modules` on disk                                                  | 379 MB                   |

Counts of "packages" differ by method and the method must be stated. `ls -d node_modules/*/ | wc -l` counts scope directories as single packages and is not a dependency count; the two figures above are the installed-instance count from `npm ls --all --parseable` and the lockfile entry count, which differ because the lockfile records entries that are deduplicated or optional at install time.

### Tests

```bash
npx jest --listTests | wc -l          # 42
find src/test/integration -name '*.test.ts' | wc -l   # 3
```

`jest.config.js` sets `testPathIgnorePatterns: ["/src/test/integration/"]`, so **`just test` runs 42 suites** and the three files under `src/test/integration/` run separately under `@vscode/test-electron` via `just test-integration`. Counting every `*.test.ts` under `src/test` yields 45 and conflates the two runners. The webview has **zero** unit or component tests and eight Storybook stories.

### Advisories

`npm audit` emits one row per affected package, counting both the vulnerable package and every ancestor that depends on it. The webview tree's 12 rows are **four advisories, each with exactly one vulnerable installed node**; the extension host tree reports zero.

| Severity | Advisory                                                                                                      | Affected range   | Vulnerable installed node                                              | Reached through                                                     | npm rows |
| -------- | ------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| Critical | MapLibre GL JS XSS sanitizer bypass, [GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579) | `<=6.4.0`        | `@altimateai/ui-components/node_modules/maplibre-gl@4.7.1`             | `@altimateai/ui-components` → `plotly.js`                           | 3        |
| High     | js-cookie prototype hijack, [GHSA-qjx8-664m-686j](https://github.com/advisories/GHSA-qjx8-664m-686j)          | `<=3.0.5`        | `js-cookie@2.2.1`                                                      | `@ant-design/pro-chat` → `@ant-design/pro-editor` → `ahooks@3.7.8`  | 4        |
| High     | d3-color ReDoS, [GHSA-36jr-mh4h-2g58](https://github.com/advisories/GHSA-36jr-mh4h-2g58)                      | `>=1.0.2 <3.1.0` | `d3-svg-legend/node_modules/d3-color@1.4.1`                            | `@finos/perspective-viewer-d3fc` → `d3-svg-legend` → `d3-scale`     | 1        |
| Moderate | PrismJS DOM clobbering, [GHSA-x7hr-w5r2-h6wg](https://github.com/advisories/GHSA-x7hr-w5r2-h6wg)              | `<1.30.0`        | `react-code-blocks/node_modules/refractor/node_modules/prismjs@1.27.0` | `react-code-blocks` → `react-syntax-highlighter@15` → `refractor@3` | 4        |

Reproduce with `npm audit --json --prefix webview_panels` and `npm ls <package> --prefix webview_panels`.

The critical row count is three because npm also lists `plotly.js` and `@altimateai/ui-components` as affected ancestors of the one vulnerable `maplibre-gl` install. It is **one critical advisory across three vulnerable rows**, not three advisories; the same inflation explains the four js-cookie rows and the four Prism rows.

The `d3-color` path decides sequencing. `npm ls d3-color` shows `@altimateai/ui-components` → `plotly.js` → `d3-interpolate` resolving **`d3-color@3.1.0`, which sits outside the advisory's `>=1.0.2 <3.1.0` range and is therefore not vulnerable.** The single vulnerable node is `d3-svg-legend/node_modules/d3-color@1.4.1`, reached **exclusively** through `@finos/perspective-viewer-d3fc`. Deleting the Altimate libraries does not clear this finding; **only the Perspective migration does**, which makes that migration high-severity security remediation rather than maintenance hygiene.

### Panels, routing, and contracts

Six routes in `AppConstants.tsx` (`/`, `/docs-generator`, `/query-panel`, `/lineage`, `/onboarding`, `/whats-new`) behind one Vite input, `src/main.tsx`, selected at runtime by `window.viewPath` injected into the HTML. Three are registered as webview views (`dbtPowerUser.PreviewResults`, `dbtPowerUser.Lineage`, `dbtPowerUser.DocsEdit`); Onboarding and What's New open as webview panels.

Every registration passes `retainContextWhenHidden: true`. The `getState`/`setState` wrapper in `modules/vscode/index.ts` exists and is never called by any panel.

The message layer is 48 `case` arms across `src/webview_provider/*.ts`, roughly 44 distinct command strings, typed as `HandleCommandProps extends Record<string, unknown>` with no runtime validation in either direction. Both `openUrl` and `openURL` are handled as separate commands, which an exhaustive union type would have made impossible.

The main CSP is `default-src 'none'; worker-src blob:; font-src ${cspSource} data:; style-src 'unsafe-inline' ${cspSource}; img-src ${cspSource} https: data:; script-src 'unsafe-eval' 'nonce-…' https://*.vscode-resource.vscode-cdn.net; connect-src https://*.s3.amazonaws.com`. `docsEditPanel.ts` emits a different, narrower policy — two hand-written CSPs, already divergent.

Hosted or dead surfaces still wired in: `AltimateAuthService`, `creditsService` broadcast on every panel construction, `ApiHelper` fetch proxying, the `TeamMateProvider` chatbot, `openChat` / `sendFeedback` / `previewFeature` in the lineage RPC map, the Altimate setup wizard, and `installDbt`.

## Compatibility surface

The constraint is not "the versions installed on this machine". It is the oldest host admitted by the declared engine range, plus whatever Cursor actually ships.

| Source                                            | Extensions API | Electron | Chromium       | Evidence                                                                                   |
| ------------------------------------------------- | -------------- | -------- | -------------- | ------------------------------------------------------------------------------------------ |
| `engines.vscode: ^1.128.0` floor, VS Code 1.128.0 | 1.128          | 42.5.0   | 148.0.7778.271 | `microsoft/vscode` tag `1.128.0` `.npmrc`; Electron release index[^vscodenpmrc][^electron] |
| VS Code 1.137.0, installed                        | 1.137          | 42.10.0  | 148.0.7778.280 | local `product.json` and framework `Info.plist`                                            |
| Cursor 3.20.14, installed                         | declares 1.128 | 42.10.0  | 148.0.7778.280 | local `product.json` and framework `Info.plist`                                            |

The load-bearing row is the first. Every host that satisfies `^1.128.0` runs VS Code 1.128.0 or later, and VS Code 1.128.0 pins Electron 42.5.0, whose Chromium is 148. The installed builds corroborate but do not establish this; inferring a browser target from whatever happens to be installed today is exactly the mistake to avoid, because Cursor's declared API version does not fix its Electron version and a future Cursor rebase could move it in either direction.

**Recommended webview target: `chrome148`, derived from the engine floor.** Vite currently applies its default `'baseline-widely-available'`, which for this major is `chrome111, edge111, firefox114, safari16.4, ios16.4`,[^vitebuild] so output is downlevelled for three engines that never run it.

Two guards are required before this is safe to rely on, and they belong in CI rather than in a comment:

1. A smoke test that installs the packaged VSIX into **VS Code pinned at 1.128.x** — the engine floor, not the current stable — and opens each panel.
2. The same smoke test against the current Cursor stable, recording its observed Electron version in the run log so a rebase that lowers it is visible rather than discovered by a user.

If either host ever drops below Chromium 148, `build.target` must drop with it. The target is a consequence of the engine range, not an independent choice.

## Option comparison

### UI runtime

After the deletions, three React panels remain: **lineage, query results, and documentation editor.** Home, Onboarding, and What's New go. That is roughly 10,342 lines of owned TypeScript and TSX rather than today's 13,523.

The only runtime measurement available today is that React 18's production runtime in this tree is 131,685 bytes for `react-dom` plus 6,930 for `react` — 1.3% of the current 10,409,958-byte eager payload. That is a statement about the *current* baseline only. It does not predict the post-deletion share, because the denominator is about to change by an order of magnitude, and it is not an argument for keeping React.

| Option                     | Version         | Case for                                                                                                                                                                                                                                              | Case against                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React 19 (**provisional**) | 19.3.0          | Smallest migration from the existing three panels. Largest component-testing ecosystem. Both reference extensions are React.[^clinepkg][^continuepkg] Full custom-element support removes any need for a React wrapper around Lit elements.[^react19] | Incumbent. The advantage is migration cost, which shrinks as the codebase shrinks.                                                                                                                                                                                                                                                                             |
| Lit plus semantic DOM      | 3.3.3           | VS Code Elements is already Lit,[^vscodeelements] so a Lit webview shares one runtime with its component library instead of layering two. Being stateful is not a disqualifier — Lit has reactive properties and signals.                             | Rewrites three panels. Perspective and a graph renderer are custom elements or imperative anyway, so the framework does less work than it appears.                                                                                                                                                                                                             |
| Preact plus `compat`       | 10.29.8         | Alias-level substitution; no source rewrite.                                                                                                                                                                                                          | Benefit unmeasured against the post-deletion payload. Custom-element and Perspective interop need verification.                                                                                                                                                                                                                                                |
| Svelte 5 / Solid           | 5.57.1 / 1.9.15 | Fine-grained reactivity without a virtual DOM.                                                                                                                                                                                                        | Rewrites three panels for no measured advantage. Component availability is *not* the objection: VS Code Elements ships framework-agnostic custom elements and works in Svelte or Solid as it does in Lit or React. This document makes **no** performance claim for either; none was measured here and none of the cited sources benchmarks them in a webview. |

**The decision is deferred to a measured comparison after the deletions, and React 19 is the provisional default so that work is not blocked.** The comparison is not "React versus Preact bytes" — it is React 19 against a coherent Lit and semantic-DOM webview on the same three panels, judged on bundle bytes, first render, accessibility, and the cost of driving two custom-element-heavy surfaces. The benchmark is defined below. Committing to React before that comparison would be laundering a default as a decision.

### Component library

`@vscode-elements/elements` is a **Lit-based custom element library**, not a React library.[^vscodeelements] It works unchanged from Lit, from vanilla DOM, and from React 19, which is what makes it compatible with deferring the runtime decision.

| Option                                         | Status                                                                                     | Verdict                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@vscode-elements/elements` 2.5.1              | MIT, active (pushed 2026-09-19), 38 components, 49,135 downloads in the week to 2026-09-20 | **Adopt** for form and list primitives, under either runtime                                                               |
| `@vscode-elements/react-elements` 2.4.0        | 13 stars, last pushed 2025-12-26                                                           | **Reject** — React 19 needs no wrapper, and adopting one would couple the component layer to the deferred runtime decision |
| `@vscode/webview-ui-toolkit` 1.4.0             | Archived 2024-09-24, unmaintained                                                          | **Reject**                                                                                                                 |
| Radix or other headless primitives             | Used by Cline for dialog, popover, select, tooltip[^clinepkg]                              | **Adopt narrowly**, only where VS Code Elements has no equivalent, and only if React wins the runtime comparison           |
| `reactstrap` + `bootstrap`                     | 8 files, 6 wrapper components in `uiCore`                                                  | **Delete** — Bootstrap's reset is why the Tailwind Preflight had to be scoped                                              |
| `antd` + `antd-style` + `@ant-design/pro-chat` | 7 files: 6 in onboarding, 1 in the **retained** documentation editor                       | **Delete after** the retained import is replaced                                                                           |
| `@altimateai/ui-components`                    | 0.0.88; never had a stable release                                                         | **Delete**, replacing only the lineage graph                                                                               |
| `webview_panels/src/lib/altimate`              | Checked-in generated bundle                                                                | **Delete after** its retained consumers are replaced                                                                       |

### State

The repository does not use Redux. There is no `configureStore`, no `react-redux`, no `Provider`, no `useSelector`; `@reduxjs/toolkit` is imported by six files for `createSlice` and `PayloadAction` types feeding plain `useReducer` calls.

**Recommendation: per-panel reducer state, and drop `@reduxjs/toolkit`.** Panels do not share a process, so there is no cross-panel state. Zustand stays available as the named escape hatch if the query result grid develops a subscription pattern that Context re-renders badly, and adopting it before that is measured would add a store to a codebase that has none. If Lit wins the runtime comparison this section is moot — reactive properties replace it.

Independently of the runtime: implement `getState`/`setState` in every panel and remove `retainContextWhenHidden`. Official guidance is that `getState`/`setState` "are the preferred way to persist state, as they have much lower performance overhead", and that `retainContextWhenHidden` "has high memory overhead and should only be used when other persistence techniques will not work".[^webviewguide] Five panels take the expensive option while leaving the cheap one uncalled.

### Styling

Today the CSS pipeline has four layers: 203,072 bytes of owned CSS Modules and SCSS across 36 files; a Tailwind 3 utility set generated each build by scanning `@altimateai/ui-components`' published `dist` for `al-*` string literals; a 384-line Preflight adapted by hand from Tailwind's source and scoped under `.al-tw-scope` so it does not break Bootstrap in sibling panels; and `src/lib/altimate/main.css`, 181,946 bytes of generated dependency output committed to `src/`. That file is not orphaned: line 3 of the vendored `main.js` reads `import "./main.css";`, so it is bundled into the built stylesheet like any other import and leaves only when the bundle does.

Two positions are settled and carry forward:

- **Generated dependency output is never vendored into `src/`.** A package may own compiled CSS and expose it through `exports`, the way `@cline/ui` exports `theme/tokens.css` and per-component CSS.[^clineui] A committed copy maintained by hand is prohibited regardless of what replaces it. The hand-adapted Preflight is the same violation in a different form.
- **Build-time generation from a dependency's markup is legitimate** and stays until the lineage replacement fixes the styling contract. The failed Tailwind 4 spike already showed what switching it off early produces.[^blocker]

The forward choice is **conditional and cannot be made yet**, because it is a property of the lineage replacement rather than of this repository:

| Replacement's styling contract                                      | Consequence                                                                                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ships its own compiled CSS through `exports`, or needs no utilities | Delete the Tailwind toolchain outright. Owned styling becomes CSS Modules plus a `--vscode-*` token layer.                                                              |
| Is itself Tailwind 4 and expects a shared theme                     | Adopt Tailwind 4 with `@theme` mapping `--color-*` onto `--vscode-*`, as Cline does,[^clinetheme] and `@theme { --*: initial; }` to drop the default palette.[^twtheme] |
| Is unstyled and expects the host to supply everything               | CSS Modules only; no utility framework.                                                                                                                                 |

The first outcome is the most likely and the one to plan for, but planning for it is not the same as deciding it. What is decided: zero own-source Tailwind utility usage exists today, so **no scenario requires migrating the current `al-` prefixed generation to Tailwind 4**. Either it is deleted or it is replaced by a fresh v4 configuration written against the new component's contract.

Theme fidelity comes from the documented mechanism regardless: `body` carries `vscode-light` / `vscode-dark` / `vscode-high-contrast`, theme colours are available as `--vscode-editor-foreground` and friends, and `data-vscode-theme-id` covers single-theme escapes.[^webviewguide] The current `tailwind.config.ts` defines an independent HSL palette instead, which is why panels do not track the editor theme exactly.

### Build

| Layer                          | Current                                                  | Recommendation                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension host                 | rsbuild 2.2.8 / Rspack, ESM, `all-in-one`, 2.35 s median | **Keep.** Nothing measured suggests a problem. Remove the Python copy plugin at plan step 8.2, not before.                                                       |
| Webview bundler                | Vite 8.3.0, already Rolldown-based                       | **Keep**, and change three settings: per-panel entries, explicit `build.target`, and `rollupOptions` → `rolldownOptions` (the former is deprecated).[^vitebuild] |
| Browser target                 | unset, defaults to `baseline-widely-available`           | `chrome148`, derived from the engine floor, with the pinned-1.128 smoke test above.                                                                              |
| CSS minifier                   | `cssMinify: "esbuild"` override                          | Return to Vite's default `lightningcss` once the generated stylesheet no longer forces the override; re-measure rather than assume.                              |
| Rsbuild or esbuild for webview | —                                                        | **Reject** on current evidence: no measured advantage, and both lose Vite's CSS Modules, SVGR, and dev server. Revisit only if a measurement motivates it.       |

### Contracts and testing

**Message protocol.** One shared module imported by both bundles, defining a discriminated union in both directions with a runtime validator at each boundary. A webview is a trust boundary and the current handlers accept `Record<string, unknown>` and switch on a string. Zod 4 is the default candidate on availability grounds, but the extension host bundle is already 990 kB, so `zod/mini` and Valibot must be weighed against it before the choice is fixed.

**Test layers, none of which exist for the webview today:**

| Layer                      | Tool                                                                               | Precedent                                                         |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Component and hook         | Vitest + Testing Library + jsdom                                                   | Both Cline and Continue run exactly this[^clinepkg][^continuepkg] |
| Message contract           | Vitest, shared module, both directions                                             | —                                                                 |
| Extension host integration | `@vscode/test-electron`, already wired as `just test-integration`                  | Existing repository harness                                       |
| End-to-end, VS Code 1.128  | Playwright `_electron.launch()` against a VS Code build pinned to the engine floor | Playwright's Electron support is experimental[^pwelectron]        |
| End-to-end, Cursor         | The same harness with `executablePath` pointed at the installed Cursor binary      | —                                                                 |

The last row closes the gap the previous research recorded as unsolved: `@vscode/test-cli` can only download VS Code, but Playwright's Electron launcher accepts an arbitrary executable path.

**The webview frame path is experimental, not a platform contract.** Reaching webview content means traversing `iframe.webview.ready` and then `#active-frame`,[^vscodepw] which are VS Code implementation details with no compatibility guarantee, in a Playwright API the project itself labels experimental. Isolate the traversal in one fixture, assert a clear failure message when it stops matching, and treat a break as expected maintenance rather than a regression.

### Heavy retained surfaces

**Query result grid — Perspective.** `@finos/perspective@3.8.0` is deprecated on npm with the message "This package is no longer maintained. Please upgrade to `@perspective-dev/client`". The project moved to the OpenJS Foundation at v4.0.0 on 2025-10-28; current is `@perspective-dev/*` 5.5.1.[^perspective] Keep Perspective and migrate — but the migration is substantially larger than a scope rename, and it is the **only** path that clears the high-severity `d3-color` advisory, which reaches the tree solely through `@finos/perspective-viewer-d3fc`.

What changes, from reading the current integration and the 5.5.1 package manifests:

| Concern          | Today (`@finos/perspective@3.8`)                                                                  | Perspective 5.5                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package layout   | one `@finos/perspective` entry plus viewer packages                                               | `@perspective-dev/client` depends on `@perspective-dev/server`; separate `viewer`, `viewer-datagrid`, `viewer-charts`                                     |
| Engine bootstrap | `await perspective.worker()`                                                                      | client/server split; `.` browser entry, `./node`, `./inline`, and `./virtual_servers/*` exports                                                           |
| WASM delivery    | implicit worker asset                                                                             | `pro_self_extracting_wasm`; the `./inline` export matters because fetching a separate `.wasm` over `vscode-resource` under a strict CSP is the risky path |
| Charts           | `@finos/perspective-viewer-d3fc`                                                                  | `viewer-d3fc` deleted at 4.5.0 in favour of `@perspective-dev/viewer-charts`, "a compatible superset … new name and internals"[^perspectivecharts]        |
| Themes           | six CSS files imported from `perspective-viewer/dist/css/`, plus a 41,673-byte local `themes.css` | asset paths change with the scope                                                                                                                         |
| Custom plugin    | `PerspectivePlugins.ts` subclasses `customElements.get("perspective-viewer-datagrid")`            | subclassing an internal element across a two-major jump is the single highest-risk item                                                                   |
| State            | `viewer.restore(config)` with `ViewerConfigUpdate`                                                | config shape must be re-verified                                                                                                                          |
| CSP              | `worker-src blob:` and `script-src 'unsafe-eval'` present                                         | which of the two the WASM runtime still needs must be established, not guessed                                                                            |

**A Vite spike is required before any deletion depends on this migration.** It must, in a real webview: load a table, render the datagrid, render a chart, restore a saved config, re-create the custom datagrid plugin or prove it unnecessary, and run under the tightest CSP that works. Until that spike passes, Perspective 5 is a plan, not a step.

**Lineage graph — the one real rebuild.** The current implementation is a closed component driven by a `CustomEvent("renderStartNode")` on `document` plus a monkey-patched `ApiHelper`, backed by 30,568 bytes of extension-host RPC in `newLineagePanel.ts`. Its chunk contains `regl`, `elk`, and `dagre`, so a replacement needs a layout engine and a renderer.

| Candidate                                                             | Rendering   | Primary source                                                                                                               |
| --------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@xyflow/react` 12.11.6 with `elkjs` 0.12.0 or `@dagrejs/dagre` 3.1.1 | SVG and DOM | [reactflow.dev](https://reactflow.dev/), [elkjs](https://github.com/kieler/elkjs), [dagre](https://github.com/dagrejs/dagre) |
| `cytoscape` 3.34.3                                                    | Canvas      | [js.cytoscape.org](https://js.cytoscape.org/)                                                                                |
| `sigma` 3.0.3 with `graphology`                                       | WebGL       | [sigmajs.org](https://www.sigmajs.org/), [graphology](https://graphology.github.io/)                                         |

**No candidate is selected, and none should be before measurement.** The deciding inputs are the node, edge, and per-node column distributions of real Declared Projects, which nobody has recorded, and whether column-level lineage — which needs per-column anchors on every node — is expressible in each renderer. The benchmark is defined below. Note that `@xyflow/react` is React-coupled, so this choice and the runtime comparison interact and should be run together.

**Documentation editor.** Keep. 3,890 lines of this repository's own code. Its vendored couplings are three: `CodeBlock` through `@uicore`, the type import `ColumnLineage` from `@altimateai/ui-components/lineage`, and one `noop` from `antd/es/_util/warning`. It does **not** import `DbtDocsRenderer` — the only reference to that 2,275,618-byte file anywhere in `src/` is a lazy `import()` inside the vendored `main.js`, so it leaves with the bundle and needs no replacement.

**Onboarding, What's New, Home — delete.** The official UX guidance says not to use webviews for wizards, not to open them on extension updates, and not to use them for promotions.[^uxguidelines] The onboarding wizard is a wizard and contains an `installDbt` command the product boundary forbids; What's New opens on update; Home is three lines.

## North star architecture

The webview runtime is shown as React because that is the provisional default; the same structure holds if the post-deletion comparison selects Lit, and only the per-panel implementation language changes.

```text
┌─ Extension host (Node 24, API 1.128, rsbuild/Rspack ESM) ────────────────┐
│                                                                          │
│  extension.ts → dbtPowerUserExtension.ts → Inversify container           │
│                                                                          │
│  ProjectSession (per Declared Project)   ── owns LSP client, diagnostics │
│        │                                                                 │
│        └── PanelHost<TPanel>                                             │
│              ├─ builds HTML: one nonce CSP, one localResourceRoots,      │
│              │  one asWebviewUri helper, one panel entry script          │
│              ├─ validates every inbound message against the shared       │
│              │  contract before dispatch                                 │
│              └─ no retainContextWhenHidden; panels persist via setState  │
│                                                                          │
└────────────────────────┬─────────────────────────────────────────────────┘
                         │  @fusion/messages  (shared, runtime-validated,
                         │  discriminated union, imported by both bundles)
┌────────────────────────┴─────────────────────────────────────────────────┐
│  Webview bundles (Chromium 148 floor, Vite/Rolldown, target chrome148)   │
│                                                                          │
│   entry: lineage.ts      entry: query.ts       entry: docs.ts            │
│      │                      │                     │                      │
│      │ graph renderer       │ @perspective-dev    │ forms via            │
│      │ + layout engine      │ viewer + datagrid   │ VS Code Elements     │
│      │ (unselected)         │ + charts            │                      │
│      │                      │                     │                      │
│      └──────────────┬───────┴─────────────────────┘                      │
│                     │  one UI runtime, chosen by measurement             │
│                     │  (React 19 provisional; Lit the live alternative)  │
│                                                                          │
│            tokens.css  ── maps --vscode-* into product names             │
│            *.module.scss ── component-owned, locally scoped              │
│            @vscode-elements/elements ── Lit custom elements, no wrapper  │
│                                                                          │
│   No router. No shared eager vendor chunk. No Bootstrap.                 │
│   Utility CSS: present only if the lineage replacement requires it.      │
└──────────────────────────────────────────────────────────────────────────┘
```

Three properties define it, and none depends on the deferred runtime choice:

1. **One panel, one entry, one bundle.** `window.viewPath` and `MemoryRouter` disappear; the host points each panel at its own script. A panel cannot pay for a dependency it does not import.
2. **One message contract, validated at both ends.** The union replaces roughly 44 ad-hoc strings, and `PanelHost` replaces two divergent hand-written CSPs.
3. **Nothing generated is committed.** Compiled CSS may arrive through a package's `exports`; it may not arrive through `src/`.

## Dependency disposition

Ordering matters more than the lists. Four dependencies that a naive scan calls dead are live imports of the vendored bundle:

```bash
grep -o 'from *"[^".][^"]*"' webview_panels/src/lib/altimate/main.js | sort -u
# @ant-design/pro-chat, antd, formik, react, react-dom, react-syntax-highlighter, reactstrap, zod
```

**Class 1 — unreferenced anywhere in owned source or config; removable immediately:** `react-textarea-autosize`, `idb`, `date-fns`, `react-code-blocks`, `vite-plugin-css-injected-by-js`, `rollup-plugin-legacy`, `sass-loader`, `@rollup/plugin-typescript`, `@rollup/plugin-commonjs`, `@rollup/plugin-node-resolve`. Removing `react-code-blocks` also removes the moderate Prism advisory chain.

**Class 2 — referenced only by the vendored bundle; orphaned *after* it is deleted, not before:** `zod`, `react-syntax-highlighter`, `formik`, `@ant-design/pro-chat`.

**Class 3 — referenced by surfaces scheduled for deletion:** `antd` (onboarding, plus one retained `noop` import that must be replaced first) and `antd-style`, the 17 tutorial GIFs, and the What's New font stylesheet. `antd-style` has no import of its own, but it is an `antd` companion package and is removed in the same step, so it belongs here rather than in Class 1.

**Class 4 — replace:** `@finos/perspective*` → `@perspective-dev/{client,viewer,viewer-datagrid,viewer-charts}` 5.x behind a passing spike; `@altimateai/ui-components` → an unselected graph renderer plus layout engine, lineage only; `@reduxjs/toolkit` → per-panel reducer state; `yup` → whichever validator the message contract selects; the vendored `CodeBlock` → one codicon-styled highlighter or a plain `<pre>`. What needs a replacement is the `CodeBlock` *capability* its seven retained call sites depend on, not the `react-code-blocks` package — that package is imported by nothing and is a Class 1 deletion, not a Class 4 substitution.

**Class 5 — keep:** `vite`, `typescript`, `sass`, `vite-plugin-svgr`, `@vscode/codicons` (reached through the Vite copy plugin rather than an import, and a peer dependency of `@vscode-elements/elements`; keep the package, narrow the copy), `yaml`, `react-hook-form` with `@hookform/resolvers`, `react-markdown` with `remark-gfm`, `use-debounce`, `react-error-boundary`, `storybook`, and the UI runtime the comparison selects.

**Class 6 — delete only at their plan step:** `dist/altimate_python_packages/`, `node_python_bridge.py`, and the `rsbuild.config.ts` copy plugin, at plan step 8.2.

## Migration seams

Four seams make the work landable in independent pieces, listed in the order they must be cut.

1. **`@fusion/messages`** — the shared contract module. Cutting it first means every later panel change happens behind a stable interface, and the extension-host handlers can be validated while the command list is still shrinking.
2. **`PanelHost` plus per-panel Vite entries** — one HTML generator, one CSP, one resource-root policy, one inbound validator, and one script per panel, replacing six hand-rolled `getHtml` methods and the router. **This must precede any panel rewrite**, or the rewrite is wired into the old single-entry structure and rewired afterwards.
3. **`LineageData`** — a plain typed graph payload produced by the extension host, replacing the `CustomEvent` plus `ApiHelper` monkey-patch. Defining it is what makes candidate renderers comparable against identical input.
4. **`CodeBlock`** — a local component with the current props, so the seven retained call sites stop importing from the vendored bundle. Small, but it gates the bundle deletion.

## Measurable targets

**Every target below is an experiment until it is measured on the fixed hardware in the deletion state that produces it.** The baseline column is measured. The target columns are hypotheses recorded so that a miss is visible, not commitments; none of them should be quoted as a projected result.

| Metric                                    | Baseline (measured) | After v1 (hypothesis) | North star (hypothesis)                         |
| ----------------------------------------- | ------------------- | --------------------- | ----------------------------------------------- |
| VSIX, compressed on disk                  | 43,631,948 bytes    | ≤ 8 MB                | ≤ 6 MB                                          |
| Image share of compressed archive         | 83.5%               | ≤ 5%                  | ≤ 5%                                            |
| Eager JavaScript, largest panel           | 10,409,958 bytes    | ≈ 9.4 MB              | ≤ 600 kB                                        |
| Eager JavaScript, smallest retained panel | 10,409,958 bytes    | ≈ 9.4 MB              | ≤ 200 kB                                        |
| Webview CSS bundle                        | 1,281,908 bytes     | measurably lower      | ≤ 80 kB                                         |
| Owned CSS and SCSS source                 | 203,072 bytes       | ≈ 85,000 bytes        | ≤ 60 kB                                         |
| Webview build, median of three            | 17.86 s             | re-measure            | re-measure                                      |
| Webview installed dependency instances    | 1,631               | ≤ 1,400               | ≤ 700                                           |
| Distinct advisories, webview tree         | 4                   | ≤ 2                   | 0                                               |
| Webview component tests                   | 0                   | ≥ 1 plus harness      | ≥ 1 per retained panel, plus each critical flow |
| Panels using `retainContextWhenHidden`    | 5                   | 3                     | 0                                               |
| Panels calling `getState`/`setState`      | 0                   | 0                     | 3                                               |
| Distinct hand-written CSPs                | 2                   | 2                     | 1                                               |
| Unvalidated message commands              | ≈ 44                | 0 on new paths        | 0                                               |
| Extension activation, cold                | unmeasured          | measured              | no regression                                   |
| Webview first paint                       | unmeasured          | measured              | measured, then budgeted                         |

Two rows are easy to overstate and so carry their reasoning inline.

**The v1 eager-JavaScript figure barely moves**, and is written as an approximation rather than a bound. `chunk-2678.js` is 71% of the eager payload and survives v1; the ≈9.4 MB figure assumes the Prism chain and the vendored bundle come out and nothing else changes.

**The v1 CSS row moves, but by an unknown amount.** Onboarding and What's New own 117,937 of the 203,072 bytes of owned stylesheet source, including a 71,969-byte font stylesheet. Deleting them must reduce the CSS bundle; by how much is a measurement, because the bundle is dominated by generated Tailwind utilities that those panels do not contribute.

Build-time improvement is deliberately recorded as "re-measure" rather than a number. `vite:css-post` is 62–65% of the Vite build today, but that it will fall proportionally when the generated CSS shrinks is an inference, and this document does not make unmeasured speedup claims.

## Benchmark definitions

Each benchmark must be executable by someone who was not in this conversation.

**Extension activation, cold.** The extension declares `activationEvents: ["workspaceContains:**/dbt_project.yml"]`, so opening a fixture activates it before any test code runs; calling `activate()` afterwards returns an already-resolved promise and times nothing. Measure instead by launching a **fresh Electron process per sample** with `--profile-temp` and `--extensionDevelopmentPath`, against a fixture chosen from `src/test/fixtures/{single-project,multi-root,nested-project}`, and read the host's own activation accounting rather than a wall clock in test code: `vscode.extensions.getExtension(id).activate()` inside `--extensionTestsPath` is only valid if the fixture does **not** match the activation event. Cross-check every sample against "Developer: Show Running Extensions", which reports the activation time the host recorded. Ten fresh processes per configuration, median and p90 reported, one machine, no other builds running.

**Webview first paint.** Do not compare a `performance.mark` in the webview against a timestamp in the extension host: they are separate processes with separate `performance.timeOrigin` values, so the difference is not a duration. Two clocks, two questions:

- *Inside the webview, one clock domain:* commit a first-paint entry to each panel entry script and read the browser's own paint timing — `performance.getEntriesByName("first-contentful-paint")` from `PerformanceObserver` — relative to that document's `timeOrigin`. This is the number that answers "how long after the document starts does the user see something".
- *Across the boundary:* measure host-side only, from `resolveWebviewView` return to receipt of the existing `webview:ready` message, using the host clock at both ends.

Report both; never subtract one from the other.

**Per-entry bytes.** Enable `build.manifest`, record raw and gzip bytes per entry in CI, fail on a percentage regression against the stored artifact rather than an absolute number.

**UI runtime comparison.** Run *after* the deletions and *after* the per-panel entry seam exists, so both arms build the same three panels from the same message contract. Arm A: React 19. Arm B: Lit with `@vscode-elements/elements`. Optional arm C: `preact/compat` alias over arm A. Compare eager bytes per entry, in-webview first-contentful-paint, keyboard and screen-reader acceptance from the existing accessibility checklist, and the line count needed to drive the Perspective viewer and the selected graph renderer. Publish all three even if the incumbent wins.

**Lineage renderer.** Extract node counts, edge counts, and per-node column counts from real Declared Projects, starting with `finance-pipelines`. Render the p50 and p95 graph in each candidate behind the same `LineageData`; measure layout time, in-webview first-contentful-paint, and frame time while panning at p95. Column-level lineage must be in the harness from the first run, not added afterwards. Because `@xyflow/react` is React-coupled, run this jointly with the runtime comparison.

**Perspective 5 spike.** In a throwaway Vite app configured like the real webview, under the real CSP: load a table from the current query-result payload shape, render `viewer-datagrid`, render one `viewer-charts` chart, `restore()` a saved config, and either port `PerspectivePlugins.ts` or demonstrate the feature it provides another way. Record which of `script-src 'unsafe-eval'` and `worker-src blob:` the WASM runtime still requires by removing each independently.

**Build and bundle re-measurement.** Repeat the baseline commands on the same hardware at each deletion milestone. A build-time claim without a milestone measurement is not reportable.

## Horizon 1 — current refactor

Bounded work that aligns with the north star, lands beside the deletions already scheduled in the plan, and is not redone in v2. Ordered; dependencies are stated.

1. **Prune unreferenced images by reference scan.** Delete the 27 unreferenced `media/images` GIFs and the 6 unreferenced PNGs. **Preserve** `media/images/dbt.png` and the 24 SVGs referenced by `contributes.commands[].icon` and the treeview providers; confirm the 13 SVGs with no literal reference individually before removing any of them. Measured candidate: 14,770,865 bytes raw and 13,989,496 compressed without those 13 SVGs, 14,806,161 raw and 14,003,565 compressed with them. Do **not** include `webview_panels/dist/assets/codicons/codicon.svg` here; it is build output and step 2 handles it. No dependency on anything else.
2. **Narrow the Codicons copy.** Change the `copy-codicons` plugin in `webview_panels/vite.config.ts` to copy only `codicon.css` and `codicon.ttf`, or exclude the rest through `.vscodeignore`. Measured waste: 1,725,359 bytes raw, roughly 372,989 compressed, including a 1.2 MB HTML preview page. Verify that `dist/assets/codicons/` holds exactly two files after a build and that `vsce ls` shows no `codicon.html`. Deleting the emitted files instead is not durable — the next build restores them. No dependency on anything else.
3. **Delete the onboarding and What's New panels**, their extension-host providers, routes, and settings. This removes the webview-as-wizard and open-on-update UX violations, the `installDbt` command, 117,937 bytes of stylesheet source including a 71,969-byte font sheet, and — once step 4 lands — the `antd` family.
4. **Delete the remaining tutorial GIFs**, both copies, once step 3 removes `TutorialsStep` and the `window.tutorialImages` injection in `altimateWebviewProvider.getHtml`. Measured: 27,377,577 bytes raw, 22,079,945 compressed. **Depends on step 2.**
5. **Replace the retained `antd` import.** `documentationEditor/components/saveDocumentation/SaveDocumentation.tsx` imports `noop` from `antd/es/_util/warning`. Replace it locally so `antd` leaves with onboarding rather than blocking it. **Blocks completion of step 3's dependency removal.**
6. **Replace `CodeBlock`.** Implement `uiCore/components/codeblock` locally, keeping its current props, so the seven retained call sites in the query panel, documentation editor, and markdown renderer stop importing from the vendored bundle. **Blocks step 8.**
7. **Delete the hosted consumers of the vendored bundle:** `TeamMateProvider` in `App.tsx` and `ApiHelper` in `AppProvider`. Fold into the hosted-surface deletions.
8. **Delete `webview_panels/src/lib/altimate/`** — 5 files, 3,895,758 bytes. **Depends on steps 6 and 7.**
9. **Prune Class 1 and, after step 8, Class 2 dependencies.** Class 2 is not dead until the bundle is gone.
10. **Set `build.target: "chrome148"`** and migrate `rollupOptions` to `rolldownOptions`. Record the derivation — `engines.vscode ^1.128.0` → VS Code 1.128.0 → Electron 42.5.0 → Chromium 148 — in the commit message, not as a comment naming a moment in time.
11. **Add a VS Code 1.128.x pinned smoke test to CI** that installs the packaged VSIX and opens each panel, plus the same check against current Cursor stable recording its observed Electron version. **Required before step 10's target is load-bearing.**
12. **Tighten the CSP**: remove `connect-src https://*.s3.amazonaws.com` and the `https://*.vscode-resource.vscode-cdn.net` `script-src` host once the hosted surfaces are gone. Leave `'unsafe-eval'` and `worker-src blob:` until the Perspective spike establishes which is required.
13. **Introduce `@fusion/messages`** and route surviving commands through it, validated at both ends, while the command list is still shrinking.
14. **Add Vitest, Testing Library, and jsdom** with one component test and one contract test. The harness is the deliverable.
15. **Record the activation and first-paint baselines** with the methods above, so v2 has a control.
16. **Re-measure the full baseline** after steps 1–9 and publish the deletion-state numbers against this document's table.

Steps 1, 2, 10, 13, 14, and 15 are independent. Steps 3→4, 5→3, and 6,7→8 are the only ordering constraints. Nothing here touches the lineage panel, the Tailwind generation, the `@altimateai/ui-components` dependency, or the Python bridge.

## Horizon 2 — rip and replace

Ordered so that no wiring is built twice. Steps 1 through 4 are strictly serial.

1. **Define the contracts and run the decisions.** `LineageData`; the Perspective 5 spike; the lineage renderer benchmark; the UI runtime comparison. Nothing is built in this step — it produces three recorded decisions and the harness that justified them. Running the renderer benchmark and the runtime comparison together is required because `@xyflow/react` couples them.
2. **Per-panel Vite entries and `PanelHost`.** Delete `react-router-dom`, `AppRoutes`, `AppConstants`, and `window.viewPath`; introduce `PanelHost` on the extension side; keep the existing panel implementations behind the new entries. **This precedes every UI rewrite**, so no rewrite is wired into the single-entry structure and rewired afterwards. It is also the step that converts v1's deletions into measurable per-entry byte reductions.
3. **Build the selected lineage renderer** behind `LineageData` and its own entry. **Rollback boundary:** keep `@altimateai/ui-components` installed and the old `LineageView` reachable behind a setting until the replacement passes the benchmark against real projects.
4. **Resolve the styling contract.** With the replacement's requirements known, either delete the Tailwind toolchain — `tailwindcss`, `autoprefixer`, `postcss`, `tailwind.config.ts`, `postcss.config.mjs`, `tailwind-globals.css`, `check-webview-tailwind-css.sh` — or write a fresh Tailwind 4 configuration against the new contract. The `al-` prefixed generation is not migrated in either case. The regression guard stays green until this step and is deleted or replaced by it, never partially disabled.
5. **Delete Bootstrap and reactstrap**, rewriting the six `uiCore` wrappers onto VS Code Elements and semantic markup. Unblocked once the scoped Preflight that Bootstrap forced is gone.
6. **Migrate to Perspective 5** on the spike's evidence, including the CSP narrowing it established. This is the step that closes the high-severity `d3-color` advisory; confirm with `npm audit` afterwards that `@perspective-dev/viewer-charts` has not reintroduced a `d3-color` below 3.1.0.
7. **Apply the UI runtime decision** across the three panels, if it differs from the provisional React 19.
8. **Token CSS layer and theme fidelity.** One `tokens.css` mapping `--vscode-*`; remove the independent HSL palette; add high-contrast, light, and dark to the acceptance checks.
9. **State cleanup.** Drop `@reduxjs/toolkit`; implement `getState`/`setState` in every panel; remove `retainContextWhenHidden` from all registrations. Measure memory before and after.
10. **Playwright harness over VS Code 1.128.x and Cursor**, one fixture, differing only in `executablePath`, with the frame traversal isolated as described above.

**Rollback boundaries.** Steps 2, 4, and 5 are revertible because they are structural changes and deletions with no persisted data. Step 3 is the hard-to-reverse one and is gated on the benchmark. Step 6 is gated on the spike. Step 9 changes user-visible persistence behaviour and should ship one release after step 2, so a regression is attributable.

## Do not carry forward

- **Generated dependency output committed to `src/` and edited by hand.** `webview_panels/src/lib/altimate/` and the hand-adapted Preflight are both instances. A package may own compiled CSS and expose it through `exports`; this repository may not hold a copy.
- **One bundle serving every panel.** A router inside a webview is a workaround for a missing build configuration.
- **`retainContextWhenHidden` as a substitute for state persistence**, with the `getState`/`setState` wrapper present and never called.
- **A message protocol of string constants with no runtime validation**, and the duplicate `openUrl` / `openURL` pair it produced.
- **Two hand-written CSPs that have already diverged**, one of which allows `connect-src` to S3.
- **An independent colour palette parallel to the editor theme.** `--vscode-*` is the contract.
- **A UI dependency at version 0.0.x carrying `plotly.js`, `maplibre-gl`, and `@tabler/icons` into a dbt extension.**
- **Webviews for wizards, changelogs, and promotions**, which the official UX guidance rules out directly.
- **Shipping 36.3 MB of compressed images**, 83.5% of the archive, in a product whose panels reference a fraction of them.
- **A browser target inferred from whatever editor builds happen to be installed** rather than from the declared engine range.
- **Copying a dependency's whole `dist` into build output.** The Codicons plugin ships a 1.2 MB HTML preview page and a TypeScript source file because the copy has no allowlist.

## Rejected alternatives

| Alternative                                                              | Why rejected                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migrating the current `al-` prefixed Tailwind 3 generation to Tailwind 4 | Zero own-source utility usage, so there is nothing to migrate. Either the toolchain is deleted or a fresh v4 configuration is written against the replacement's contract. Which one is conditional on the lineage replacement. |
| Deleting the Tailwind toolchain now                                      | The generated utilities are what makes the current lineage component render. The failed v4 spike is the evidence.[^blocker]                                                                                                    |
| `@vscode-elements/react-elements`                                        | Nine months stale, and adopting a React wrapper would couple the component layer to a runtime decision this document defers. The Lit elements work from any runtime.[^vscodeelements]                                          |
| `@vscode/webview-ui-toolkit`                                             | Archived 2024-09-24 with no maintainer.                                                                                                                                                                                        |
| Committing to React 19 now                                               | Deferred rather than rejected. The comparison against a coherent Lit webview is only meaningful after the deletions, and React remains the provisional default so work is not blocked.                                         |
| Disqualifying Lit because the panels are stateful                        | Not a valid reason. Lit has reactive properties, and the two heaviest surfaces are a custom element and an imperative graph renderer under either runtime.                                                                     |
| Rsbuild or esbuild for the webview                                       | No measured advantage, and both lose Vite's CSS Modules, SVGR, and dev server. Open to revision if a measurement motivates it.                                                                                                 |
| Switching the extension host off rsbuild                                 | 2.35 s median for a 1 MB Node bundle. Nothing measured suggests a problem.                                                                                                                                                     |
| Zustand as the default store                                             | The repository has no store today. Adding one before a measured re-render problem is adding architecture. Retained as the named escape hatch.                                                                                  |
| Redux Toolkit retained                                                   | Used for `createSlice` sugar over `useReducer`, with no store, no `react-redux`, and no selectors. It supplies types and a factory function.                                                                                   |
| Keeping `@finos/perspective`                                             | Deprecated on npm with an explicit upgrade instruction, and `perspective-viewer-d3fc` is the sole path of a high-severity advisory that no other deletion clears.                                                              |
| Replacing Perspective outright                                           | It is the correct tool for a pivotable query result grid. The migration is large but bounded, and the spike sizes it.                                                                                                          |
| Writing a lineage renderer from scratch                                  | Layout is the hard part and ELK and dagre already solve it. The build is a renderer plus a layout engine.                                                                                                                      |
| Deleting the lineage panel                                               | Primary product surface. The dependency is the problem, not the feature.                                                                                                                                                       |
| Deleting the Python bridge assets in v1                                  | `DBTProject.validateSql` and `src/commands/index.ts` still call into it. The plan removes the callers at 7.1 and the bridge at 8.2; the asset copy goes with 8.2.                                                              |
| Deleting `media/images` wholesale                                        | It holds the manifest icon and 24 command and treeview icons. Pruning must be reference-driven.                                                                                                                                |
| Lowering `engines.vscode` below 1.128                                    | 1.128 is the intersection of the two hosts, not a compromise.                                                                                                                                                                  |
| Targeting the webview below Chromium 148                                 | The engine floor, VS Code 1.128.0, ships Electron 42.5.0 with Chromium 148. A lower target serves no admitted host.                                                                                                            |

## Confidence gaps

- **No activation or first-paint baseline exists**, so every latency row is unmeasured and every downstream target is a hypothesis. v1 step 14 establishes the control before v2 claims an improvement.
- **The UI runtime is undecided.** React 19 is provisional. A reader should not treat this document as having chosen a framework.
- **The lineage renderer is undecided**, and deliberately so. The graph-size and column-lineage inputs do not exist yet.
- **The Perspective 5 migration is unsized beyond the table above.** The custom datagrid plugin subclassing an internal element across a two-major jump is the most likely thing to fail, and the spike exists to find out before anything depends on it.
- **Build-time and payload improvements are unproven.** `vite:css-post` dominance is measured; that deleting generated CSS reduces it proportionally is not. No speedup is claimed.
- **Chromium parity across hosts is observed, not guaranteed.** The engine-floor derivation is sound today; Cursor's declared API version does not fix its Electron version, which is why the CI smoke test records the observed value on every run.
- **The 13 unreferenced SVG icons may be false positives.** A literal-name grep misses paths assembled from fragments; each must be confirmed before deletion.
- **Validator choice for the message contract is unbenchmarked.** Zod 4 is the availability-based default; `zod/mini` and Valibot need weighing against the 990 kB extension-host bundle.
- **The Playwright webview frame traversal is experimental twice over** — an experimental Playwright API over undocumented VS Code internals. Expect maintenance.
- **VS Code Elements has 38 components.** That is maintained, not comprehensive. A missing primitive should be met with local semantic markup, not a second component library.

## Proposed deltas to the canonical plan

Offered for the plan owner; [`../refactor/fusion-lsp-plan.md`](../refactor/fusion-lsp-plan.md) and [`../refactor/remaining-implementation.md`](../refactor/remaining-implementation.md) are not edited here.

1. **Add a VSIX asset-pruning step early.** Images are 83.5% of the compressed artifact and most are unreferenced. This is independent of every other step and no current step owns it.
2. **Add the onboarding and What's New panel deletions to the Phase 3 hosted-surface removals**, with the retained-`antd` replacement as an explicit prerequisite so the dependency removal is not blocked by one `noop` import.
3. **Add the vendored `webview_panels/src/lib/altimate/` deletion to Phase 3, as an ordered sub-sequence**: replace `CodeBlock`, delete `TeamMateProvider` and `ApiHelper`, delete the bundle, then prune the four dependencies it was keeping alive. Not a single-commit deletion.
4. **Reframe the 3.7 follow-ons.** The plan books React 19 before Tailwind 4, both behind a `@altimateai/ui-components` replacement. The measured reach of that dependency is five files, all lineage. Rebook as: delete the vendored surfaces → establish the per-panel entry seam → replace the lineage renderer → resolve the styling contract → apply the runtime decision. Tailwind 4 becomes conditional rather than scheduled.
5. **Record the compatibility ceiling as two ceilings.** API 1.128 for the extension host, and Chromium 148 for the webview, the latter derived from VS Code 1.128.0's Electron 42.5.0 rather than from installed builds. The webview ceiling is currently unstated and unset.
6. **Keep the Python bridge assets until step 8.2.** They are runtime-required through `DBTProject.validateSql` and `src/commands/index.ts` until 7.1 removes the callers. Any earlier deletion breaks SQL validation.
7. **Add a webview test layer.** 42 Jest suites and 3 integration files exist for the extension host; the webview has none. Vitest with Testing Library is what both reference extensions run, and the harness should exist before the panels are rewritten.
8. **Add a pinned VS Code 1.128.x smoke job plus a Cursor smoke job to CI**, the latter via Playwright's Electron launcher, which accepts any executable path. This closes the "no official Cursor test runner" gap the earlier research recorded as unresolved.
9. **Add VSIX size and image share to the release gate**, with the thresholds derived from the post-deletion measurement rather than chosen in advance.

## Sources

[^vscodenpmrc]: `microsoft/vscode` at tag `1.128.0`, `.npmrc`, <https://raw.githubusercontent.com/microsoft/vscode/1.128.0/.npmrc> — `target="42.5.0"`, `runtime="electron"`. The same file at tag `1.137.0` reads `target="42.10.0"`.

[^electron]: Electron release index, <https://releases.electronjs.org/releases.json>, retrieved 2026-09-20 — `42.5.0` → `chrome: 148.0.7778.271`, `node: 24.17.0`, released 2026-06-23; `42.10.0` → `chrome: 148.0.7778.280`, `node: 24.18.1`, released 2026-08-24. Corroborated locally by `strings` on the installed VS Code Electron framework binary yielding `Chrome/148.0.7778.280`.

[^vitebuild]: "Build Options", Vite documentation, <https://vite.dev/config/build-options> — `build.target` default `'baseline-widely-available'` resolving to `['chrome111','edge111','firefox114','safari16.4','ios16.4']`; `build.cssMinify` default `'lightningcss'`; `build.rollupOptions` deprecated in favour of `build.rolldownOptions`.

[^clinepkg]: `cline/cline` at commit `9a2512bb9835869d74774da99708a7f9d80b0fe8`, <https://raw.githubusercontent.com/cline/cline/9a2512bb9835869d74774da99708a7f9d80b0fe8/apps/vscode/webview-ui/package.json> — React 18.3, `tailwindcss` 4.1 with `@tailwindcss/vite`, Radix primitives, Vite 7.1, Vitest 3 with `@testing-library/react` and `jsdom`, Storybook 9. Its `vite.config.ts` at the same commit sets `build.target: "chrome122"` with an in-file comment deriving that floor from the oldest supported host runtime, and configures Vitest with `environment: "jsdom"`.

[^continuepkg]: `continuedev/continue` at commit `5522c6f44ca0ac3528b37244818fbfa39b5af470`, <https://raw.githubusercontent.com/continuedev/continue/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/package.json> — React 18.2, `@reduxjs/toolkit` 2.11 with `react-redux` 8 and `redux-persist`, `tailwindcss` 3.2, Vite 6.3, Vitest 3 with `@testing-library/react` and `jsdom`, `@vitejs/plugin-react-swc`.

[^react19]: "React v19", <https://react.dev/blog/2024/12/05/react-19> — "React 19 adds full support for custom elements and passes all tests on Custom Elements Everywhere."

[^vscodeelements]: `@vscode-elements/elements` 2.5.1 registry metadata, <https://registry.npmjs.org/@vscode-elements/elements/2.5.1> — `license: MIT`, `dependencies: { "lit": "^3.2.1", "@lit/context": "^1.1.3" }`, `peerDependencies: { "@vscode/codicons": ">=0.0.40" }`, `dist.unpackedSize` 2,022,392 across 551 files, `dist.integrity sha512-HiKgIj9GwlfYkw1LrxG7dM5bMQUr8/GkOqG1HU1+npGHd51nRKCF6ZZ9FtnfoC2wujNN0lc+m0emH/wMpAseYQ==`. The `lit` runtime dependency is the direct evidence that the library is Lit-based; there are no framework bindings in the package, so the published artefacts are plain custom element definitions. Source at the immutable tag commit for that release, <https://github.com/vscode-elements/elements/tree/57cc6d8ffa992ece53ae26cd4002b9e87a51bb41> (tag `v2.5.1`, tagged 2026-02-21), 38 component directories under `src/`. Component documentation: <https://vscode-elements.github.io/components/button/>.

[^webviewguide]: "Webview API", VS Code Extension API, <https://code.visualstudio.com/api/extension-guides/webview> — "`getState` and `setState` are the preferred way to persist state, as they have much lower performance overhead than `retainContextWhenHidden`"; "`retainContextWhenHidden` … has high memory overhead and should only be used when other persistence techniques will not work"; body classes `vscode-light` / `vscode-dark` / `vscode-high-contrast`; `--vscode-*` theme variables; `data-vscode-theme-id`.

[^clineui]: `cline/cline` at commit `9a2512bb9835869d74774da99708a7f9d80b0fe8`, <https://raw.githubusercontent.com/cline/cline/9a2512bb9835869d74774da99708a7f9d80b0fe8/sdk/packages/ui/package.json> — `exports` publishes `theme/tokens.css`, `theme/palette.css`, `theme/scoped-tokens.css`, `theme/base.css`, `theme/theme.css`, and per-component CSS alongside the components.

[^blocker]: [`../refactor/tailwind4-ui-components-blocker.md`](../refactor/tailwind4-ui-components-blocker.md) — Tailwind 4 `prefix(al)` emits `.al\:flex`, which cannot match the `al-flex` class strings baked into `@altimateai/ui-components`' published `dist`; the v4 spike produced an empty utilities layer.

[^clinetheme]: `cline/cline` at commit `9a2512bb9835869d74774da99708a7f9d80b0fe8`, <https://raw.githubusercontent.com/cline/cline/9a2512bb9835869d74774da99708a7f9d80b0fe8/apps/vscode/webview-ui/src/theme.css> — Tailwind 4 `@theme` block mapping `--color-background`, `--color-foreground`, `--color-button-*` and others directly onto `--vscode-*` custom properties.

[^twtheme]: "Theme variables", Tailwind CSS documentation, <https://tailwindcss.com/docs/theme> — `@theme` defines variables that generate utilities; `--color-*` namespace; `@theme { --*: initial; }` disables the default theme entirely.

[^pwelectron]: "Electron", Playwright documentation, <https://playwright.dev/docs/api/class-electron> — "Playwright has experimental support for Electron automation"; `electron.launch({ executablePath, args })`.

[^vscodepw]: `ruifigueira/vscode-test-playwright` at commit `6c9d97690c3d6273454b47c18a9e733c837c9f2c` (2025-05-31), <https://github.com/ruifigueira/vscode-test-playwright/tree/6c9d97690c3d6273454b47c18a9e733c837c9f2c> — combines `@vscode/test-electron` with Playwright fixtures (`workbox`, `evaluateInVSCode`). The `iframe.webview.ready` → `#active-frame` traversal is an observed VS Code implementation detail, not a documented API, and carries no compatibility guarantee. The reference is pinned because the traversal is the part most likely to change.

[^perspective]: `npm view @finos/perspective deprecated` returns "This package is no longer maintained. Please upgrade to @perspective-dev/client". "Perspective is joining the OpenJS Foundation! (and `v4.0.0`)", <https://github.com/perspective-dev/perspective/discussions/3077> — the `@finos` scope ends at 3.8.0; v4.0.0 released 2025-10-28. Project documentation: <https://perspective-dev.github.io/guide/>. Package layout read from `npm view @perspective-dev/client exports dependencies` at 5.5.1.

[^perspectivecharts]: "Rename `@perspective-dev/viewer-charts`, add missing chart types", <https://github.com/perspective-dev/perspective/pull/3166> — `viewer-d3fc` deleted in favour of `@perspective-dev/viewer-charts` at 4.5.0, described as "a compatible superset of its predecessor's API, though it has a new name and internals".

[^uxguidelines]: "Webviews", VS Code UX Guidelines, <https://code.visualstudio.com/api/ux-guidelines/webviews> — "Only use webviews when absolutely necessary"; Don't "Use for wizards"; Don't "Open on extension updates (ask via a Notification instead)"; Don't "Use for promotions".

Package versions and download counts came from the npm registry and `https://api.npmjs.org/downloads/point/last-week/<package>` retrieved 2026-09-20; that endpoint is relative to the request date, so any figure quoted from it is only reproducible with a dated `https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/<package>` range query. Repository metadata came from the GitHub REST API on the same date. All local measurements used the commands stated inline, on the hardware and toolchain recorded under "Method".
