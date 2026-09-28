# Webview audit — fpu-work (2026-09-27)

Raw data: `/tmp/outdated-{root,wv}.json`, `/tmp/audit-{root,wv}.json`.

## 1. Dependencies

- Root: 0 advisories. Majors behind: `typescript` 6→7, `@types/node` 24→26.
- webview_panels majors behind: `react`/`react-dom` and their `@types` 18→19, `tailwindcss` 3→4, `typescript` 6→7, `jsdom` 29→30, `@testing-library/jest-dom` 6→7, `globals` 16→17.
- Deprecated: `@finos/perspective` and `@finos/perspective-viewer` ("no longer maintained, upgrade to `@perspective-dev/client` / `@perspective-dev/viewer`"). The `-viewer-d3fc` and `-viewer-datagrid` packages will follow. `reactstrap` 9.2.3 is not deprecated, but its last publish was 2024-09. `react-copy-to-clipboard` is not deprecated.
- Advisories: 3 critical and 1 high.
  - **critical** `plotly.js` 2.35 → `maplibre-gl` (GHSA-jrc7-96c5-q579 XSS). Pulled in by `@altimateai/ui-components` 0.0.88. The suggested fix downgrades it to 0.0.79 (semver-major). Only `/lineage` is imported, so plotly is carried as dead weight.
  - **high** `d3-color` 1.4.1 ReDoS (GHSA-36jr-mh4h-2g58). Path: `@finos/perspective-viewer-d3fc` → `d3-svg-legend` → `d3-scale@1`.
- **PR:** migrate `@finos/*` to `@perspective-dev/*` 3.8. Drop `-viewer-d3fc` unless charts are needed; removing it also removes the `d3-color` advisory. Add an `overrides` entry pinning `maplibre-gl` to the patched version, or vendor or replace the lineage component.

## 2. Styling (125 TS/TSX files)

- There are five systems in use:
  - `bootstrap.min.css` imported globally (`src/App.tsx:2`). Roughly 73 bootstrap utility class occurrences.
  - reactstrap: 9 files, all inside `uiCore/`. `uiCore/index.ts:1-32` re-exports 30 components, and `uiCore/index.ts:47` re-exports the ButtonProps type.
  - Tailwind `al-`: 104 occurrences in 4 lineage files (`LineageView.tsx`, `ActionWidget.tsx`, `ComputeColumnLineageButton.tsx`, `help/HelpButton.tsx`), plus `tailwind-globals.css`.
  - `@altimateai/ui-components`: 4 files, lineage only (`LineageView.tsx:1-7`).
  - SCSS: 24 `.module.scss` files, 28 SCSS files in total, and a 186-line `uiCore/theme.scss`.
- `var(--vscode-*)` appears in only 2 files, and codicons in 9.
- **Recommendation:** use plain CSS Modules on `--vscode-*` tokens plus `@vscode/codicons`, with thin native `<button>`, `<input>`, and `<select>` wrappers in `uiCore`. Delete bootstrap, reactstrap, `theme.scss`, and `sass` (after converting the SCSS files to CSS). Delete Tailwind and PostCSS once lineage no longer needs ui-components, since Tailwind exists only for it.
- **PR sequence:** (a) delete unused uiCore exports (see §6); (b) replace the 9 reactstrap wrappers; (c) remove bootstrap and fix layout.

## 3. State and routing

- Redux Toolkit is used only for `createSlice` and `PayloadAction` (`app/appSlice.ts:8`, `queryPanel/context/queryPanelSlice.ts:20`, `documentationEditor/state/documentationSlice.ts:24`). There is no `configureStore`. Each slice's reducer goes into a React `useReducer` plus context (`AppProvider.tsx:17`, `QueryPanelProvider.tsx:18`, `DocumentationProvider.tsx:65`). RTK is only used to generate reducers (immer and action creators).
- The router is a single `MemoryRouter` over 3 routes (`main.tsx:~35`, `AppConstants.tsx`). The host sets `window.viewPath` (`altimateWebviewProvider.ts:373`, `docsEditPanel.ts:1094`). No in-app navigation happens.
- **PR:** replace react-router with a `switch (window.viewPath)` in `main.tsx`. RTK can stay (it is cheap) or be replaced by plain reducers. Router removal should come first.

## 4. Messaging

- Webview → host: `{command, ...params, syncRequestId?}` through `executeRequestInSync`, `executeRequestInAsync`, or `executeStreamRequest` (`modules/app/requestExecutor.ts`). There are 53 call sites and about 29 distinct string literals.
- The host dispatches with `switch`/`if` chains in `altimateWebviewProvider.ts:199-250`, `docsEditPanel.ts:503-760`, `newLineagePanel.ts:198-320`, `queryResultPanel.ts:188-355`, and `lineagePanel.ts:117-135`. That makes 29 distinct received commands.
- Host → webview: 8 distinct commands. `response` accounts for 24 sites; the others are `render`, `renderDocumentation`, `renderError`, `renderColumnsFromMetadataFetch`, `queryHistory`, `updateViewType`, and `queryResultTab:render`.
- Typing: messages are untyped. Only `HandleCommandProps { command: string } & Record<string, unknown>` exists (`altimateWebviewProvider.ts:30`), with `message: any` in `docsEditPanel.ts:204,291,779` and `args: any` in `lineagePanel.ts:111`. There is no shared contract file.
- **PR:** add `src/webview_provider/protocol.ts` as a discriminated union per panel, import it from both sides, and make the host dispatch an exhaustive map.

## 5. HTML, CSP, and retainContextWhenHidden

- There are two HTML builders:
  - `AltimateWebviewProvider.getHtml` (`altimateWebviewProvider.ts:298-380`), used by query and lineage (`queryResultPanel.ts:437`, `newLineagePanel.ts:871`).
  - A duplicate module-level `getHtml` (`docsEditPanel.ts:1069-1096`) with a different CSP.
- Both allow `'unsafe-eval'` (2 hits). Both use `style-src 'unsafe-inline'`.
- `retainContextWhenHidden: true` is set on all 3 view providers (`index.ts:18,23,28`) and on the query tab panel (`queryResultPanel.ts:170`).
- **PR:** use one `getHtml(viewPath)` in the base class, and delete the docs copy. Test whether Perspective WASM still needs `unsafe-eval` (use `wasm-unsafe-eval` instead). Drop `retainContextWhenHidden` for docs and lineage by restoring state through `setState`/`getState`.

## 6. Dead code

- Unimported modules:
  - `modules/markdown/Renderer.tsx`: the only user of `react-markdown` and `remark-gfm`.
  - `documentationEditor/components/score/Score.tsx`: stories only.
  - `documentationEditor/components/model/Options.tsx`.
  - `docGenerator/DocGenSelectedColumns.tsx`.
- Unused uiCore exports:
  - Components: Tabs, Accordion, Dropdown, DropdownButton, Avatar, PopoverWithButton, Loader.
  - reactstrap re-exports: Card*, Col, Row, Container, Form, FormGroup, Popover*, List, Offcanvas*, ListGroup, Fade, Spinner, Modal.
- Storybook: `.storybook/` and 9 stories (4 in `uiCore/uiToolkitStories`), with 5 `@storybook/*` devDependencies plus `eslint-plugin-storybook`. `@faker-js/faker` and `factory.ts` are used only by stories and `testUtils`.
- **PR:** delete the 4 dead files, the unused uiCore components and exports, `react-markdown` and `remark-gfm`, and Storybook with its stories and devDependencies. Keep `testUtils` if vitest uses it.
