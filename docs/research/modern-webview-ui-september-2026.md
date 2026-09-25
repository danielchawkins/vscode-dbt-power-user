# Modern webview UI, September 2026

Research artifact. It evaluates what React 19.3 and Tailwind CSS 4.3 offer `webview_panels`, and what maintained VS Code webview repositories actually do, against measured facts about this repository rather than a feature catalog. It does not change the canonical plan; the last section proposes a delta an orchestrator can apply after review.

Scope: `webview_panels/` only. The extension host bundle has no React and no CSS pipeline. Out of scope: rewriting [`fusion-lsp-plan.md`](../refactor/fusion-lsp-plan.md) or [`remaining-implementation.md`](../refactor/remaining-implementation.md), and any change to product code.

Companion research: [`vscode-extension-development-september-2026.md`](vscode-extension-development-september-2026.md) sets the platform baseline and the webview security contract this document builds on, with its evidence in [`vscode-extension-development-september-2026-sources.md`](vscode-extension-development-september-2026-sources.md) and its recommendations in [`vscode-extension-development-september-2026-guidance.md`](vscode-extension-development-september-2026-guidance.md).

## 1. Grounding

Honored decisions:

- [`0001-local-fusion-only-product.md`](../adr/0001-local-fusion-only-product.md) — no hosted services, no AI, no telemetry, no account. This decides several dependency questions below on its own.
- [`0002-use-the-native-fusion-lsp.md`](../adr/0002-use-the-native-fusion-lsp.md) — panels survive; their metadata producer changes. Webview work must not assume panels are being rewritten.
- [`tailwind4-ui-components-blocker.md`](../refactor/tailwind4-ui-components-blocker.md) — `@altimateai/ui-components` bakes v3-prefixed class strings into published dist JS. Its prohibitions are treated as binding: no patching `node_modules`, no compatibility generator for v3 class strings, no declaring success from a green build.
- [`remaining-implementation.md`](../refactor/remaining-implementation.md) — step 3.7 `chore/latest-majors` and the booked follow-on PRs before Phase 4; Phase 8.4 prunes the webview bundle; Phase 8.5 rewrites the walkthrough and setup-wizard surface.

Versions verified against the npm registry on this machine, not assumed:

| Package                       | Repository baseline | Current `latest` |
| ----------------------------- | ------------------- | ---------------- |
| `react` / `react-dom`         | `^18.3.1`           | `19.3.0`         |
| `@types/react`                | `^18.3.31`          | `19.3.0`         |
| `tailwindcss`                 | `^3.4.19`           | `4.3.3`          |
| `babel-plugin-react-compiler` | absent              | `1.0.0`          |
| `eslint-plugin-react-hooks`   | `^7.1.1`            | `7.1.1`          |

`tailwindcss` still publishes a `v3-lts` tag pointing at `3.4.19`, so the current pin is the supported end of the v3 line rather than a stale version.

### Feature attribution

Misattribution is the main hazard in this area, so features are bound to the release that shipped them.

| Release                      | Shipped                                                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React 19.0 (Dec 2024)        | Actions, `useActionState`, `useFormStatus`, `useOptimistic`, `use`, `ref` as a prop, ref cleanup functions, `<Context>` as provider, document metadata, stylesheet and async script hoisting, resource preloading, custom element support, hydration error diffs |
| React 19.1 (Mar 2025)        | Owner Stacks and `captureOwnerStack`, development builds only                                                                                                                                                                                                    |
| React 19.2 (Oct 2025)        | `<Activity>`, `useEffectEvent`, Performance Tracks, `cacheSignal` (Server Components), Partial Pre-rendering                                                                                                                                                     |
| React 19.3 (Sep 2026)        | `<ViewTransition>` and Fragment Refs promoted to stable, `browser()`, Trusted Types support                                                                                                                                                                      |
| React Compiler (independent) | `babel-plugin-react-compiler@1.0.0`, a separate Babel plugin, not part of any React release                                                                                                                                                                      |
| Tailwind 4.0 (Jan 2025)      | New engine, CSS-first `@theme` configuration, automatic source detection and `@source`, built-in `@import` handling, Lightning CSS vendor prefixing, first-party Vite plugin, container queries in core, prefix-as-variant, 3D transforms, expanded gradients    |

React Compiler is not a React feature. It is a build-time Babel plugin that reached 1.0 independently, works best with React 19 but also supports 17 and 18, and is adopted separately from any version bump.

## 2. The reframing

Two measured facts shrink this work more than any individual feature would.

**Tailwind has no owned consumer in this repository.** A token scan of all 141 owned TypeScript and TSX files plus 36 owned stylesheets finds exactly two `al-` tokens: `al-bg-background`, which appears only inside an explanatory comment in `tailwind-globals.css`, and `al-tw-scope`, which is a hand-written scope class in that same file rather than a generated utility. Zero `@apply`, zero `@tailwind base`, zero container queries, zero generated utility classes in owned markup. Owned styling is 36 SCSS modules and Bootstrap. Tailwind's entire job here is generating the 512 `.al-*` selectors that `@altimateai/ui-components` dist JS references at runtime in the lineage panel.

The consequence: this is not a styling-system upgrade for owned code. Tailwind here is a **build-time generator serving a dependency**, and the blocker document's revisit checklist — "migrate owned markup to `al:*`" — has a measured answer of "nothing to migrate". That changes what the upgrade *is*, but it does not by itself make deletion the right answer. Tailwind's fate follows the replacement component library's styling contract, which is not yet known. Until it is, Tailwind 3 generation must be preserved: it is currently the only thing producing the 512 selectors the lineage panel depends on. Section 4 sets out the practice that decides this, and L1 states the rule.

The repository's Tailwind setup is **hybrid**, and one half of it is debt. The generated half is normal: `tailwind.config.ts` scans `@altimateai/ui-components` dist JS and regenerates utilities on every build, which is the same shape as Cline scanning `@heroui/theme/dist`. The other half is not: `src/modules/lineage/tailwind-globals.css` is 384 lines of Tailwind 3 Preflight **manually copied out of Tailwind's source and hand-adapted**, with `theme()` calls replaced by resolved values and every selector rewritten to `:where(.al-tw-scope)`. Its own header comment records this. That file is hand-maintained output: it cannot be regenerated, it silently diverges from whatever Tailwind version the generator runs, and its specificity reasoning has to be re-derived by hand on every change. Neither Cline nor Continue maintains such a file. Treat it as existing debt to retire during whichever Tailwind path L1 selects — not as a reason to keep or drop Tailwind.

**The React 19 peer blocker is mostly a vendored blob, not a dependency to replace.** [`remaining-implementation.md`](../refactor/remaining-implementation.md) names `@altimateai/ui-components` and `@ant-design/pro-chat` as the React 19 blockers. Measured peer ranges refine that:

| Package                     | Declared React peer range | Owned consumers                              |
| --------------------------- | ------------------------- | -------------------------------------------- |
| `@altimateai/ui-components` | `^17.0.0 \|\| ^18.0.0`    | 5 files, lineage panel                       |
| `@ant-design/pro-chat`      | `^18`                     | **none**                                     |
| `formik`                    | —                         | **none**                                     |
| `antd-style`                | —                         | **none**                                     |
| `antd`                      | `>=16.9.0`                | 6 files, all under `src/modules/onboarding/` |
| `reactstrap`                | `>=16.8.0`                | 7 files                                      |
| `react-select`              | `… \|\| ^19.0.0`          | already declares 19                          |
| `react-error-boundary`      | `^18.0.0 \|\| ^19.0.0`    | already declares 19                          |
| `react-hook-form`           | `… \|\| ^19`              | already declares 19                          |

`@ant-design/pro-chat`, `formik`, and `antd-style` have zero imports in owned source. Their only importer is `webview_panels/src/lib/altimate/`, a 3.7 MB vendored prebuilt bundle (`main.js` 45,781 lines, `DbtDocsRenderer.js` 47,464 lines, `main.css` 182 KB) exposed through the `@lib` alias. It has exactly three owned consumers:

- `src/App.tsx` — `TeamMateProvider`, the Altimate AI teammate shell.
- `src/modules/app/AppProvider.tsx` — `ApiHelper`, whose `get` and `post` are reassigned to route hosted API calls through the webview message bridge.
- `src/uiCore/components/codeblock/index.tsx` — `CodeBlock`, behind a thin wrapper that 8 owned files consume.

Two of the three are hosted-capability surfaces that ADR 0001 removes regardless of React. The third is a syntax-highlighted code block, and `react-code-blocks@^0.1.6` and `react-syntax-highlighter@^16.1.1` are **already declared dependencies with zero owned usage** — the replacement is installed and unused.

So the React 19 blocker decomposes into one genuine replacement (`@altimateai/ui-components`, lineage only) and one deletion (`@lib`, which orphans three React 18-pinned packages). That deletion is already implied by ADR 0001 and Phase 8.4 but is not named anywhere in the plan.

## 3. Measured baseline

All counts exclude the vendored `src/lib/`.

| Signal                                                     | Count                                           |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Owned TS/TSX files / lines                                 | 141 / 13,523                                    |
| Owned SCSS and CSS files                                   | 36                                              |
| `JSX.Element` annotations / files                          | 139 / 97                                        |
| `useEffect`                                                | 56                                              |
| `useMemo` / `useCallback` / `React.memo`                   | 20 / 15 / **0**                                 |
| `forwardRef` files                                         | 5 (3 `uiCore`, 2 onboarding)                    |
| `useImperativeHandle`                                      | 3                                               |
| `createContext` / `.Provider` JSX pairs                    | 3 / 3                                           |
| `window.addEventListener("message")` effects               | 7                                               |
| `<form onSubmit>` elements                                 | 2                                               |
| `react-hook-form` consumers                                | 5                                               |
| Boolean loading/pending `useState`                         | 36, of which 4 are named `isLoading`/`isSaving` |
| `createPortal`                                             | 0                                               |
| `useRef()` with no argument                                | 0                                               |
| `propTypes` / `defaultProps` / string refs / `findDOMNode` | 0                                               |
| `eslint-disable` for `react-hooks`                         | 0                                               |
| Stories / unit tests                                       | 8 / **0**                                       |

Build configuration: Vite `^8.3.0` with `@vitejs/plugin-react@^6.1.1`, `cssMinify: "esbuild"`, `cssCodeSplit: false`, `build.rollupOptions`, PostCSS with `tailwindcss` and `autoprefixer`.

The zero in the test row is the single most important number for sequencing. There are no unit tests in `webview_panels`, only 8 Storybook stories, and the regression guard for the lineage panel is `scripts/workspace/check-webview-tailwind-css.sh` asserting selector counts in built CSS. Any behavioral React refactor here is unverified by construction.

## 4. VS Code extension and webview practice

This section establishes what maintained VS Code webview repositories actually do, because the Tailwind question above cannot be settled from Tailwind's own documentation. Sources retrieved 2026-09-20.

### The platform contract this repository already meets

[`vscode-extension-development-september-2026.md`](vscode-extension-development-september-2026.md) sets the baseline: prefer native editor UI, and where a webview is necessary, restrict local resources, use a nonce-based CSP, validate messages, and persist with `getState`/`setState`. The official [webview guide](https://code.visualstudio.com/api/extension-guides/webview) states the mechanics — a webview cannot read local files directly, so every asset must go through `Webview.asWebviewUri`; `localResourceRoots` "defines a set of root URIs from which local content may be loaded"; and a policy should start at `default-src 'none'` and re-enable only what is needed, using `webview.cspSource`. The [UX guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews) add "Only use webviews when absolutely necessary".

This repository already satisfies the mechanical part: 24 `asWebviewUri` call sites, 2 CSP declarations, 2 `localResourceRoots`, 9 nonce usages. Nothing in this document proposes changing that wiring. Two observations are in scope. First, `retainContextWhenHidden` appears at 6 sites and the official guide warns it "has high memory overhead"; that is a pre-existing item for a panel-lifecycle review, not for this work. Second, and directly relevant: `src/webview_provider/docsEditPanel.ts` resolves `assets/main.css` through `asWebviewUri`. **That file is Tailwind's build output.** The generated CSS is a shipped webview asset, which is why the generator cannot simply be switched off while a consumer still needs it.

Microsoft's Webview UI Toolkit is archived — "there are sadly no plans to continue the maintenance of this project" ([`microsoft/vscode-webview-ui-toolkit#561`](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561)). Do not adopt it, and do not treat it as the reference for VS Code-native styling. The companion guidance reaches the same conclusion.

### How maintained React webviews build CSS

Two representative, actively maintained extensions, read from their primary files rather than summaries.

| Aspect               | Cline (`apps/vscode/webview-ui`)                                                                                                                                          | Continue (`gui`)                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Tailwind             | `tailwindcss@^4.1.13` with [`@tailwindcss/vite`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/vite.config.ts)                                          | `tailwindcss@^3.2.7` via PostCSS with `autoprefixer`                                                              |
| Configuration style  | CSS-first: [`@theme` / `@theme inline` in `src/theme.css`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/theme.css)                                 | JS config: [`gui/tailwind.config.cjs`](https://github.com/continuedev/continue/blob/main/gui/tailwind.config.cjs) |
| Theming              | `--color-*` mapped to `var(--vscode-*)`; font sizes derived from `var(--vscode-font-size)`                                                                                | `varWithFallback(...)` mapped to VS Code theme colors; breakpoints tuned to sidebar widths from 170 px            |
| Preflight            | Full `@import "tailwindcss"`, then a deliberate `@layer base` re-asserting element defaults                                                                               | **Disabled outright**: `corePlugins: { preflight: false }`                                                        |
| Dependency scanning  | [`tailwind.config.mjs`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/tailwind.config.mjs) declares `./node_modules/@heroui/theme/dist/**` in `content` | `content` is owned source only                                                                                    |
| Third-party CSS      | Imports published CSS it does not own: `@vscode/codicons/dist/codicon.css`, `@fontsource-variable/geist-mono`                                                             | —                                                                                                                 |
| Generated CSS in VCS | None                                                                                                                                                                      | None                                                                                                              |

Cline's [`src/index.css`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/index.css) names the reason for its base layer directly: "This ensures all the elements are rendered with the expected styles consistently without affecting by the parent element / host." So the two repositories take the two available positions on Preflight — Continue removes it, Cline keeps it and then explicitly re-asserts the element defaults against the host — and **neither hand-maintains a copied Preflight file**. That is the practice `tailwind-globals.css` departs from.

One nuance, stated so it is not over-read: Cline's `tailwind.config.mjs` is a Tailwind 3-era file, and its v4 CSS entry contains no `@config` directive, so the live configuration is the CSS-first one. The `content` array remains useful evidence that scanning a dependency's `dist` is an ordinary thing for a VS Code webview to do; it is not evidence about how Cline resolves HeroUI today.

### The practice, stated precisely

1. **Tailwind runs during every webview build.** Cline invokes it as a Vite plugin, Continue as a PostCSS plugin, this repository as a PostCSS plugin. The compiler package is a build-time dependency and does not need to ship in the VSIX. Its *output* does ship: the generated utilities land in the bundled webview stylesheet that the extension host serves through `asWebviewUri`.
2. **Configuration and utility classes are authored in source; output is regenerated.** Both repositories commit a config and a CSS entry, and commit no generated CSS. Nothing is vendored to stand in for a supported package.
3. **A third-party library may legitimately publish and own its compiled CSS.** Cline imports `@vscode/codicons/dist/codicon.css`; this repository imports `@altimateai/ui-components/styles.css`. The library owns that file, ships it, and maintains it. This is categorically different from a repository copying generated CSS into its own tree and inheriting the maintenance.
4. **This repository is hybrid, and only one half is normal.** Scanning `@altimateai/ui-components` dist JS and regenerating utilities each build matches Cline's pattern and is fine. `tailwind-globals.css` — hand-adapted Tailwind 3 Preflight with resolved `theme()` values and rewritten selectors — is generated output under manual maintenance. It is debt and a divergence risk, and it is the one piece of the current setup with no counterpart in either reference repository.
5. **Never hand-port or vendor generated utility output.** This extends the blocker document's existing prohibitions on patching `node_modules` and on writing a v3-class compatibility generator. Producing the 512 `.al-*` selectors by any means other than running a supported Tailwind release is out of bounds, whatever the replacement turns out to need.
6. **Preflight must be disabled or deliberately scoped in a webview.** Both reference repositories do one or the other, because Preflight's reset otherwise fights the host's styles. This repository's scoping instinct is correct; its *implementation* — a hand-copied file — is what needs to change. Under Tailwind 3 the supported form is `corePlugins: { preflight: false }` plus owned base rules, as Continue does. Under Tailwind 4 there is no `corePlugins`; the supported form is importing the layers selectively rather than copying Preflight into the repository.

### What this decides

Preserve Tailwind 3 generation until the lineage replacement's styling contract is known. Then exactly one of:

- **The replacement owns and ships its own compiled CSS, and no remaining consumer needs utility generation** — delete Tailwind, its config, the PostCSS entry, `tailwind-globals.css`, and the selector guard together.
- **Any consumer still needs generated utilities** — migrate the generator to Tailwind 4, retiring `tailwind-globals.css` into supported configuration rather than carrying the hand-copied file forward.

The determining question is the replacement's styling contract, not the absence of owned utility classes. That absence tells us Tailwind is not an authoring system here; it does not tell us whether a consumer still needs the generator.

## 5. Fold into the current refactor

Low-risk, bounded, and attachable to work the plan has already booked. Ordered by value per unit of risk.

### F1 — Delete the vendored `@lib` bundle and its orphaned React 18 dependencies

**Insertion point:** a new PR in the "booked as own PRs before Phase 4" list, immediately **before** the React 19 PR. Rationale below makes it a prerequisite, not a parallel item.

**Files:** delete `webview_panels/src/lib/` (3.7 MB, 93,282 lines across `main.js`, `DbtDocsRenderer.js`, `main.css`, `altimate-components.{js,d.ts}`). Remove the `@lib` alias from `vite.config.ts`. Rewrite three consumers: drop `TeamMateProvider` from `src/App.tsx`; delete the `ApiHelper.get` / `ApiHelper.post` reassignment in `src/modules/app/AppProvider.tsx`; reimplement `src/uiCore/components/codeblock/index.tsx` on the already-installed `react-code-blocks` or `react-syntax-highlighter`. Drop `@ant-design/pro-chat`, `formik`, and `antd-style` from `webview_panels/package.json`. Update `src/modules/documentationEditor/DocumentationEditor.stories.tsx`, which imports `TeamMateProvider`.

**Seam:** `CodeBlockComponent`'s existing prop interface (`code`, `language`, `fileName`, `showLineNumbers`, `titleActions`, `classname`) is the contract. Keep it byte-identical so the 8 consuming files are untouched. The one adjustment is `language`, currently typed as `Parameters<typeof CodeblockLib>[0]["language"]`, which must become an explicit union.

**Benefit:** removes the only React 18 peer pin that has no owned consumer, cutting the React 19 blocker roughly in half. Removes a hosted-API shim and an AI provider that ADR 0001 deletes anyway. Removes 3.7 MB of vendored source from the repository and its bundle contribution.

**Verification:** `just check` and `just package` green. `grep -rn "@lib" webview_panels/src` empty. Compare VSIX size before and after and record it in the commit message, matching the Phase 8.4 convention. Confirm the 8 code-block consumers render in the Storybook stories that cover them.

**Why bounded:** three import sites, one prop interface preserved, one alias removed. No panel logic changes. The deletions are all things ADR 0001 already requires.

### F2 — Adopt `ref` as a prop and drop `forwardRef` in `uiCore`

**Insertion point:** inside the booked React 19 PR, after F1.

**Files:** `src/uiCore/components/stack/Stack.tsx`, `src/uiCore/components/drawer/index.tsx`, `src/uiCore/components/popoverWithButton/PopoverWithButton.tsx`. The two onboarding files — `SetupWizard.tsx` and `PrerequisitesStep.tsx` — are excluded deliberately; Phase 8.5 rewrites the setup-wizard surface, so touching them now is work that gets deleted.

**Seam:** React 19 lets function components take `ref` as an ordinary prop, so `forwardRef` becomes unnecessary. `Stack.tsx` is the trivial case and converts to a plain component with a `ref` prop. `drawer` and `popoverWithButton` keep their `useImperativeHandle` and their exported handle types (`DrawerRef` and the popover equivalent) unchanged, because callers such as `PerspectiveViewer.tsx` depend on them.

**Benefit:** removes one wrapper layer from three shared components. React states `forwardRef` will be deprecated and later removed, so this is scheduled work either way.

**Verification:** `just check`. The existing stories exercise `drawer` and `popoverWithButton`; confirm the Perspective drawer still opens from `drawerRef.current?.open()`.

**Why bounded:** three files, exported handle types unchanged, callers untouched.

### F3 — Adopt `<Context>` as provider

**Insertion point:** inside the booked React 19 PR.

**Files:** `src/modules/app/AppProvider.tsx`, `src/modules/queryPanel/QueryPanelProvider.tsx`, `src/modules/documentationEditor/DocumentationProvider.tsx` — three JSX pairs, six lines.

**Seam:** `<AppContext.Provider>` becomes `<AppContext>`. No consumer changes; `useContext` is unaffected.

**Benefit:** small and mechanical. Listed only because it is on the shortest path and the diff is six lines. It carries no performance claim.

**Verification:** `just check`.

### F4 — Scope the `JSX` namespace

**Insertion point:** inside the booked React 19 PR. This is migration cost, not an opportunity, and is listed so it is not discovered mid-PR.

**Files:** 139 `JSX.Element` annotations across 97 files — roughly two thirds of all owned TSX files.

**Seam:** `@types/react@19` no longer declares a global `JSX` namespace; it lives under `React.JSX`. The `types-react-codemod` package (`3.5.3`) ships a `scoped-jsx` transform for exactly this. Run the codemod rather than editing 97 files by hand, and review the diff for the `perspective.d.ts` `declare global` block, which augments `CustomElementRegistry` and is the one file where a codemod could plausibly get it wrong.

**Benefit:** none on its own. It is the largest mechanical item in the React 19 bump and the main reason that PR should not also carry behavioral change.

**Verification:** `just check` — `tsc` is the whole test here, and with zero unit tests it is the only one available.

### F5 — Delete the `cssMinify` override and migrate `rollupOptions`

**Insertion point:** the booked React 19 PR or `chore/latest-majors`, whichever touches `webview_panels/vite.config.ts` first. Independent of Tailwind.

**Files:** `webview_panels/vite.config.ts`.

**Seam:** Vite 8 documents `build.cssMinify` as defaulting to `'lightningcss'`, and `build.rollupOptions` as a deprecated alias of `build.rolldownOptions`. This repository explicitly sets `cssMinify: "esbuild"`, so adopting Lightning CSS is deleting one line rather than adding configuration. Both changes are one-line edits.

**Benefit:** removes a stale override and a deprecated option name. Resolves item 6 of the blocker document's revisit checklist ahead of Tailwind rather than as part of it, since the setting has nothing to do with Tailwind's version.

**Verification:** `just webviews::build`, then `scripts/workspace/check-webview-tailwind-css.sh` on the emitted `main.css` — the guard already runs at the end of that build and will catch a minifier that mangles the `.al-*` selectors. Record the `main.css` byte size against the recorded 1,281,908-byte baseline.

**Why bounded:** two lines, and the existing regression guard is precisely the check this change needs. Do this as a separate commit from any Tailwind work so a CSS regression has one candidate cause.

### F6 — Drop `autoprefixer` when Tailwind 4 lands, not before

**Insertion point:** whichever PR resolves the Tailwind question (see L1). Recorded here because the upgrade guide names it and it is easy to do prematurely.

**Files:** `webview_panels/postcss.config.mjs`, `webview_panels/package.json`.

**Seam:** Tailwind 4 uses Lightning CSS internally for vendor prefixing and bundles `@import` handling, so the upgrade guide directs removing `autoprefixer` and `postcss-import`. Under Tailwind 3 the plugin is still doing real work, and this repository has 36 owned stylesheets that are not Tailwind's output. Removing `autoprefixer` while on v3 would silently drop prefixing for owned SCSS.

**Verification:** only meaningful alongside the v4 decision; deferred to L1.

## 6. Schedule later

Cross-cutting work that needs its own design, measurement, or a prerequisite that does not exist yet.

### L1 — Decide Tailwind's fate when `@altimateai/ui-components` is replaced

**Why not now:** blocked by the same dependency as everything else in [`tailwind4-ui-components-blocker.md`](../refactor/tailwind4-ui-components-blocker.md), and the decision is not the one the blocker document frames.

**Prerequisite:** a replacement for the lineage rendering currently supplied by `@altimateai/ui-components/lineage`. That replacement is itself unscoped — three owned lineage files import `Table`, `Button`, `CollectColumn`, `ApiHelper`, `Lineage`, and `styles.css` from it (the `ColumnLineage` importer left with documentation propagation), and Phase 7.5 rebuilds the lineage panel on `dbt.listNodes` and `dbt.getCurrentNode` anyway. Sequencing the package replacement with Phase 7.5 rather than before Phase 4 deserves explicit consideration; doing it twice is the waste to avoid.

**Hold until then:** keep Tailwind 3 generating. It is the only producer of the 512 `.al-*` selectors the lineage panel needs, and that output ships as a webview asset. Zero owned utility classes means Tailwind is not an authoring system here; it does not mean the generator is unused. Do not remove, disable, or downgrade the generator before the replacement's styling contract is established.

**The decision, once the contract is known.** Inspect the replacement's published `dist` using the method the blocker document already used — count the utility selectors actually present in its shipped CSS — then take exactly one branch:

- **The replacement owns and ships its own compiled CSS, and no remaining consumer needs generated utilities** → delete Tailwind. That removes `tailwind.config.ts` (123 lines), `tailwind-globals.css` (384 lines), the `tailwindcss` and `autoprefixer` dependencies, the PostCSS config, and `scripts/workspace/check-webview-tailwind-css.sh` with its `just webviews::build` hook, as one change.
- **Any consumer still needs generated utilities** → migrate the generator to Tailwind 4. Retire `tailwind-globals.css` into supported configuration in the same change; do not carry the hand-copied Preflight forward into v4, where `corePlugins` no longer exists.

Both branches are legitimate. The determining input is the replacement's styling contract, not the absence of owned utilities.

**Binding constraint on either branch:** never hand-port or vendor generated utility output. The `.al-*` selectors come from running a supported Tailwind release or they do not exist. This extends the blocker document's prohibitions on patching `node_modules` and on a v3-class compatibility generator, and it is why "delete Tailwind" is only available when nothing needs the output — not as a way to stop maintaining the generator while keeping its results.

**Likely files:** `webview_panels/tailwind.config.ts`, `postcss.config.mjs`, `src/modules/lineage/tailwind-globals.css`, `src/modules/lineage/LineageView.tsx`, `ActionWidget.tsx`, `components/help/HelpButton.tsx`, `scripts/workspace/check-webview-tailwind-css.sh`, root `justfile`.

**Success criteria:** the lineage panel renders identically to the recorded Tailwind 3 baseline — 512 `.al-*` selectors is the v3 metric, but under removal the right assertion changes shape, so the guard must be rewritten or retired deliberately rather than left asserting a metric the new world cannot satisfy. Record `main.css` byte size against 1,281,908. Visual comparison of the lineage panel in both themes.

**Why not a v3-to-v4 port in place:** the blocker document already proved it produces a green build with one utility selector. Nothing in this research changes that, and its prohibitions on patching `node_modules` and on a compatibility generator stand.

### L2 — React Compiler evaluation

**Why not now:** it is a behavioral change to every component with no test suite to catch a regression, and its payoff is small here. The repository has 20 `useMemo`, 15 `useCallback`, and **zero** `React.memo` across 13,523 lines. Zero `React.memo` is the tell: nobody has found re-rendering costly enough to memoize a component. The compiler's value is proportional to manual memoization it can replace and re-renders it can avoid, and both signals are weak.

**Prerequisites, in order:** (1) `webview_panels` has unit tests, currently zero; (2) React 19 has landed; (3) `eslint-plugin-react-hooks` compiler rules run clean — the repository already has `^7.1.1` installed, so the `recommended-latest` preset can be enabled and its findings read as a free pre-assessment before any build change; (4) a measured render-performance problem exists.

**Likely files:** `webview_panels/vite.config.ts`, `webview_panels/package.json`, `eslint.config` for the webview. With `@vitejs/plugin-react@6`, the inline Babel option was removed, so setup requires `@rolldown/plugin-babel` plus `reactCompilerPreset`, adding a Babel pass to a Vite 8 build that currently has none. That cost is real and is a reason to defer rather than a reason to refuse.

**Success criteria:** a recorded before-and-after profile of the query-results panel rendering a large result set, using React 19.2 Performance Tracks, showing a measurable improvement; build time regression under an agreed ceiling; no component requiring a `"use no memo"` escape hatch.

**Why not now, restated:** adopting it would be speculative optimization against an unmeasured problem.

### L3 — `useEffectEvent` for the message-bridge and Perspective effects

**Why not now:** these are the effects most likely to hide a latent bug, and there is no test to prove a rewrite is equivalent.

**Prerequisite:** unit tests for the webview message bridge, and React 19.2 or later.

**Likely files:** the 7 files with `window.addEventListener("message")` effects (`src/modules/app/useListeners.ts`, `src/modules/queryPanel/useQueryPanelListeners.ts`, `src/modules/documentationEditor/DocumentationProvider.tsx`, `src/modules/documentationEditor/components/tests/hooks/useTestFormSave.ts`, `src/modules/defer/DeferToProduction.tsx`, `src/modules/onboarding/Onboarding.tsx` and `PrerequisitesStep.tsx`), plus `src/modules/queryPanel/components/perspective/PerspectiveViewer.tsx`.

`PerspectiveViewer.tsx` is the strongest single case and the clearest evidence that this is real rather than stylistic. Its mount effect has an empty dependency array while closing over `data`, `columnNames`, `columnTypes`, `theme`, and `config`; its second effect declares `[theme, tableRendered]` while reading `config`, which is rebuilt on every render. Inside `loadPerspectiveData`, the sequence `exportButton.removeEventListener("click", downloadAsCSV)` followed by `addEventListener` cannot deduplicate, because `downloadAsCSV` is a new function identity on every render — the remove is a no-op against any previously attached handler. `useEffectEvent` addresses exactly this shape: the CSV export and the config-update handler are events fired from an effect, not reactive dependencies of it.

Notably there are **zero** `eslint-disable` comments for `react-hooks` in owned source, so these dependency arrays are currently accepted by the linter rather than suppressed. That makes the mismatch quieter and more worth fixing deliberately than opportunistically.

**Success criteria:** every effect's dependency array is complete and lint-clean without suppression; the CSV export handler is provably attached once; switching themes does not reload the Perspective table.

### L4 — Fragment Refs for the Perspective and lineage DOM reach-throughs

**Why not now:** React 19.3 stabilized Fragment Refs three weeks before this research, the affected code is the most intricate in the webview, and the benefit is structural rather than behavioral.

**Prerequisite:** React 19.3, L3 completed, and the Phase 7.4 and 7.5 panel rebases settled — rewriting DOM plumbing under panels that are about to be re-sourced is wasted motion.

**Likely files:** `src/modules/queryPanel/components/perspective/PerspectiveViewer.tsx` and `PerspectivePlugins.ts`, `src/modules/lineage/ActionWidget.tsx`.

The candidate pattern is real: `PerspectiveViewer.tsx` reaches through `perspectiveViewerRef.current?.querySelector(...)?.shadowRoot?.querySelector("regular-table")` to set attributes, and `ActionWidget.tsx` renders five empty `<div id="…-container" className="al-tw-scope" />` placeholders that exist purely so third-party code can find mount points. Fragment Refs provide `addEventListener`, `observeUsing`, and focus management over a group of children without adding wrapper elements. Whether that is better than the current placeholders depends on what replaces `@altimateai/ui-components`, which is L1's question.

**Success criteria:** shadow-DOM attribute manipulation and the placeholder divs are replaced by a documented ref contract, with the lineage panel visually unchanged.

### L5 — A webview test suite

**Why not now:** it is not a React 19 or Tailwind 4 feature. It is listed because L2, L3, and L4 each name it as a prerequisite, and nothing in the plan currently books it.

**Likely files:** a new `webview_panels/src/test/` or per-module colocated tests, plus the test-runner choice. The root suite is Jest with `ts-jest`; the webview builds with Vite 8, where Vitest is the lower-friction option. That divergence is a genuine decision, not a detail.

**Success criteria:** the message bridge, `QueryPanelProvider` reducer, and the `CodeBlock` seam from F1 have tests; a `just` recipe runs them; `just check` includes them.

## 7. Do not adopt

Each of these is a real React 19 or Tailwind 4 feature that is wrong for this codebase. Newer is not the argument.

- **Server rendering features in every form** — Partial Pre-rendering, `resume`, `resumeAndPrerender`, `prerender`, `renderToReadableStream`, Suspense boundary batching for SSR, `onBrowserBailout`, and `cacheSignal`. `src/main.tsx` calls `ReactDOM.createRoot` on a static HTML shell inside a VS Code webview. There is no server, no hydration, and no stream. Improved hydration error messages and hydration diffs are in the same category: there is no hydration to report on.
- **`browser()` and `use(browser())`** — React 19.3's mechanism for opting a subtree out of server rendering. Every component here is browser-only already.
- **Server Components, Server Actions, and `<Context>` in Server Components** — no server.
- **Document metadata hoisting (`<title>`, `<meta>`, `<link>`)** — a webview has no meaningful document head, no SEO, and no crawler.
- **Resource preloading (`preload`, `preinit`, `prefetchDNS`, `preconnect`)** — assets are bundled into a single local CSS file and a local JS bundle loaded from disk by the extension host. There is no network round trip to optimize and no DNS to prefetch.
- **Stylesheet and async script hoisting via `<link rel="stylesheet" precedence>`** — the build already produces one `main.css` with `cssCodeSplit: false`. Introducing runtime stylesheet ordering would add a mechanism where a build-time guarantee exists.
- **React Actions, `useActionState`, and `useFormStatus`** — see the verdict table; rejected on code evidence rather than on principle.
- **`useOptimistic`** — same.
- **`<Activity>`** — the panels are separate webviews, each with its own root, created and destroyed by the extension host. There is no in-app navigation whose state is worth preserving across a hidden subtree. `AppRoutes` selects a panel at mount, not through user navigation.
- **`<ViewTransition>` and `addTransitionType`** — animated route transitions in a VS Code side panel. No user need, and it would fight the host's own UI conventions.
- **Trusted Types support** — React 19.3 stops coercing Trusted Types objects to strings so a `require-trusted-types-for 'script'` CSP works. The extension sets no such CSP and injects no HTML through Trusted Types sinks. Nothing to enable.
- **Tailwind prefix-variant migration (`al-flex` to `al:flex`)** — the blocker document established this does not fix the mismatch, because the DOM classes come from published dist JS. With zero owned utilities there is additionally nothing on our side to migrate.
- **Tailwind container queries, 3D transforms, modern color and gradient utilities, `@starting-style`, `not-*`, `@utility`, `@custom-variant`** — all real v4 improvements with zero owned call sites. Owned styling is SCSS modules with 41 CSS custom properties and 24 VS Code theme variables; 11 media queries and no container queries. Adopting these *as an authoring style* means first writing Tailwind utilities that do not currently exist, which is a styling-system migration nobody has asked for. This is separate from `@theme`, which L1's migrate branch requires as configuration rather than as authoring.
- **Tailwind automatic source detection** — v4's headline configuration win removes the `content` array. This repository's `content` array exists specifically to scan `node_modules/@altimateai/ui-components/dist/**/*.js`, which automatic detection deliberately excludes. The one place the feature would apply is the one place it does not help.
- **`@tailwindcss/container-queries` plugin removal** — the plugin is not installed.
- **Patching `node_modules` or generating v3-compatible class strings** — restated from the blocker document; both remain prohibited.

## 8. Candidate verdicts

Every candidate named in the research brief, with its disposition and the evidence.

### React

| Candidate                            | Verdict                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions / `useActionState`           | Reject                                             | 2 `<form onSubmit>` elements total, both already on `react-hook-form` with `yup` resolvers and their own submit state. Migrating would replace a working validation stack with a second one.                                                                                                                                                                                                                                                                                                                                                                |
| `useFormStatus`                      | Reject                                             | Solves prop drilling of pending state into design-system inputs. Neither form drills it; `BookmarkButton.tsx` and `DisplayTestDetails.tsx` handle submit locally.                                                                                                                                                                                                                                                                                                                                                                                           |
| `useOptimistic`                      | Reject                                             | Requires a mutation whose result is predictable before it returns. The webview's mutations go over `executeRequestInSync` to the extension host and return authoritative data — compiled SQL, query results, lineage. Optimistically guessing those is not possible. The 4 `isLoading`/`isSaving` flags are honest pending indicators.                                                                                                                                                                                                                      |
| `use`                                | Reject                                             | No Suspense-based data fetching. `<Suspense>` appears once in `App.tsx` wrapping lazy routes. The request layer is promise-based over `postMessage` with no suspense integration, and adding one is L5-scale work for no current benefit.                                                                                                                                                                                                                                                                                                                   |
| `ref` as a prop                      | **Accept — F2**                                    | 3 `uiCore` `forwardRef` components in scope; 2 onboarding ones excluded as Phase 8.5 deletes that surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Ref cleanup functions                | Accept, incidental                                 | Zero `useRef()` no-arg calls and zero implicit-return ref callbacks, so there is no migration cost. Useful later in L4 where the Perspective teardown currently lives in a `useEffect` cleanup. Not worth its own step.                                                                                                                                                                                                                                                                                                                                     |
| `<Context>` as provider              | **Accept — F3**                                    | 3 provider JSX pairs, six lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `useEffectEvent`                     | **Accept — L3**                                    | 56 effects, 7 message-bridge listeners, and a demonstrable stale-identity bug in `PerspectiveViewer.tsx`. Deferred only because there are no tests.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `<Activity>`                         | Reject                                             | Each panel is a separate webview root created and destroyed by the host. No hidden-subtree state to preserve.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Custom element support (Perspective) | **Accept as a migration risk, not an opportunity** | `<perspective-viewer>` is rendered in JSX with a `declare global` augmentation in `perspective.d.ts`, and is passed `class`, `ref`, and `style`. React 19 changes client-side prop handling: props matching a property on the element instance are assigned as properties rather than attributes. `HTMLPerspectiveViewerElement` has many properties, so this can change behavior. Treat it as the highest-risk file in the React 19 PR, verify the viewer renders and themes switch, and consider `className` in place of `class`. Do not claim a benefit. |
| React Compiler                       | **Defer — L2**                                     | Zero `React.memo`, 20 `useMemo`, 15 `useCallback` across 13,523 lines; no tests; requires adding a Babel pass to Vite 8 via `@rolldown/plugin-babel`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Resource preloading                  | Reject                                             | Local bundle, no network fetches to schedule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Document metadata                    | Reject                                             | Webview has no meaningful document head.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Improved hydration and errors        | Reject (hydration); accept incidentally (errors)   | No SSR, so hydration diffs never fire. Better uncaught-error reporting and `onCaughtError` / `onUncaughtError` root options arrive free with the bump and pair with the 3 existing `react-error-boundary` usages. No work item.                                                                                                                                                                                                                                                                                                                             |
| Owner Stacks / `captureOwnerStack`   | Reject as a work item                              | React 19.1, development-only. Arrives with the bump; nothing to adopt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Fragment Refs                        | **Defer — L4**                                     | Real candidates in `PerspectiveViewer.tsx` shadow-DOM reach-through and `ActionWidget.tsx`'s 5 placeholder divs, but gated on L1's package decision.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `<ViewTransition>`                   | Reject                                             | Animated transitions in a VS Code panel; no need.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `browser()` / Trusted Types          | Reject                                             | No SSR; no Trusted Types CSP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Tailwind

| Candidate                                                   | Verdict                  | Evidence                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS-first configuration / `@theme`                          | **Conditional — L1**     | Not an opportunity for owned code, which reads none of the 123-line `tailwind.config.ts`. But it is the required form under L1's migrate branch: v4 has no `corePlugins`, so `@theme` plus selective layer imports is how `tailwind-globals.css` gets retired into supported configuration. Cline's `src/theme.css` is the working reference. |
| Automatic source detection                                  | Reject                   | v4 auto-detection excludes `node_modules`, which is the only thing this repository's `content` array scans. Under L1's migrate branch the replacement's dist needs an explicit `@source`, not auto-detection.                                                                                                                                 |
| `@source`                                                   | **Conditional — L1**     | Reject in its v3-port form: the blocker document measured `@source` over the ui-components dist producing an empty utilities layer, because the dist carries v3-prefixed strings. Required under the migrate branch if the replacement ships v4-authored markup the host must scan.                                                           |
| Prefix variant migration                                    | Reject                   | Does not fix the DOM-class mismatch, and there are zero owned utilities to migrate.                                                                                                                                                                                                                                                           |
| Built-in `@import` handling                                 | Not applicable           | `postcss-import` is not installed; Vite handles CSS imports.                                                                                                                                                                                                                                                                                  |
| Dropping `autoprefixer`                                     | **Accept, gated — F6**   | Correct only once v4 is in place; premature removal drops prefixing for 36 owned stylesheets.                                                                                                                                                                                                                                                 |
| Custom utilities / variants (`@utility`, `@custom-variant`) | Reject                   | Zero `@apply`, zero `@layer utilities`, zero custom plugins. Nothing to convert.                                                                                                                                                                                                                                                              |
| Container queries in core                                   | Reject                   | Zero `@container` and zero `container-type` in owned CSS; 11 plain media queries. The plugin is not installed.                                                                                                                                                                                                                                |
| Modern color / gradient / 3D transforms                     | Reject                   | Zero owned utility classes. Colors come from 41 CSS custom properties and 24 VS Code theme variables.                                                                                                                                                                                                                                         |
| Build performance                                           | Reject as a motivation   | Tailwind's published benchmark is 378 ms to 100 ms on a full build. This repository's webview build is dominated by `tsc` and Vite over 13,523 owned lines plus 3.7 MB of vendored bundle. F1 removes far more build time than a Tailwind engine swap would.                                                                                  |
| Lightning CSS minification                                  | **Accept — F5**          | Vite 8 already defaults `build.cssMinify` to `'lightningcss'`; the repository overrides it to `'esbuild'`. Adoption is deleting a line, and it is independent of Tailwind's version.                                                                                                                                                          |
| esbuild minification                                        | Reject as a target state | The current override. Vite 8 also deprecates `build.minify: 'esbuild'` in favor of Oxc, though this repository does not set `build.minify`.                                                                                                                                                                                                   |
| Sass coexistence                                            | **Non-issue, verified**  | The upgrade guide states v4 is not designed for use with Sass. It does not apply here: zero owned SCSS file references a Tailwind feature — no `@apply`, no `@theme`, no `@reference`. The Tailwind entry is plain CSS and the 36 SCSS modules are independent. Recorded because it reads like a blocker and is not.                          |
| Browser requirements                                        | **Non-issue, verified**  | v4 targets Safari 16.4, Chrome 111, Firefox 128. Webviews run in the host's Chromium, and Vite 8's default build target is already `chrome111`/`safari16.4`. Not a constraint at `engines.vscode ^1.128.0`.                                                                                                                                   |

## 9. Risks and confidence limits

1. **The custom-element behavior change is the one place React 19 can break this codebase silently.** React 19 assigns props matching an element property as properties rather than attributes. `<perspective-viewer>` has a large property surface. With zero unit tests, only manual inspection will catch a regression. This is the highest-confidence risk in the document and the lowest-confidence outcome.
2. **Zero tests in `webview_panels` is the binding constraint on everything behavioral.** It is why L2, L3, and L4 are deferred and why the React 19 PR should be mechanical. `tsc` and 8 stories are the entire safety net.
3. **L1 is deliberately not resolved, because the deciding input does not exist yet.** Zero owned utilities establishes that Tailwind is not an authoring system here; it does not establish that the generator is disposable. Which branch applies depends on the replacement's styling contract. An earlier draft of this research treated deletion as the default — that was wrong, and the corrected rule is to preserve Tailwind 3 generation until the contract is known.
4. **F1 asserts that `TeamMateProvider` and `ApiHelper` are removable.** This follows from ADR 0001 and from `ApiHelper` being a hosted-API shim, but the vendored bundle was not read in full — it is 93,282 lines of prebuilt output. The claim rests on its three import sites, which were read. A reviewer should confirm no panel depends on `TeamMateProvider` for context rather than for AI.
5. **`reactstrap@9.2.3` and `antd@5.29.3` declare permissive React peer ranges (`>=16.8.0` and `>=16.9.0`) that do not prove React 19 support.** A permissive range is weaker evidence than `react-select`'s explicit `^19.0.0`. `reactstrap` has 7 owned consumers and needs a runtime check during the React 19 PR. `antd`'s 6 consumers are all in `src/modules/onboarding/`, which Phase 8.5 rewrites, so the cheapest resolution may be sequencing rather than verification.
6. **Sequencing claim, stated as opinion.** Replacing `@altimateai/ui-components` before Phase 4 while Phase 7.5 rebuilds the lineage panel on LSP commands risks doing the lineage UI twice. This research did not evaluate that trade-off in depth; it is flagged for the orchestrator, not resolved.
7. **Counts are token scans, not semantic analysis.** `grep` over 141 files can miss a dynamically constructed class name or an aliased import. The two most load-bearing counts — zero owned Tailwind utilities and zero `React.memo` — were each checked more than one way, but neither is a compiler-verified fact.

## 10. Proposed plan delta

Not applied. For an orchestrator to weigh against the canonical plan after review.

**To [`remaining-implementation.md`](../refactor/remaining-implementation.md), "Held in 3.7, booked as own PRs before Phase 4":**

1. Insert a PR **before** the React 19 PR: *delete the vendored `webview_panels/src/lib/` Altimate bundle* (F1). Record that it orphans `@ant-design/pro-chat`, `formik`, and `antd-style`, and that `react-code-blocks` / `react-syntax-highlighter` are already installed as the `CodeBlock` replacement.
2. Amend the React 19 entry. It currently reads "replace `@altimateai/ui-components` and `@ant-design/pro-chat` which peer on React 18 / antd 5". `@ant-design/pro-chat` needs deletion, not replacement, and it is unreachable from owned source. Note the `JSX` namespace scoping across 97 files (F4) as the bulk of that PR, and `types-react-codemod@3.5.3` as the tool. Note `<perspective-viewer>` as the one file requiring manual verification.
3. Add F2 and F3 as named contents of the React 19 PR, with the explicit exclusion of `src/modules/onboarding/` on the grounds that Phase 8.5 rewrites it.
4. Add a standalone one-line-each item for F5 — delete the `cssMinify: "esbuild"` override and migrate `rollupOptions` to `rolldownOptions` — verified by the existing `check-webview-tailwind-css.sh` guard. Independent of both React and Tailwind.

**To [`tailwind4-ui-components-blocker.md`](../refactor/tailwind4-ui-components-blocker.md):**

5. Add a finding: owned source contains zero Tailwind utility classes. The only `al-` token in owned code is the hand-written `al-tw-scope` scope class. Tailwind's sole consumer is `@altimateai/ui-components` dist JS.
6. Reframe the revisit checklist accordingly. Step 3, "migrate owned markup to `al:*` variant syntax if any utilities remain in `src/`", has a measured answer: none remain. Add a step 0 ahead of the upgrade steps — *establish the replacement's styling contract, then either delete Tailwind or migrate the generator to v4* — and record the binding constraint that generated utility output is never hand-ported or vendored. Do not record a default in either direction.
7. Record `src/modules/lineage/tailwind-globals.css` as named debt: 384 lines of hand-adapted Tailwind 3 Preflight, which is generated output under manual maintenance and has no counterpart in Cline or Continue. Add it to whichever branch step 0 selects — deleted with Tailwind, or retired into supported configuration during the v4 migration — so it cannot survive as a hand-copied file.
8. Move checklist item 6 (re-evaluate `cssMinify`) out of the Tailwind checklist. Vite 8 already defaults to Lightning CSS; the override is unrelated to Tailwind's version and can be deleted independently (F5).

**New scheduling, phase to be decided by the orchestrator:**

9. Book L5, a `webview_panels` test suite, as a named prerequisite for any behavioral webview refactor. It currently gates L2, L3, and L4 and appears nowhere in the plan. The Jest-versus-Vitest choice is a real decision, not a detail.
10. Record L2 (React Compiler), L3 (`useEffectEvent`), and L4 (Fragment Refs) as post-Phase-7 candidates, each with the prerequisites stated in Section 6.
11. Surface the open sequencing question from risk 6: whether the `@altimateai/ui-components` replacement belongs before Phase 4 or alongside Phase 7.5's lineage rebase.

## Sources

Primary, retrieved during this research.

- [React v19](https://react.dev/blog/2024/12/05/react-19) — React 19.0 release post. Actions, `useActionState`, `useFormStatus`, `useOptimistic`, `use`, `ref` as a prop, ref cleanup functions, `<Context>` as provider, document metadata, stylesheets, resource preloading, custom element support.
- [React 19.2](https://react.dev/blog/2025/10/01/react-19-2) — `<Activity>`, `useEffectEvent`, Performance Tracks, `cacheSignal`, Partial Pre-rendering, `eslint-plugin-react-hooks` v6.
- [React 19.3](https://react.dev/blog/2026/09/09/react-19-3) — View Transitions and Fragment Refs stable, `browser()`, Trusted Types support.
- [React 19.1.0 release notes](https://github.com/react/react/releases/tag/v19.1.0) — Owner Stacks, development-only.
- [`captureOwnerStack`](https://react.dev/reference/react/captureOwnerStack) — development-only availability.
- [React Compiler](https://react.dev/learn/react-compiler) and [React Compiler installation](https://react.dev/learn/react-compiler/installation) — independent Babel plugin; `@vitejs/plugin-react@6` requires `@rolldown/plugin-babel` with `reactCompilerPreset`.
- [`types-react-codemod`](https://github.com/eps1lon/types-react-codemod) — `scoped-jsx` and `no-implicit-ref-callback-return` transforms.
- [Tailwind CSS v4.0 announcement](https://tailwindcss.com/blog/tailwindcss-v4) — engine benchmarks, CSS-first configuration, automatic source detection, Lightning CSS prefixing, container queries in core, Vite plugin.
- [Tailwind CSS upgrade guide](https://tailwindcss.com/docs/upgrade-guide) — browser requirements, removed `@tailwind` directives, prefix-as-variant, `autoprefixer` and `postcss-import` removal, `@utility`, `@reference`, and the Sass/Less/Stylus statement.
- [Tailwind: detecting classes in source files](https://tailwindcss.com/docs/detecting-classes-in-source-files) — `node_modules` excluded by default, `@source`, `@source inline()`, `source(none)`.
- [Tailwind: theme variables](https://tailwindcss.com/docs/theme) — `@theme`, namespaces, `initial` overrides.
- [Vite build options](https://vite.dev/config/build-options) — `build.cssMinify` defaults to `'lightningcss'`; `build.rollupOptions` deprecated in favor of `build.rolldownOptions`; default `build.target` is `chrome111`/`safari16.4`.

VS Code platform and webview practice, all retrieved 2026-09-20.

- [VS Code webview API guide](https://code.visualstudio.com/api/extension-guides/webview) — `asWebviewUri` for local resources, `localResourceRoots` semantics and `[]` to disallow, `default-src 'none'` CSP with `webview.cspSource`, `getState`/`setState`, and the `retainContextWhenHidden` memory warning.
- [VS Code webview UX guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews) — "Only use webviews when absolutely necessary"; accessibility expectations.
- [VS Code bundling extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) — bundling recommendation and the separate build boundary between extension host and webview assets.
- [`microsoft/vscode-webview-ui-toolkit#561`](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561) — archive announcement; "there are sadly no plans to continue the maintenance of this project." Not recommended.
- Cline, `apps/vscode/webview-ui`: [`vite.config.ts`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/vite.config.ts) (Tailwind as a Vite plugin), [`src/index.css`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/index.css) (full `@import "tailwindcss"` plus a deliberate `@layer base` against host styles; imports `@vscode/codicons` published CSS), [`src/theme.css`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/theme.css) (`@theme` mapped to `var(--vscode-*)`), [`tailwind.config.mjs`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/tailwind.config.mjs) (v3-era config scanning `@heroui/theme/dist`), [`package.json`](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/package.json) (`tailwindcss@^4.1.13`).
- Continue, `gui`: [`tailwind.config.cjs`](https://github.com/continuedev/continue/blob/main/gui/tailwind.config.cjs) (`corePlugins: { preflight: false }`, VS Code theme variables, sidebar-width breakpoints), [`postcss.config.cjs`](https://github.com/continuedev/continue/blob/main/gui/postcss.config.cjs), [`package.json`](https://github.com/continuedev/continue/blob/main/gui/package.json) (`tailwindcss@^3.2.7`).

Repository sources: [`vscode-extension-development-september-2026.md`](vscode-extension-development-september-2026.md) with its [sources](vscode-extension-development-september-2026-sources.md) and [guidance](vscode-extension-development-september-2026-guidance.md) companions, [`fusion-lsp-plan.md`](../refactor/fusion-lsp-plan.md), [`remaining-implementation.md`](../refactor/remaining-implementation.md), [`tailwind4-ui-components-blocker.md`](../refactor/tailwind4-ui-components-blocker.md), [`0001-local-fusion-only-product.md`](../adr/0001-local-fusion-only-product.md), [`0002-use-the-native-fusion-lsp.md`](../adr/0002-use-the-native-fusion-lsp.md).

Version and peer-dependency facts were read from the npm registry and from `webview_panels/node_modules/*/package.json` on 2026-09-20. Code counts come from token scans of `webview_panels/src` excluding the vendored `src/lib/`.
