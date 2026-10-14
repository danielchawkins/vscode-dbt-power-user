# Research

## Question

Can this repository drop typescript-eslint (and ideally ESLint and Prettier) for a faster toolchain that supports TypeScript 7 (typescript-go) today, and which other dependencies can be dropped or moved to their latest major version?

## Recommendation

Make TypeScript 7 the first PR, using Microsoft's alias setup. In each workspace, set `"typescript": "npm:@typescript/typescript6@^6.0.0"` and add `"typescript-7": "npm:typescript@^7.0.2"`. TS 7 then compiles the code (`npx tsc`), while typescript-eslint, prettier-plugin-organize-imports and type-coverage keep using the TS 6 API. `just check` should stay green, though I haven't run it, and no rule changes. In the same or a neighbouring PR, apply the safe bumps: @eslint-react 5.24.10, react-table 9.2.8, happy-dom 20.14.6, vite 8.3.4, concurrently 10.0.6 and vscode-languageclient 10.1.2. Keep @types/node on 24 and @types/vscode on 1.125.0 unless you decide to raise `engines.vscode` to 1.134 or later. Then move to Oxlint (pinned) with oxlint-tsgolint, as a hybrid in four steps. (1) Run it report-only next to ESLint and settle the differences, such as the 6 new no-unsafe-assignment findings in `src/features/docs`. (2) Move the typed rules and the native rules (no-restricted-imports/properties, complexity, max-*, the syntactic rules, and the native react/* hooks, purity, static-components, set-state-in-effect and only-export-components) into `.oxlintrc.json`. Seed `oxlint-suppressions.json` with the hidden `--suppress-all` flag, point the ratchet's two `suppressionTotal` filenames and `lint:prune` at it, and delete `parserOptions.project` and typescript-eslint's typed presets from ESLint. (3) Keep a thin, untyped ESLint, with `eslint-plugin-oxlint` to avoid double reports, only for no-restricted-syntax, sonarjs, @eslint-react/no-unused-props and the other @eslint-react rules I didn't check, and jsx-a11y-x. Remove ESLint entirely only once those rules are proven under `oxlint-plugin-eslint` and sonarjs JS plugins with fixtures that must fail, or after you explicitly accept losing them. (4) Last and optionally, replace Prettier and organize-imports with oxfmt (sortImports plus Oxlint's no-unused-vars), and decide whether to keep type-coverage (it keeps its two ceilings and needs the TS 6 alias) or drop it along with the fast-glob shim. If you go all the way to Oxlint only, you lose or weaken: no-restricted-syntax boundaries without the alpha plugin, sonarjs cognitive-complexity and the other five sonarjs rules without the alpha plugin, @eslint-react/no-unused-props, any webview preset member Oxlint lacks, and the stability guarantee on the suppression file format. Option (d) gives you nothing the alias doesn't, and Biome would drop most typed rules.

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verdict    | Confidence |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1. The thesis is right about the peer range. typescript-eslint 8.71.1 is still the latest release, and it peers `typescript >=4.8.4 <6.1.0`. All three workspaces pin `typescript ^6.0.3` (6.0.3 installed, 7.0.2 latest). The antithesis is right that this does not block TS 7 in practice. Microsoft documents a side-by-side setup: alias `typescript` to `@typescript/typescript6`, which re-exports the 6.0 API and is 6.0.2 on npm, so it satisfies typescript-eslint's peer range. Then add a second alias to `typescript@7` to get its `tsc`. With that, TS 7 compiles the code while typescript-eslint, type-coverage and organize-imports keep using the TS 6 API, and no lint rule changes. Option (c) on its own does not unblock TS 7, but the alias does, whichever lint option is chosen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | middle     | high       |
| 2. The type-aware inventory in the thesis is accurate. The host enables about 15 typed typescript-eslint rules, and the webview adds the full `recommendedTypeChecked` and `stylisticTypeChecked` presets. I ran `oxlint --rules` (v1.87.0) and found native typescript/* versions of every host rule: no-floating-promises, no-misused-promises, await-thenable, the five no-unsafe-* rules, no-for-in-array, no-misused-spread, no-base-to-string, switch-exhaustiveness-check, no-unnecessary-type-assertion, prefer-promise-reject-errors and only-throw-error. Many preset members also exist natively, including restrict-template-expressions, unbound-method, no-redundant-type-constituents, prefer-nullish-coalescing, prefer-optional-chain, dot-notation, prefer-includes, prefer-regexp-exec, non-nullable-type-assertion-style, no-inferrable-types and consistent-type-definitions. no-unnecessary-condition is marked 🚧, so it may be incomplete. Rule names match, but findings do not. On the host, tsgolint reported 6 `no-unsafe-assignment` errors in `src/features/docs/*` that ESLint does not report for the same files. Those files are not in the baseline, and ESLint exits 0 on them. So moving the type-aware layer will produce new findings to fix or baseline. | middle     | medium     |
| 3. The inventory itself is right. The weak part is the thesis's mapping to Oxlint. These rules are native in Oxlint 1.87.0: no-restricted-imports, no-restricted-properties (since v1.63.0), complexity, max-depth, max-lines, max-lines-per-function, max-params, curly, eqeqeq, no-throw-literal, no-console, no-async-promise-executor, ban-ts-comment, no-explicit-any, no-require-imports and no-unused-vars. Two rules have no native version: `no-restricted-syntax`, which carries the process, fs-require, fs-write-call, vendor-name and `postMessage` selector boundaries, and `sonarjs/cognitive-complexity`. They can only run as JS plugins. ESLint's core rules ship as the `oxlint-plugin-eslint` package (1.87.0), and JS plugins are alpha. So most of the boundary set is native, and only the AST-selector boundaries depend on alpha code.                                                                                                                                                                                                                                                                                                                                                                                                                                 | antithesis | high       |
| 4. The thesis is right that the ratchet reads ESLint's bulk-suppression files. But the coupling is only to a file schema, and Oxlint writes the same schema. `suppressionTotal` sums `count` values over a map of file → rule → `{count}`. I ran `oxlint --suppress-all`, and it wrote `oxlint-suppressions.json` in exactly that shape. So moving the ratchet means changing two filenames, not rewriting the two `measure` functions. Separately, the `typeCoverage.*` ceilings depend on `type-coverage`, which uses the TypeScript compiler API, so the TS 7 move affects them too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | middle     | high       |
| 5. Oxlint with tsgolint runs on typescript-go, so it never loads the repo's `typescript` package. It linted this repo while the repo is still on TS 6. The docs' 'TypeScript 7.0+ is required' means the tsconfig must be TS-7-compatible, and this repo's evidently is, since it ran. My timings: on the host (`src scripts packages`, 414 files), ESLint took 4.5s and `oxlint --type-aware` took about 1.0s. On the webview, `eslint .` took 3.35s and `oxlint --type-aware src` took 0.21s. Neither comparison uses the same rule set. Expect roughly 4x faster on the host and more than 10x on the webview. Oxlint also needs `oxlint-tsgolint` installed next to it; without it, it fails with 'Failed to find tsgolint executable'.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | middle     | medium     |
| 6. JS plugins are alpha and support ESLint selectors. `eslint-plugin-sonarjs` is on Oxlint's conformance list, so the six sonarjs rules could load as a JS plugin. The webview's React rules come from `@eslint-react`, not `eslint-plugin-react-hooks`, and `@eslint-react` is not on the conformance list. Some of its rules have native Oxlint react/* equivalents: rules-of-hooks, exhaustive-deps, purity, set-state-in-effect, static-components, and also `react-refresh` only-export-components. `@eslint-react/no-unused-props` has no native equivalent. I did not check set-state-in-render, use-state, naming-convention-ref-name, web-api-no-leaked-event-listener, web-api-no-leaked-timeout, no-nested-component-definitions, dom-no-unsafe-target-blank or jsx-a11y-x/no-autofocus. JS plugins cannot run type-aware rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | middle     | medium     |
| 7. Oxlint does have bulk suppressions, available since v1.64.0. `--suppress-all` and `--prune-suppressions` work in the installed 1.87.0. They write and prune `oxlint-suppressions.json` in ESLint's file → rule → count schema, and suppressed violations exit 0. The risk is stability, not absence. Maintainers deliberately hid the flags from `--help` and the docs to keep room for breaking changes, and the PR that would document them is still a draft. So the baseline carries over, but the oxlint version must be pinned and the format treated as unstable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | antithesis | high       |
| 8. Biome 2.x (2.5.15) is not a good fit, and the reason is rule maturity, not TS 7. Its Types domain uses Biome's own scanner and inference engine instead of tsc, so it does not depend on the TS version. But every typed rule in that domain is nursery. The domain does include noFloatingPromises, noMisusedPromises, noBaseToString, useAwaitThenable and useExhaustiveSwitchCases, so the antithesis undercounted it. There is no no-unsafe-* family, and no counterpart for most of the webview's recommendedTypeChecked/stylisticTypeChecked presets. Biome would therefore weaken the typed layer the most of any option. I did not read its `noRestrictedImports`, GritQL or sonarjs equivalents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | middle     | medium     |
| 9. Option (d) is progressing but has no date. As of 2026-09-29, typescript-eslint's TS 7 support targets TS 7.1's new API. PR #12803 is close to internal review, and the team expects no big speedup over TS 6 in the first, IPC-based version. Waiting therefore buys neither TS 7, which the alias already gives, nor speed. Its only benefit is TS 7 type information inside ESLint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | antithesis | high       |
| 10. The current Prettier setup does block a plain TS 7 install. `.prettierrc` loads `prettier-plugin-organize-imports`, which uses the TypeScript language service. Its peer range `>=2.9` accepts TS 7, so npm will not warn. But typescript 7.0.2's main export `.` resolves only to `./lib/version.cjs`, so the compiler API is not there. The alias route fixes this. A future switch to oxfmt needs two tools: oxfmt's sortImports for sorting and Oxlint's no-unused-vars for unused imports. The markdown split (dprint/rumdl, managed by mise) is unaffected. Lefthook's `just lint-format`, `just lint-code` and `webviews::lint` jobs only change if the recipes behind them change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | antithesis | high       |
| 11. `npm outdated` from the root lists these bumps: @eslint-react/eslint-plugin 5.24.6→5.24.10, @tanstack/react-table 9.2.6→9.2.8, happy-dom 20.14.5→20.14.6, vite 8.3.3→8.3.4, concurrently 10.0.5→10.0.6, vscode-languageclient 10.1.1→10.1.2 (an exact pin in `dependencies`), typescript 6.0.3→7.0.2 in all three workspaces, @types/node 24→26, @types/vscode 1.125.0→1.140.0 and @vscode/codicons 0.0.45→0.0.46-24. Keep @types/node on 24, because `engines.node` in package.json is `>=24 <25` and mise pins `node = "24"`. Skip the codicons pre-release. Keep @types/vscode at 1.125.0. vsce refuses to package when @types/vscode's minor is above `engines.vscode` (^1.128.0). No @types/vscode 1.128.0 exists; the published versions jump from 1.125.0 to 1.134.0. So 1.125.0 is already the newest version that fits. Moving it means raising `engines.vscode` to at least 1.134, which is a product decision about the minimum supported VS Code.                                                                                                                                                                                                                                                                                                                               | middle     | high       |
| 12. A full Oxlint/oxfmt switch makes these redundant: eslint, typescript-eslint, @eslint/js, eslint-config-prettier and globals (in both workspaces), @eslint-react/eslint-plugin, eslint-plugin-jsx-a11y-x and eslint-plugin-react-refresh, plus prettier and prettier-plugin-organize-imports if oxfmt is adopted. eslint-plugin-sonarjs stays if it runs as a JS plugin. The switch adds oxlint, oxlint-tsgolint, and oxlint-plugin-eslint for no-restricted-syntax. `type-coverage` also uses the TS compiler API: its peer range allows 7, but it needs the TS 6 alias to keep working. It is the only consumer of the `fast-glob` shim (`npm ls fast-glob` shows only type-coverage-core). Removing it therefore removes the override cleanly, but also drops the two typeCoverage ceilings. `concurrently` is used twice, in `watch:extension` and in the justfile watch recipe. knip ignores `type-coverage` explicitly. jscpd is not installed, and sonarjs/no-identical-functions is the only check close to duplicate detection.                                                                                                                                                                                                                                                     | middle     | medium     |
| 13. The thesis's plan puts TS 7 last. It should come first, through the alias, with zero rule loss. After that the lint migration is an optional speed and dependency-count win. It should use Oxlint's native suppressions rather than custom tooling, and keep a small ESLint config until the alpha-only rules (no-restricted-syntax, sonarjs, the remaining @eslint-react rules) are proven or explicitly dropped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | antithesis | medium     |
| 14. Three packages use the TypeScript compiler API without warning on a plain TS 7 install, because their peer ranges accept 7 or they declare none: typescript-eslint (whose peer range does warn), prettier-plugin-organize-imports and type-coverage. TS 7.0.2 exposes only a version stub at its main entry. Any plan that installs `typescript@7` without the alias will pass `npm install` and then fail at runtime in `just lint-format` and in the type-coverage ratchet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | new        | high       |

## Detail

### 1. The thesis is right about the peer range. typescript-eslint 8.71.1 is still the latest release, and it peers `typescript >=4.8.4 <6.1.0`. All three workspaces pin `typescript ^6.0.3` (6.0.3 installed, 7.0.2 latest). The antithesis is right that this does not block TS 7 in practice. Microsoft documents a side-by-side setup: alias `typescript` to `@typescript/typescript6`, which re-exports the 6.0 API and is 6.0.2 on npm, so it satisfies typescript-eslint's peer range. Then add a second alias to `typescript@7` to get its `tsc`. With that, TS 7 compiles the code while typescript-eslint, type-coverage and organize-imports keep using the TS 6 API, and no lint rule changes. Option (c) on its own does not unblock TS 7, but the alias does, whichever lint option is chosen

Verdict: middle. Confidence: high.

I checked with `npm view`. typescript-eslint is at 8.71.1 (latest), with a canary 8.71.2-alpha.1, and peers `<6.1.0`. `@typescript/typescript6` is at 6.0.2 and its bin is `tsc6`; typescript 7.0.2's bin is `tsc`. I read the alias instructions in the TS 7 RC post myself. The thesis's view that only removing typescript-eslint or waiting for it unblocks TS 7 is wrong. One small cost: the alias moves the TS 6 API from 6.0.3 down to 6.0.2.

Citations:

- [r1a](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): "The new package also re-exports the TypeScript 6.0 API, so that you can use tsc for TypeScript 7, while other tooling can continue to rely on 6.0."
- [r1b](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): "Because some tools like typescript-eslint expect to import from typescript directly via peer dependencies, we recommend achieving this via npm aliases."
- [r1c](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): "Note that doing this will leave you only with a tsc6 executable."
- [r1d](../../package.json): ""typescript": "^6.0.3","

Thesis (high): Today's TS 7 block is typescript-eslint's peer range. The installed typescript-eslint 8.71.1 peers `typescript >=4.8.4 <6.1.0`, while `typescript@latest` is 7.0.2 and the repo pins ^6.0.3 in both packages. The `npm view` output shows no newer typescript-eslint. So option (c), keeping ESLint without typescript-eslint's type-aware layer, still needs the typescript-eslint parser and TS 6 for plain TS syntax, and TS 7 stays blocked. Only a full removal of typescript-eslint, or a typescript-eslint release that supports TS 7, unblocks it. I did not verify that a typescript-eslint release with TS 7 support is missing from npm.

Thesis citations:

- [c1](../../package.json): ""typescript": "^6.0.3","
- [c2](../../webview_panels/package.json): ""typescript-eslint": "^8.71.0","

Antithesis: [confidence: high] The premise that TS 7 is 'blocked only because typescript-eslint peers <6.1.0' is true only for a single-`typescript` install. Microsoft documents a supported side-by-side route: alias `typescript` to `@typescript/typescript6` and add `typescript-7` for `tsc`. That unblocks TS 7 for `tsc`, `just check` and the rsbuild/Vite builds with typescript-eslint, ESLint and Prettier all kept. The thesis never mentions it, and it undermines the whole 'cannot drop ... and stay equivalent' framing.

Antithesis: [confidence: high] I checked npm. `@typescript/typescript6` is published (latest 6.0.2) and typescript-eslint 8.71.1 peers `typescript >=4.8.4 <6.1.0`. The alias therefore satisfies the peer range. The repo's installed `typescript` is 6.0.3, so the alias would move the TS 6 side to 6.0.2. I did not check whether that is a problem.

Antithesis: [confidence: medium] The thesis says option (c) 'still needs TS 6'. That is true but is not a blocker once the alias exists. It only means that TS 6 is kept as the programmatic-API compiler while TS 7 does the compiling.

Antithesis: The thesis treats the peer range as the only block. The repo has two other TS-API consumers that npm will not flag, so a bare `typescript@7` install would pass `npm install` and fail at runtime (see the type-coverage and organize-imports points under point 12).

Counter-evidence:

- [a1](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): "The new package also re-exports the TypeScript 6.0 API, so that you can use tsc for TypeScript 7, while other tooling can continue to rely on 6.0."
- [a2](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): "Because some tools like typescript-eslint expect to import from typescript directly via peer dependencies, we recommend achieving this via npm aliases."
- [a3](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): ""typescript": "npm:@typescript/typescript6@^6.0.0","

### 2. The type-aware inventory in the thesis is accurate. The host enables about 15 typed typescript-eslint rules, and the webview adds the full `recommendedTypeChecked` and `stylisticTypeChecked` presets. I ran `oxlint --rules` (v1.87.0) and found native typescript/* versions of every host rule: no-floating-promises, no-misused-promises, await-thenable, the five no-unsafe-* rules, no-for-in-array, no-misused-spread, no-base-to-string, switch-exhaustiveness-check, no-unnecessary-type-assertion, prefer-promise-reject-errors and only-throw-error. Many preset members also exist natively, including restrict-template-expressions, unbound-method, no-redundant-type-constituents, prefer-nullish-coalescing, prefer-optional-chain, dot-notation, prefer-includes, prefer-regexp-exec, non-nullable-type-assertion-style, no-inferrable-types and consistent-type-definitions. no-unnecessary-condition is marked 🚧, so it may be incomplete. Rule names match, but findings do not. On the host, tsgolint reported 6 `no-unsafe-assignment` errors in `src/features/docs/*` that ESLint does not report for the same files. Those files are not in the baseline, and ESLint exits 0 on them. So moving the type-aware layer will produce new findings to fix or baseline

Verdict: middle. Confidence: medium.

The antithesis said the thesis never checked rules by name. I checked them with the local `oxlint --rules` output, and every host typed rule is there. I did not diff each of the roughly 30 members of the two webview presets. The divergence I measured on docsYaml.ts and dbtTestService.ts is new evidence. It suggests tsgolint resolves some types as `any` where TS 6 does not (for example `YAMLMap.get`). The cause is unconfirmed. The docs' own stability caveat applies.

Citations:

- [r2a](../../eslint.config.mjs): ""@typescript-eslint/no-floating-promises": "error","
- [r2b](../../webview_panels/eslint.config.mjs): "...tseslint.configs.stylisticTypeChecked,"
- [r2c](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Type-aware linting currently supports 59 out of 61 type-aware rules from typescript-eslint."
- [r2d](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Rule coverage is incomplete (but very close)"

Thesis (high): Inventory, type-aware. Root `eslint.config.cjs` enables these typescript-eslint rules, which need a type checker: no-floating-promises, no-misused-promises, await-thenable, no-unsafe-assignment, no-unsafe-call, no-unsafe-member-access, no-unsafe-return, no-unsafe-argument, no-for-in-array, no-misused-spread, no-base-to-string, switch-exhaustiveness-check, no-unnecessary-type-assertion, prefer-promise-reject-errors, only-throw-error. `webview_panels/eslint.config.mjs` goes further and extends the whole `recommendedTypeChecked` and `stylisticTypeChecked` presets, with `parserOptions.project` pointing at two tsconfigs. The webview therefore uses far more type-aware rules than the host. All of these are in tsgolint's 59-of-61 coverage, but each rule has to be checked by name against the Oxlint rules list.

Thesis citations:

- [c3](../../eslint.config.mjs): ""@typescript-eslint/no-floating-promises": "error","
- [c4](../../webview_panels/eslint.config.mjs): "...tseslint.configs.recommendedTypeChecked,"
- [c5](../../webview_panels/eslint.config.mjs): "...tseslint.configs.stylisticTypeChecked,"

Antithesis: [confidence: medium] The thesis says each of the ~15 host rules and the whole webview presets 'has to be checked by name' against Oxlint but never does it. The 59-of-61 figure covers typescript-eslint rules in general and says nothing about which two are missing. The stylistic-type-checked preset also contains rules outside the 61.

Antithesis: [confidence: high] The thesis does not say that Oxlint type-aware linting has a hard TS 7 prerequisite and drops some tsconfig options. The repo has no `baseUrl` in its tsconfigs (grep returned nothing), so this does not hit this repo, but the thesis should have checked.

Antithesis: The thesis cites the 59-of-61 coverage as if it settles rule parity. The docs also say rule coverage is 'incomplete (but very close)' and that 'Very large codebases may encounter high memory usage'. Those are stability caveats for a gating CI check.

Counter-evidence:

- [b1](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "TypeScript 7.0+ is required"
- [b2](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Rule coverage is incomplete (but very close)"

### 3. The inventory itself is right. The weak part is the thesis's mapping to Oxlint. These rules are native in Oxlint 1.87.0: no-restricted-imports, no-restricted-properties (since v1.63.0), complexity, max-depth, max-lines, max-lines-per-function, max-params, curly, eqeqeq, no-throw-literal, no-console, no-async-promise-executor, ban-ts-comment, no-explicit-any, no-require-imports and no-unused-vars. Two rules have no native version: `no-restricted-syntax`, which carries the process, fs-require, fs-write-call, vendor-name and `postMessage` selector boundaries, and `sonarjs/cognitive-complexity`. They can only run as JS plugins. ESLint's core rules ship as the `oxlint-plugin-eslint` package (1.87.0), and JS plugins are alpha. So most of the boundary set is native, and only the AST-selector boundaries depend on alpha code

Verdict: antithesis. Confidence: high.

I grepped the local `oxlint --rules` output. `no-restricted-syntax` and `cognitive-complexity` are absent, and the other rules listed above are present. I read the no-restricted-properties rule page and confirmed with `npm view` that oxlint-plugin-eslint is described as ESLint's built-in rules. The thesis left all of this unconfirmed.

Citations:

- [r3a](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-properties.html): "This rule was added in v1.63.0."
- [r3b](../../webview_panels/eslint.config.mjs): ""CallExpression[callee.property.name='postMessage']:not([callee.object.name='window'])","
- [r3c](../../eslint.config.mjs): ""sonarjs/cognitive-complexity": ["error", 15],"
- [r3d](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "JS plugins are currently in alpha, and remain under active development."

Thesis (high): Inventory, syntactic, custom and size rules. Syntactic rules include curly, eqeqeq, no-throw-literal, no-console, no-async-promise-executor, ban-ts-comment, no-explicit-any, no-require-imports and no-unused-vars. The custom restrictions carry the repo's architectural boundaries. These are fs writes (the `FS_WRITES` list), `process.env`, `child_process` imports, `workspace.getConfiguration`, `window.showErrorMessage` and `postMessage` call syntax (an AST selector). In the webview they cover `@vscodeApi` imports. Because flat config replaces rule options per file, each exemption re-lists the whole rule. Size and complexity rules are complexity 15, max-depth 4, max-params 5, max-lines, max-lines-per-function and sonarjs/cognitive-complexity 15, plus five other sonarjs rules. React hooks, React and a11y rules come from `@eslint-react/eslint-plugin` and `eslint-plugin-jsx-a11y-x` in the webview only. These custom restrictions are the highest-value rules to preserve. I did not confirm that Oxlint implements `no-restricted-properties` or `no-restricted-syntax`, though its custom-rule route (JS plugins) supports ESLint selectors.

Thesis citations:

- [c6](../../eslint.config.mjs): "// Flat config replaces rule options per file, so an exemption re-sets the whole rule minus its own entries."
- [c7](../../eslint.config.mjs): ""CallExpression[callee.type='MemberExpression'][callee.property.name='postMessage']","
- [c8](../../eslint.config.mjs): "const WRITE_MESSAGE ="

Antithesis: [confidence: high] The thesis says it 'did not confirm' Oxlint implements `no-restricted-properties`, and gives no view on `no-restricted-imports` or `max-*`. These are checkable. `oxlint --rules` (v1.87.0, run locally) lists native `no-restricted-imports`, `no-restricted-properties`, `complexity`, `max-depth`, `max-lines`, `max-lines-per-function` and `max-params`. The Oxlint docs date `no-restricted-properties` to v1.63.0.

Antithesis: [confidence: high] The real gap is `no-restricted-syntax`, which the repo uses heavily for the process, fs-require, fs-write-call, removed-name, vendor-name and postMessage boundaries. It is not in the local `oxlint --rules` output, so it is not native. The route is the `oxlint-plugin-eslint` JS-plugin package (ESLint's built-in rules, 1.87.0), which is alpha and which the thesis never mentions. Using it means the architectural boundary check would depend on an alpha feature.

Antithesis: [confidence: medium] Even so, `no-restricted-syntax` selectors such as `Literal[value=/altimate/i]` and `CallExpression[callee.property.name='postMessage']:not([callee.object.name='window'])` are not expressible in native `no-restricted-properties`. The `:not()` exemption could not be reproduced there without a rewrite.

Antithesis: [confidence: low] The thesis does not say that JS plugins cannot run type-aware rules. `sonarjs` has a few type-using rules, but the repo's six sonarjs rules look syntactic. I did not verify this.

Antithesis: The thesis frames the custom restrictions as 'plausible to carry over through jsPlugins' and leaves it there. It missed that most of the boundary set (imports and properties) is native in Oxlint and that only the syntax selectors need the alpha plugin. That changes the risk assessment for option (a).

Counter-evidence:

- [c1](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-properties.html): "This rule allows you to disallow access to certain properties on certain objects."
- [c2](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-properties.html): "This rule was added in v1.63.0."
- [c3](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports.html): "It applies to static imports and to dynamic import() with a string-literal source; computed sources like import(bar) are ignored."
- [c4](https://registry.npmjs.org/oxlint-plugin-eslint): ""description":"ESLint's built-in rules as an Oxlint plugin""
- [c5](../../webview_panels/eslint.config.mjs): ""CallExpression[callee.property.name='postMessage']:not([callee.object.name='window'])","

### 4. The thesis is right that the ratchet reads ESLint's bulk-suppression files. But the coupling is only to a file schema, and Oxlint writes the same schema. `suppressionTotal` sums `count` values over a map of file → rule → `{count}`. I ran `oxlint --suppress-all`, and it wrote `oxlint-suppressions.json` in exactly that shape. So moving the ratchet means changing two filenames, not rewriting the two `measure` functions. Separately, the `typeCoverage.*` ceilings depend on `type-coverage`, which uses the TypeScript compiler API, so the TS 7 move affects them too

Verdict: middle. Confidence: high.

I checked this myself in /tmp. I created one file, ran `--suppress-all` and `--prune-suppressions`, and inspected the output, which matches the `eslint-suppressions.json` layout. The ratchet code iterates `Object.values(rules)` and reads `count`, so it does not care about rule-name prefixes.

Citations:

- [r4a](../../scripts/quality/ratchet.mjs): "for (const { count } of Object.values(rules)) {"
- [r4b](../../scripts/quality/ratchet.mjs): "measure: () => suppressionTotal("eslint-suppressions.json"),"
- [r4c](../../eslint-suppressions.json): ""src/core/dbtCommand.ts": {"
- [r4d](../../scripts/quality/ceilings.json): ""typeCoverage.host": 99.51,"

Thesis (high): Suppressions and the ratchet depend on ESLint directly. The baseline is ESLint's bulk-suppression file, `eslint-suppressions.json` in the root and in `webview_panels`. It shrinks only through `eslint --prune-suppressions`. `ratchet.mjs` measures the suppression totals by reading those two JSON files, and `ceilings.json` holds `suppressions.host` 29 and `suppressions.webview` 22. Any move off ESLint has to replace this file format, the prune command, and the two `measure` functions in the ratchet. Otherwise the ratchet loses its two suppression ceilings.

Thesis citations:

- [c9](../../scripts/quality/ratchet.mjs): "measure: () => suppressionTotal("eslint-suppressions.json"),"
- [c10](../../scripts/quality/ceilings.json): ""suppressions.host": 29,"
- [c11](../../webview_panels/package.json): ""lint:prune": "eslint . --prune-suppressions""

Antithesis: [confidence: high] The thesis states the ratchet depends on ESLint's suppression file, but it never checks whether Oxlint can produce an equivalent. It can, in part (see point 7). It also does not say that `lint:prune` and `suppressionTotal` would need to be re-pointed at a different file whose schema the thesis did not read.

Antithesis: [confidence: medium] It does not note that the ratchet also has `typeCoverage.*` ceilings that depend on `type-coverage`, a TS-API tool. Those ceilings are therefore also affected by the TS 7 move, separately from ESLint.

Counter-evidence:

- [d1](../../scripts/quality/ceilings.json): ""typeCoverage.host": 99.51,"

### 5. Oxlint with tsgolint runs on typescript-go, so it never loads the repo's `typescript` package. It linted this repo while the repo is still on TS 6. The docs' 'TypeScript 7.0+ is required' means the tsconfig must be TS-7-compatible, and this repo's evidently is, since it ran. My timings: on the host (`src scripts packages`, 414 files), ESLint took 4.5s and `oxlint --type-aware` took about 1.0s. On the webview, `eslint .` took 3.35s and `oxlint --type-aware src` took 0.21s. Neither comparison uses the same rule set. Expect roughly 4x faster on the host and more than 10x on the webview. Oxlint also needs `oxlint-tsgolint` installed next to it; without it, it fails with 'Failed to find tsgolint executable'

Verdict: middle. Confidence: medium.

The thesis and antithesis got different speedups (4x and 10x). My numbers explain why: the host rerun with three typed rules denied took 1.0s, the default run took 0.5s, and ESLint on the host took 4.5s. The ratio depends on which rules are enabled. Speedups this large are certain in direction but not in exact size. The missing-tsgolint error reproduced exactly as the antithesis described.

Citations:

- [r5a](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Builds TypeScript programs using typescript-go and executes type-aware rules, returning structured diagnostics to Oxlint."
- [r5b](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "TypeScript 7.0+ is required"

Thesis (medium): Option (a), Oxlint plus tsgolint, is the only alternative I confirmed as typescript-go based. The Oxlint docs say type-aware linting comes from tsgolint, which builds programs with typescript-go, and that it covers 59 of 61 type-aware typescript-eslint rules. I measured Oxlint 1.87.0 with oxlint-tsgolint 7.0.2003 on `src scripts packages` (414 files, 111 rules): 1.1s with `--type-aware`, 0.06s without it. Against that, `npx eslint src scripts packages` took 4.6s. The speedup is about 4x on the host, and ESLint ran with the repo's full config while Oxlint ran with defaults, so the rule sets differ. Oxlint with its default rules reported 21 warnings. Adding `--type-aware` produced 177 warnings including no-floating-promises, but I did not map them to the repo's config. I never checked that tsgolint works with a TS 7 install in this repo, and it ships its own typescript-go, so it does not need the repo's `typescript` package at all. That supports the claim that tsgolint is independent of the repo's TS version, but not that it supports TS 7.

Thesis citations:

- [c12](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Type-aware linting currently supports 59 out of 61 type-aware rules from typescript-eslint."
- [c13](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Builds TypeScript programs using typescript-go and executes type-aware rules, returning structured diagnostics to Oxlint."

Antithesis: [confidence: high] The thesis reports ~4x (1.1s vs 4.6s) and notes the rule sets differ, which makes the number weakly comparable. I re-ran both on `src scripts packages`. ESLint with the repo config took 5.5s. Oxlint 1.87.0 with `--type-aware` and default rules took 0.5s ('Finished in 454ms on 414 files with 111 rules using 18 threads'). Because `oxlint-tsgolint` is not installed in the repo, I pointed `OXLINT_TSGOLINT_PATH` at a /tmp install. That is ~10x on this machine, not ~4x. It is still not apples to apples, because Oxlint ran defaults and not the repo's ~60-rule set. Neither number is a defensible figure for the decision.

Antithesis: [confidence: high] The thesis says it 'never checked that tsgolint works with a TS 7 install in this repo'. The docs answer this directly: type-aware linting requires TS 7.0+ (typescript-go) and rejects legacy tsconfig options. So Oxlint is TS-7-native by construction, and the open question is the repo's tsconfigs, not tsgolint support.

Antithesis: [confidence: medium] The thesis never mentions the tooling friction I hit. `oxlint --type-aware` fails with 'Failed to find tsgolint executable' unless `oxlint-tsgolint` is installed alongside, so the dependency swap must add two packages, not one.

Antithesis: The claim that tsgolint 'does not need the repo's typescript package at all' is right, but it is presented as supporting TS 7 independence. It is stronger than that: typescript-go is the engine, so Oxlint type-aware linting would work on a TS 6 repo too. It is not a TS 7 blocker either way.

Counter-evidence:

- [e1](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Type-aware linting is powered by typescript-go ."
- [e2](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Very large codebases may encounter high memory usage"

### 6. JS plugins are alpha and support ESLint selectors. `eslint-plugin-sonarjs` is on Oxlint's conformance list, so the six sonarjs rules could load as a JS plugin. The webview's React rules come from `@eslint-react`, not `eslint-plugin-react-hooks`, and `@eslint-react` is not on the conformance list. Some of its rules have native Oxlint react/* equivalents: rules-of-hooks, exhaustive-deps, purity, set-state-in-effect, static-components, and also `react-refresh` only-export-components. `@eslint-react/no-unused-props` has no native equivalent. I did not check set-state-in-render, use-state, naming-convention-ref-name, web-api-no-leaked-event-listener, web-api-no-leaked-timeout, no-nested-component-definitions, dom-no-unsafe-target-blank or jsx-a11y-x/no-autofocus. JS plugins cannot run type-aware rules

Verdict: middle. Confidence: medium.

The antithesis was right that the thesis treated react-hooks conformance as if it covered `@eslint-react`. Its claim that React parity is 'unproven' is now partly settled by my grep of `--rules`, which found several native matches and confirmed no-unused-props is missing.

Citations:

- [r6a](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "eslint-plugin-sonarjs ( conformance test results )"
- [r6b](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "Lint rules that rely on TypeScript type-awareness."
- [r6c](../../webview_panels/eslint.config.mjs): ""@eslint-react/no-unused-props": "error","
- [r6d](../../webview_panels/eslint.config.mjs): ""react-refresh/only-export-components": ["

Thesis (medium): Oxlint's custom-rule and plugin story is usable but alpha. Its JS plugin API is ESLint v9+ compatible and supports selectors, so the repo's `no-restricted-syntax` selectors and ESLint's own `no-restricted-*` rules are plausible to carry over through `jsPlugins`. The same page lists `eslint-plugin-sonarjs` and `eslint-plugin-react-hooks` among the conformance-tested plugins, which would cover cognitive-complexity and the hooks rules. The page lists JS plugins as alpha, and the repo's boundary rules are what the architecture relies on. It also lists 'Lint rules that rely on TypeScript type-awareness' as not yet supported in JS plugins, which does not affect the no-restricted rules. I did not verify native Oxlint rules for `no-restricted-imports` or `max-lines-per-function` by name. I also did not verify `@eslint-react` and `jsx-a11y-x` equivalents, though Oxlint has built-in jsx-a11y and react plugins.

Thesis citations:

- [c14](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "JS plugins are currently in alpha, and remain under active development."
- [c15](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "eslint-plugin-sonarjs ( conformance test results )"
- [c16](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "Selectors ( ESLint docs )."

Antithesis: [confidence: high] The thesis says it did not verify native `no-restricted-imports` or `max-lines-per-function` 'by name'. Both exist (see point 3). The thesis therefore overstates the dependence on alpha JS plugins for the size rules.

Antithesis: [confidence: medium] Its claim that JS plugins cover sonarjs and react-hooks is correct per the docs. But the Oxlint page says for react-hooks that 'some of these rules are already supported natively in Oxlint, and so those should generally be used instead'. The thesis does not note that the repo's React rules are `@eslint-react/*` (rules-of-hooks, exhaustive-deps, purity, set-state-in-effect, static-components, no-unused-props), not `eslint-plugin-react-hooks`. `@eslint-react` is not on the conformance list the thesis cites. So the webview React rule parity is unproven and the thesis does not flag the difference.

Antithesis: [confidence: low] The webview's `jsx-a11y-x` and `react-refresh` rules also lack a named Oxlint equivalent in the thesis. It only says built-in jsx-a11y exists.

Antithesis: The conformance list names `eslint-plugin-sonarjs` and `eslint-plugin-react-hooks` but not `@eslint-react/eslint-plugin`. The thesis reads this as covering 'the hooks rules'. That is not shown for this repo's actual plugin.

Counter-evidence:

- [f1](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "Lint rules that rely on TypeScript type-awareness."
- [f2](../../webview_panels/eslint.config.mjs): ""@eslint-react/exhaustive-deps": "error","

### 7. Oxlint does have bulk suppressions, available since v1.64.0. `--suppress-all` and `--prune-suppressions` work in the installed 1.87.0. They write and prune `oxlint-suppressions.json` in ESLint's file → rule → count schema, and suppressed violations exit 0. The risk is stability, not absence. Maintainers deliberately hid the flags from `--help` and the docs to keep room for breaking changes, and the PR that would document them is still a draft. So the baseline carries over, but the oxlint version must be pinned and the format treated as unstable

Verdict: antithesis. Confidence: high.

I ran it in /tmp: `--suppress-all` created the file, a rerun reported 0 errors, `--prune-suppressions` updated it, and `oxlint --help` shows neither flag. I read the quotes from PR 26057 myself. The thesis's 'largest blocker' turns out to be a stability risk that can be managed.

Citations:

- [r7a](https://github.com/oxc-project/oxc/pull/26057): "Bulk suppressions have been available since oxlint v1.64.0, so this is the minimal change needed if the CLI is now intended to be discoverable."
- [r7b](https://github.com/oxc-project/oxc/pull/26057): "#22328 intentionally hid --suppress-all and --prune-suppressions from the CLI help and generated documentation while maintainers decided whether the feature should ship and to preserve room for breaking changes."

Thesis (low): Oxlint has no baseline or bulk-suppression mechanism that I could confirm. The inline-comments page I fetched documents `oxlint-disable`-style comments and links to ignore files, and neither covers a baseline. The root `eslint-suppressions.json` has 117 lines, spread over files and rule counts. Dropping ESLint means choosing between converting those entries to inline `oxlint-disable` comments, which touches many source files, and building a replacement. The second contradicts 'don't invent custom tooling'. This is the largest unresolved blocker for option (a). I did not search Oxlint's changelog for a suppressions feature, so a gap in my reading may account for it. A reader should check the Oxlint changelog before rejecting the option.

Thesis citations:

- [c17](../../eslint.config.mjs): "// Violations present when a rule was introduced live in eslint-suppressions.json; new ones fail `just lint`."
- [c18](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "Inline disable directives. ( // oxlint-disable )"

Antithesis: [confidence: high] This is the thesis's biggest miss. It says Oxlint has 'no baseline or bulk-suppression mechanism that I could confirm', and itself says 'I did not search Oxlint's changelog'. A search of the oxc repo finds one. Bulk suppressions (`--suppress-all`, `--prune-suppressions`) have shipped since oxlint v1.64.0, and the installed 1.87.0 is well past that. Oxc PR 26057 says so, and the issue tracker lists `--pass-on-unpruned-suppressions` (PR 23468 closed), `--suppress-rule`, and LSP bulk-suppression support (#21199, open).

Antithesis: [confidence: high] The feature is an ESLint-bulk-suppression analogue, and it is hidden. PR 22328 removed the flags from `--help` and the generated docs 'while maintainers decided whether the feature should ship' and 'to preserve room for breaking changes'. PR 26057 (still a draft, 2026-09-23) asks whether they should be public. So the feature exists but is unsupported and could change, which is a real risk for a gate whose ratchet reads the file. It is not 'no equivalent'.

Antithesis: [confidence: low] I could not exercise `--suppress-all` on this repo. The sandbox denied shell file writes, and the flag does not appear in `oxlint --help`. I also did not read the suppression file schema, so I cannot say whether `suppressionTotal` can be adapted without rewriting the ratchet's two `measure` functions. The 'type-aware line directives are matched against tsgolint's `=>`/`=` token' issue (#27084, seen only as a title in an API search) hints that type-aware diagnostics may interact badly with line-based suppressions. I did not read it.

Antithesis: [confidence: medium] The tracker also holds an open request for a ratchet feature (#25279), and oxc issue #10549 asks for ESLint-style suppression files. These show maintainers know of the gap. The repo's existing `ratchet.mjs` already covers the counting side of #25279.

Antithesis: The thesis cites the inline-comments page as evidence of no baseline. The absence of a baseline from a page about inline comments says nothing, and the thesis labels its own reading incomplete. The 'largest unresolved blocker' framing for option (a) is therefore wrong: the blocker is the stability of a hidden feature, not its absence.

Counter-evidence:

- [g1](https://github.com/oxc-project/oxc/pull/26057): "Bulk suppressions have been available since oxlint v1.64.0, so this is the minimal change needed if the CLI is now intended to be discoverable."
- [g2](https://github.com/oxc-project/oxc/pull/26057): "expose --suppress-all and --prune-suppressions in oxlint --help"
- [g3](https://github.com/oxc-project/oxc/pull/22328): "This PR removes the two flags from the documentation to give us the option to make breaking changes in future."

### 8. Biome 2.x (2.5.15) is not a good fit, and the reason is rule maturity, not TS 7. Its Types domain uses Biome's own scanner and inference engine instead of tsc, so it does not depend on the TS version. But every typed rule in that domain is nursery. The domain does include noFloatingPromises, noMisusedPromises, noBaseToString, useAwaitThenable and useExhaustiveSwitchCases, so the antithesis undercounted it. There is no no-unsafe-* family, and no counterpart for most of the webview's recommendedTypeChecked/stylisticTypeChecked presets. Biome would therefore weaken the typed layer the most of any option. I did not read its `noRestrictedImports`, GritQL or sonarjs equivalents

Verdict: middle. Confidence: medium.

I read the Biome domains page myself. The thesis's cited quote was about suppressions, not about typed rules, so it did not support its claim.

Citations:

- [r8a](https://biomejs.dev/linter/domains/): "This domain contains rules that perform project-level analysis."
- [r8b](https://biomejs.dev/linter/domains/): "noFloatingPromises (nursery)"
- [r8c](https://biomejs.dev/linter/domains/): "useExhaustiveSwitchCases (nursery)"

Thesis (low): Option (b), Biome 2.x, is weakly evidenced and I would not recommend it as a replacement. The page I fetched covers suppression but not how Biome does type-aware rules or TS 7. Biome has `biome lint --suppress --reason`, which writes suppression comments in place. That is inline-comment based, not a baseline file like ESLint's bulk suppressions. It has domains, including a `Types` domain, and GritQL-based linter plugins. I did not confirm that Biome's type-aware rules work on TS 7 or without tsc, nor what its `noRestrictedImports` supports compared with the repo's `importNames` and regex patterns. I also found no Biome equivalent of sonarjs cognitive-complexity or of `postMessage` selector restrictions beyond GritQL. Biome would also replace Prettier and the organize-imports plugin, but Biome's formatter differs from Prettier's output by design, so formatting churn is likely.

Thesis citations:

- [c19](https://biomejs.dev/linter/#type-aware-linting): "Lint the project by suppressing possible new rules that are caught by Biome, using the following command:"

Antithesis: [confidence: medium] The thesis says Biome type-aware rules cannot be confirmed to work 'without tsc' or on TS 7. Biome's docs answer this. Its Types domain runs on Biome's own inference engine and scans the project; it does not call the TypeScript compiler. That makes Biome independent of the TS version by construction, whereas the thesis implies an open question.

Antithesis: [confidence: high] The real Biome weakness is rule maturity, not TS 7. The Types-domain rules (`noFloatingPromises`, `noMisusedPromises`, `noBaseToString`, `noUnsafePlusOperands`) are all marked nursery. That is a much smaller set than tsgolint's 59 type-aware rules. The repo's `no-unsafe-*`, `await-thenable`, `switch-exhaustiveness-check`, `no-unnecessary-type-assertion` and the webview's whole recommendedTypeChecked/stylisticTypeChecked presets have no named Biome counterpart in that domain list. So Biome would drop most of the type-aware layer. That is a stronger reason to reject it than the thesis gives.

Antithesis: [confidence: low] The thesis also did not read Biome's `biome lint --suppress` against the baseline need beyond one sentence, and it did not open the GritQL plugin page. Its 'no equivalent of sonarjs cognitive-complexity' is plausible but unchecked.

Antithesis: The thesis cites the `biomejs.dev/linter/` suppress sentence as evidence about type-aware linting. That sentence is about suppression only, so the cited quote does not support the 'type-aware' part of the claim.

Counter-evidence:

- [h1](https://biomejs.dev/linter/domains/): "This domain contains rules that perform project-level analysis."
- [h2](https://biomejs.dev/linter/domains/): "noFloatingPromises (nursery)"
- [h3](https://biomejs.dev/linter/domains/): "noMisusedPromises (nursery)"

### 9. Option (d) is progressing but has no date. As of 2026-09-29, typescript-eslint's TS 7 support targets TS 7.1's new API. PR #12803 is close to internal review, and the team expects no big speedup over TS 6 in the first, IPC-based version. Waiting therefore buys neither TS 7, which the alias already gives, nor speed. Its only benefit is TS 7 type information inside ESLint

Verdict: antithesis. Confidence: high.

I fetched the issue comments through the GitHub API myself. The thesis relied on a 2025 comment.

Citations:

- [r9a](https://api.github.com/repos/typescript-eslint/typescript-eslint/issues/10940/comments?per_page=2&page=12): "Status update: typescript-eslint's WIP TypeScript 7.1 support is looking more and more stable."
- [r9b](https://api.github.com/repos/typescript-eslint/typescript-eslint/issues/10940/comments?per_page=2&page=12): "So we're not expecting performance to be significantly better with TS7 than TS6 at least for this initial IPC-based version."

Thesis (low): Option (d), waiting for typescript-eslint to support TS 7, rests on stale evidence. The tracking issue #10940 is open, labelled 'accepting prs' and 'team assigned'. A 2025 comment in it says tsgo is not stable and will not likely be the primary version within 1-2 typescript-eslint majors. TS 7.0.2 is now `latest` on npm and typescript-eslint 8.71.1 still caps at `<6.1.0`. A project that must wait for a typescript-eslint release has no date to plan around. I fetched only the issue's initial page, not its later comments or a roadmap, so the current status is unknown.

Thesis citations:

- [c20](https://github.com/typescript-eslint/typescript-eslint/issues/10940): "tsgo is not stable and is many months away from being stable."

Antithesis: [confidence: high] The thesis reads an old 2025 comment ('tsgo is not stable') and concludes 'no date to plan around'. It fetched only the issue's first page. The comment thread, read through the GitHub API, shows a very different state. On 2026-07-09 bradzacher wrote that nothing can be done 'for now' because TS 7.0 has no stable JS API. On 2026-09-11 JoshuaKGoldberg wrote 'I'm working on this.' On 2026-09-29 he reported typescript-eslint's WIP TS 7.1 support (PR #12803) as 'looking more and more stable' and 'ready for internal team review'.

Antithesis: [confidence: high] This changes option (d). It does not pin a release date, but it shows (i) support depends on TS 7.1's new API, not 7.0, (ii) a PR is in review, and (iii) the team says 'we're not expecting performance to be significantly better with TS7 than TS6 at least for this initial IPC-based version'. So even after (d) lands, typed ESLint will not become fast. That removes most of the point of waiting, and it makes the Oxlint speed argument stronger.

Antithesis: [confidence: high] The thesis ignores that (d) is not a prerequisite for TS 7 at all, because of the alias route under point 1. Waiting is only needed if the owner wants the TS-7-only type information inside ESLint.

Antithesis: The thesis treats the 'accepting prs / team assigned' labels and a stale comment as the current status. The labels are real but were set in 2025. They are not evidence of the project's stance in October 2026.

Counter-evidence:

- [i1](https://api.github.com/repos/typescript-eslint/typescript-eslint/issues/10940/comments?per_page=2&page=12): "Status update: typescript-eslint's WIP TypeScript 7.1 support is looking more and more stable."
- [i2](https://api.github.com/repos/typescript-eslint/typescript-eslint/issues/10940/comments?per_page=2&page=12): "So we're not expecting performance to be significantly better with TS7 than TS6 at least for this initial IPC-based version."
- [i3](https://api.github.com/repos/typescript-eslint/typescript-eslint/issues/10940/comments?per_page=2&page=11): "For **now** - there is nothing we can do to support tsgo / TSv7. As mentioned in the blog post and highlighted above - there is currently no stable JS API."
- [i4](https://api.github.com/repos/typescript-eslint/typescript-eslint/issues/10940/comments?per_page=2&page=11): "I'm working on this. I don't know how long it will take."

### 10. The current Prettier setup does block a plain TS 7 install. `.prettierrc` loads `prettier-plugin-organize-imports`, which uses the TypeScript language service. Its peer range `>=2.9` accepts TS 7, so npm will not warn. But typescript 7.0.2's main export `.` resolves only to `./lib/version.cjs`, so the compiler API is not there. The alias route fixes this. A future switch to oxfmt needs two tools: oxfmt's sortImports for sorting and Oxlint's no-unused-vars for unused imports. The markdown split (dprint/rumdl, managed by mise) is unaffected. Lefthook's `just lint-format`, `just lint-code` and `webviews::lint` jobs only change if the recipes behind them change

Verdict: antithesis. Confidence: high.

I read typescript@7.0.2's `exports` in the npm registry metadata myself, and the organize-imports peer range and `.prettierrc` myself. I did not verify oxfmt's CSS/HTML coverage or its output differences.

Citations:

- [r10a](https://registry.npmjs.org/typescript/7.0.2): ""exports":{".":"./lib/version.cjs""
- r10b (`node_modules/prettier-plugin-organize-imports/package.json`, removed in P5): ""typescript": ">=2.9","
- r10c (`.prettierrc`, removed in P5): ""plugins": ["prettier-plugin-organize-imports"]"

Thesis (medium): Formatting is a separate decision and Prettier does not block TS 7. Prettier is used as `prettier --check` over js/cjs/mjs/ts/tsx/css/html/json plus `prettier-plugin-organize-imports`, and `eslint-config-prettier` exists only to turn off ESLint style rules. The `organize-imports` plugin calls the TypeScript language service, so it is a TS-version-sensitive dependency. Prettier's own latest (3.9.9 on the host) is above the installed 3.9.8. oxfmt is the Prettier-compatible option from the same project, with a 'Migrate from Prettier' guide in its docs. I did not verify oxfmt's import sorting against `organize-imports` or its 0.72.0 stability. Markdown stays with dprint and rumdl, which are mise-managed and unaffected by a JS lint change. Lefthook has a `prettier` job that runs `just lint-format` and `typescript`/`webview` jobs that run `just lint-code` / `webviews::lint`, so each of those commands would be repointed.

Thesis citations:

- [c21](../../package.json): ""check:format": "prettier --check \"**/*.{js,cjs,mjs,ts,tsx,css,html,json}\"","
- [c22](../../lefthook.yml): "run: mise exec -- just lint-format"
- [c23](../../mise.toml): ""aqua:rvben/rumdl" = "latest""

Antithesis: [confidence: high] The thesis says 'Prettier does not block TS 7'. That is wrong for this repo. `prettier-plugin-organize-imports` imports the TypeScript language service. Its peer range is `typescript >=2.9`, so npm accepts TS 7, but TS 7.0.2 ships no compiler API. I installed `typescript@7.0.2` in /tmp: `require('typescript')` returns only `version` and `versionMajorMinor`, and `package.json` exports only `./unstable/*` entry points. So `just lint-format` would fail at runtime on a bare TS 7 install. The alias route fixes it, but the thesis states the opposite of what happens. The peer range of the plugin gives a false green light.

Antithesis: [confidence: medium] The thesis names oxfmt as 'Prettier-compatible' but does not check import handling. oxfmt's `sortImports` is documented as 'based on eslint-plugin-perfectionist/sort-imports' and 'Disabled by default'. It sorts and groups imports; `organize-imports` also removes unused imports through the language service. The unused-import removal moves to Oxlint (`no-unused-vars`/`unused-imports`), so the replacement is two tools, not one, and output will differ from the current style.

Antithesis: [confidence: low] The dprint/rumdl split is only noted as unaffected. Oxfmt's `Embedded formatting` and markdown/CSS/HTML language support was not checked against the repo's `**/*.{js,cjs,mjs,ts,tsx,css,html,json}` glob, so whether oxfmt covers `css`/`html` is unverified.

Antithesis: The thesis cites `package.json`'s `check:format` as proof that Prettier is fine. The line only shows what Prettier runs over, not that it works on TS 7.

Counter-evidence:

- j1 (`node_modules/prettier-plugin-organize-imports/package.json`, removed in P5): ""typescript": ">=2.9","
- [j2](https://oxc.rs/docs/guide/usage/formatter/sorting.html): "Based on eslint-plugin-perfectionist/sort-imports ."
- [j3](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): "we have made it a priority to ensure TypeScript can be run side-by-side with TypeScript 6.0 for the foreseeable future"

### 11. `npm outdated` from the root lists these bumps: @eslint-react/eslint-plugin 5.24.6→5.24.10, @tanstack/react-table 9.2.6→9.2.8, happy-dom 20.14.5→20.14.6, vite 8.3.3→8.3.4, concurrently 10.0.5→10.0.6, vscode-languageclient 10.1.1→10.1.2 (an exact pin in `dependencies`), typescript 6.0.3→7.0.2 in all three workspaces, @types/node 24→26, @types/vscode 1.125.0→1.140.0 and @vscode/codicons 0.0.45→0.0.46-24. Keep @types/node on 24, because `engines.node` in package.json is `>=24 <25` and mise pins `node = "24"`. Skip the codicons pre-release. Keep @types/vscode at 1.125.0. vsce refuses to package when @types/vscode's minor is above `engines.vscode` (^1.128.0). No @types/vscode 1.128.0 exists; the published versions jump from 1.125.0 to 1.134.0. So 1.125.0 is already the newest version that fits. Moving it means raising `engines.vscode` to at least 1.134, which is a product decision about the minimum supported VS Code

Verdict: middle. Confidence: high.

The antithesis said the right target was 1.128.0, but that version does not exist; `npm view @types/vscode@1.128.0` returns 404. I read vsce's validation code, which compares major and minor versions. I read the `engines` block in package.json directly; the `engines.node` line is too short to quote on its own. I did not produce the full per-package devDependency table; the package.json files list them.

Citations:

- [r11a](../../package.json): ""vscode": "^1.128.0","
- [r11b](../../package.json): ""@types/vscode": "1.125.0","
- [r11c](../../node_modules/@vscode/vsce/out/validation.js): "Either upgrade engines.vscode or use an older @types/vscode version"

Thesis (high): Dependency audit, verified parts. `npm outdated` shows these updates available: @eslint-react/eslint-plugin 5.24.6 to 5.24.10, @tanstack/react-table 9.2.6 to 9.2.8, @types/node 24.19.1 to 26.6.4 (kept at 24 to match the Node 24 pin in mise.toml), @types/vscode 1.125.0 to 1.140.0, @vscode/codicons 0.0.45 to 0.0.46-24 (a pre-release), concurrently 10.0.5 to 10.0.6, happy-dom 20.14.5 to 20.14.6, typescript 6.0.3 to 7.0.2, vite 8.3.3 to 8.3.4, vscode-languageclient 10.1.1 to 10.1.2. `@types/vscode` is pinned to 1.125.0 and must match the `engines.vscode` floor, so raising it is an extension-compatibility change that I did not check. The `@types/node` bump to 26 is not recommended while `node = "24"` is pinned in mise.toml.

Thesis citations:

- [c24](../../package.json): ""@types/vscode": "1.125.0","
- [c25](../../mise.toml): "# Contributor tooling only. None of this ships in the VSIX, and the extension must"

Antithesis: [confidence: high] The thesis says `@types/vscode` 'must match the `engines.vscode` floor' and lists 1.125.0 to 1.140.0 as an available bump, without noticing a mismatch in the repo. `engines.vscode` is `^1.128.0` but `@types/vscode` is pinned at 1.125.0, three minors behind the floor. The correct target is 1.128.0 (the floor), not `latest`: @vscode/vsce fails packaging with an error whenever `@types/vscode` is greater than `engines.vscode`. So 1.140.0 would break `vsce package`, and the audit should flag the stale 1.125.0 pin as the fix.

Antithesis: [confidence: low] The thesis says only 'installed-versus-latest bumps' were verified. It lists the ones `npm outdated` showed but never lists the full set of devDependencies and dependencies per workspace, which the task required. It also has nothing on `packages/webview-contract`. That workspace pins `typescript ^6.0.3` and has no lint toolchain of its own.

Antithesis: The thesis cites 'mise.toml' for the Node 24 pin ('Contributor tooling only...'). That quote supports the `@types/node` 24 decision only indirectly. The authoritative constraint is `engines.node ">=24 <25"` in `package.json`.

Counter-evidence:

- [k1](../../package.json): ""vscode": "^1.128.0","
- [k2](../../package.json): ""@types/vscode": "1.125.0","
- [k3](../../node_modules/@vscode/vsce/out/validation.js): "Either upgrade engines.vscode or use an older @types/vscode version"

### 12. A full Oxlint/oxfmt switch makes these redundant: eslint, typescript-eslint, @eslint/js, eslint-config-prettier and globals (in both workspaces), @eslint-react/eslint-plugin, eslint-plugin-jsx-a11y-x and eslint-plugin-react-refresh, plus prettier and prettier-plugin-organize-imports if oxfmt is adopted. eslint-plugin-sonarjs stays if it runs as a JS plugin. The switch adds oxlint, oxlint-tsgolint, and oxlint-plugin-eslint for no-restricted-syntax. `type-coverage` also uses the TS compiler API: its peer range allows 7, but it needs the TS 6 alias to keep working. It is the only consumer of the `fast-glob` shim (`npm ls fast-glob` shows only type-coverage-core). Removing it therefore removes the override cleanly, but also drops the two typeCoverage ceilings. `concurrently` is used twice, in `watch:extension` and in the justfile watch recipe. knip ignores `type-coverage` explicitly. jscpd is not installed, and sonarjs/no-identical-functions is the only check close to duplicate detection

Verdict: middle. Confidence: medium.

The antithesis was right about the type-coverage TS API dependency and the two `concurrently` uses; I verified both. Its worry that the override might affect other packages is ruled out by `npm ls`. I did not rerun knip, and I did not assess `which`, `vscode-uri` or dependency-cruiser's optional use of the TypeScript package.

Citations:

- r12a (`node_modules/type-coverage-core/package.json`, removed in P6): ""typescript": "2 || 3 || 4 || 5 || 6 || 7""
- [r12b](../../justfile): "npm exec --no -- concurrently --names contract,webview,extension"
- r12c (`scripts/quality/fast-glob-shim/package.json`, removed in P6): ""description": "Stand-in for fast-glob used by type-coverage-core; see index.cjs","
- [r12d](../../knip.json): ""ignoreDependencies": ["type-coverage"]"

Thesis (medium): Dependencies made redundant by an ESLint-to-Oxlint/oxfmt switch: `eslint`, `typescript-eslint`, `@eslint/js`, `eslint-config-prettier` and `globals` in both packages, `eslint-plugin-sonarjs` (if its rules load as an Oxlint JS plugin it stays as a dependency; if native rules replace it, it goes), `@eslint-react/eslint-plugin`, `eslint-plugin-jsx-a11y-x` and `eslint-plugin-react-refresh` in the webview, and `prettier` plus `prettier-plugin-organize-imports` if oxfmt replaces them. Those would be replaced by `oxlint`, `oxlint-tsgolint` and optionally `oxfmt`. `type-coverage` is the other lint-tool dependency: the root overrides carry a `fast-glob` stand-in whose own package.json says it exists for type-coverage-core. Removing `type-coverage` would also remove that override and the shim directory, but it would drop the `typeCoverage.host` 99.51 and `typeCoverage.webview` 99.27 ratchet ceilings, which tsgolint's no-unsafe-* rules only partly replace. `concurrently` is used once, in `watch:extension`, and is a candidate for replacement by npm-run-all-free alternatives such as a Just recipe with `&`, or by Node built-ins. `dependency-cruiser` and `knip` are not duplicated by the lint switch, and `jscpd` is not a dependency of this repo.

Thesis citations:

- c26 (`scripts/quality/fast-glob-shim/package.json`, removed in P6): ""description": "Stand-in for fast-glob used by type-coverage-core; see index.cjs","
- [c27](../../scripts/quality/ceilings.json): ""typeCoverage.host": 99.51,"
- [c28](../../package.json): ""watch:extension": "npm run build:contract && concurrently --names contract,extension \"npm run watch:contract\" \"npm run watch:extension:app\"","

Antithesis: [confidence: high] The thesis lists `type-coverage` only as a dependency to drop and misses that it is a TS-API tool. Its `type-coverage-core` peer range is `typescript 2 || 3 || 4 || 5 || 6 || 7`, so npm accepts TS 7. But TS 7.0.2 exposes no compiler API (checked locally: `require('typescript')` returns only the version keys). So `type-coverage` is a third hidden TS 7 runtime blocker, alongside typescript-eslint and organize-imports. It needs the TS 6 alias or removal. The thesis also does not weigh removing `type-coverage` against the two ratchet ceilings: it only says tsgolint's `no-unsafe-*` 'partly replace' them.

Antithesis: [confidence: high] The thesis says `concurrently` is 'used once'. It is used twice: in `package.json`'s `watch:extension` and in `justfile` line 83 (`npm exec --no -- concurrently --names contract,webview,extension ...`, three processes). A `just` recipe with `&` / `wait` replaces both with no dependency. The thesis also calls the replacement 'npm-run-all-free alternatives', which is unclear.

Antithesis: [confidence: high] The thesis suggests `knip` may flag unused dependencies but never reports its result. `npx knip` on the root (v6.40.0) printed only 'Unused tag ... @internal' notices in the output I read, and no unused-dependency findings. I only saw the tail (last 25 lines), so I cannot rule out earlier lines. The `knip.json` already sets `ignoreDependencies: ["type-coverage"]`, which shows the dependency is invoked from a script, not imported.

Antithesis: [confidence: low] `vscode-uri` is a root devDependency, and `which`/`@types/which` are needed because `which@7.0.0` ships no `types` field. I did not check whether `vscode-uri` is only used in tests, where the VS Code mock could supply it, or whether the `which` package could be replaced by a Node 24 built-in. Neither was assessed, although the task asked for Node 24 and VS Code API replacements.

Antithesis: [confidence: low] The thesis says `jscpd` 'is not a dependency of this repo' but does not say whether any duplicate-code check exists elsewhere, for example in `sonarjs/no-identical-functions`, which the Oxlint swap would also move.

Antithesis: The thesis cites `fast-glob-shim/package.json`'s description as showing the shim 'exists for type-coverage-core'. That is accurate, but it implies that removing `type-coverage` also removes the override cleanly. The override is a root-level `overrides` entry for `fast-glob`, so any other dependency that resolves `fast-glob` would silently use the stub. Whether that is true was not checked.

Counter-evidence:

- l1 (`node_modules/type-coverage-core/package.json`, removed in P6): ""typescript": "2 || 3 || 4 || 5 || 6 || 7""
- [l2](../../justfile): "npm exec --no -- concurrently --names contract,webview,extension"
- [l3](../../knip.json): ""ignoreDependencies": ["type-coverage"]"

### 13. The thesis's plan puts TS 7 last. It should come first, through the alias, with zero rule loss. After that the lint migration is an optional speed and dependency-count win. It should use Oxlint's native suppressions rather than custom tooling, and keep a small ESLint config until the alpha-only rules (no-restricted-syntax, sonarjs, the remaining @eslint-react rules) are proven or explicitly dropped

Verdict: antithesis. Confidence: medium.

With the alias route and native bulk suppressions verified, both of the thesis's premises for its ordering fail. The hybrid ordering keeps alpha JS plugins out of the CI gate until they are proven.

Citations:

- [r13a](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): ""typescript": "npm:@typescript/typescript6@^6.0.0","
- [r13b](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "oxlint --type-aware --report-unused-disable-directives"

Thesis (low): Recommended path: Oxlint with tsgolint, oxfmt for code, existing dprint and rumdl for markdown. This is a conditional recommendation, because the baseline gap (point 7) and the custom-rule check (point 6) are unresolved. Ordered PRs, each keeping `just check` green: (1) bump the safe patch/minor dependencies from point 11; (2) add Oxlint with `--type-aware` alongside ESLint in report-only mode and diff its output against the ESLint rules, which is a measuring step with no rule dropped; (3) before any deletion, prove each `no-restricted-*` boundary rule fires in Oxlint, either natively or as a JS plugin, using a fixture file that should fail; (4) resolve the suppression question and move the baseline and the ratchet's two `suppressionTotal` measures; (5) switch `just lint-code`, `webviews::lint`, lefthook and `lint:prune` to Oxlint and remove ESLint, typescript-eslint and the ESLint plugins; (6) swap Prettier and `organize-imports` for oxfmt if its output is acceptable, and update `just fmt` and `lint-format`; (7) decide on `type-coverage` and remove its shim and override if dropped; (8) bump TypeScript to 7.0.2 in all three packages. Rules dropped or weakened: any typescript-eslint type-aware rule that is not among tsgolint's 59 of 61, the stylistic-type-checked preset members that Oxlint lacks, the sonarjs rules without equivalents, the `@eslint-react` and `jsx-a11y-x` rules not matched by built-in plugins, `--report-unused-disable-directives` if absent, and the type-coverage ceilings if removed. This list is incomplete because I did not diff the rule sets rule by rule.

Thesis citations:

- [c29](../../justfile): "node scripts/quality/ratchet.mjs "$@""
- [c30](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Rule coverage, performance, and compatibility continue to improve."

Antithesis: [confidence: high] The migration plan ends with 'bump TypeScript to 7.0.2' as step 8, after the whole lint swap. That ordering is wrong. With the official alias route, TS 7 can be the very first PR: alias `typescript` to `@typescript/typescript6` for typescript-eslint, `type-coverage` and organize-imports, add `typescript-7` for `tsc`, and keep every lint rule. That meets the owner's 'latest versions' goal immediately with zero rule loss, and it is the lowest-risk step. The thesis's 'end with TypeScript 7' structure follows from the unverified premise in point 1.

Antithesis: [confidence: high] Step 4, 'resolve the suppression question', defers to 'building a replacement', which the thesis itself says contradicts 'don't invent custom tooling'. The native, hidden Oxlint bulk-suppression flags (v1.64.0+) exist, so the plan should try them and record the format and stability risk, not default to inline comments or custom tooling.

Antithesis: [confidence: medium] A hybrid is missing: Oxlint with tsgolint for the typescript/* rules and the native size rules, plus ESLint kept only for the custom `no-restricted-syntax` selectors, `@eslint-react` and `jsx-a11y-x`, and `eslint-plugin-oxlint` ('Turn off all rules already supported by oxlint') to avoid double-reporting. ESLint then no longer needs `parserOptions.project`, so the typed-ESLint cost disappears. The plan still keeps the ESLint baseline file for the remaining rules, and the ratchet's measure functions stay valid. It lowers risk because the alpha JS-plugin path is not on the critical path.

Antithesis: [confidence: low] The plan names 'dropped or weakened' rules only generically ('any rule not among the 59'). The task asked for every dropped or weakened rule to be named, so the plan is incomplete. It also does not mention `--report-unused-disable-directives`, which Oxlint documents for type-aware runs, as a replacement for ESLint's unused-disable reporting.

Counter-evidence:

- [m1](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "oxlint --type-aware --report-unused-disable-directives"
- [m2](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): ""typescript": "npm:@typescript/typescript6@^6.0.0","

### 14. Three packages use the TypeScript compiler API without warning on a plain TS 7 install, because their peer ranges accept 7 or they declare none: typescript-eslint (whose peer range does warn), prettier-plugin-organize-imports and type-coverage. TS 7.0.2 exposes only a version stub at its main entry. Any plan that installs `typescript@7` without the alias will pass `npm install` and then fail at runtime in `just lint-format` and in the type-coverage ratchet

Verdict: new. Confidence: high.

This follows from the registry `exports` and the two peer ranges I read. dependency-cruiser may be a fourth consumer; I did not check.

Citations:

- [r14a](https://registry.npmjs.org/typescript/7.0.2): ""exports":{".":"./lib/version.cjs""
- [r14b](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): "we won&#8217;t have a stable programmatic API available until at least several months from now with TypeScript 7.1."

## Alternatives the thesis missed

[confidence: high] Alias route (option 0): take TS 7 now and keep ESLint, typescript-eslint and Prettier unchanged. Install `typescript` as `npm:@typescript/typescript6@^6.0.0` (for typescript-eslint, `type-coverage` and `prettier-plugin-organize-imports`) and add `typescript-7` as `npm:typescript@^7`, so `npx tsc` runs the TS 7 compiler. Microsoft documents this as the supported side-by-side setup, so the owner's stated blocker (the typescript-eslint peer range) is lifted without losing a single rule. `@typescript/typescript6` is at 6.0.2 on npm and satisfies the `<6.1.0` peer range. The cost is one extra dependency until TS 7.1 ships a real API and typescript-eslint's WIP PR lands. It is the only option that also keeps the ratchet, the baseline and the type-coverage ceilings untouched.

- [n1](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): "Because some tools like typescript-eslint expect to import from typescript directly via peer dependencies, we recommend achieving this via npm aliases."
- [n2](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): ""typescript-7": "npm:typescript@rc","
- [n3](https://api.github.com/repos/typescript-eslint/typescript-eslint/issues/10940/comments?per_page=2&page=12): "Status update: typescript-eslint's WIP TypeScript 7.1 support is looking more and more stable."

[confidence: medium] Hybrid (a+c): run Oxlint with tsgolint for the typescript/* type-aware rules and the native size/restriction rules, and keep a thin ESLint config only for what Oxlint lacks natively (the `no-restricted-syntax` selectors, `@eslint-react/*`, `jsx-a11y-x`, `react-refresh`). Add `eslint-plugin-oxlint` to turn off the ESLint rules Oxlint already covers. ESLint then needs no `parserOptions.project`, which removes the slow typed-ESLint cost, and the baseline file and ratchet carry on for the remaining rules. TS 7 comes through the alias route above. It is a smaller blast radius than a full switch because no alpha JS plugin has to gate CI. Its cost is two linters to run, two configs, and a rule-ownership table to keep in sync.

- [o1](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-properties.html): "This rule was added in v1.63.0."
- [o2](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "Lint rules that rely on TypeScript type-awareness."
- [o3](../../eslint.config.mjs): "// Flat config replaces rule options per file, so an exemption re-sets the whole rule minus its own entries."

[confidence: medium] Use Oxlint's native, still-hidden bulk suppressions (v1.64.0+) as the baseline in a full Oxlint switch, and gate the swap on a spike. The spike would run `oxlint --type-aware --suppress-all`, read the file format, and adapt the two `suppressionTotal` measures in `ratchet.mjs`. The file's stability is explicitly unpromised by the maintainers, so the ratchet should pin the oxlint version and treat the format as an adapter-level detail.

- [p1](https://github.com/oxc-project/oxc/pull/26057): "Bulk suppressions have been available since oxlint v1.64.0, so this is the minimal change needed if the CLI is now intended to be discoverable."
- [p2](https://github.com/oxc-project/oxc/pull/22328): "This PR removes the two flags from the documentation to give us the option to make breaking changes in future."
- [p3](../../scripts/quality/ratchet.mjs): "measure: () => suppressionTotal("eslint-suppressions.json"),"

[confidence: medium] Dependency removals the thesis missed or mis-sized, all independent of the lint choice. (1) `concurrently` is used in two places (`package.json` `watch:extension` and `justfile` line 83), and a `just` recipe using background jobs replaces both. (2) `@types/vscode` should move to the engine floor 1.128.0, not to `latest`, because vsce rejects a newer `@types/vscode` than `engines.vscode`. (3) `type-coverage` and `prettier-plugin-organize-imports` are hidden TS 7 runtime blockers whose peer ranges accept TS 7, so removing or re-pointing them is part of any TS 7 plan.

- [q1](../../justfile): "npm exec --no -- concurrently --names contract,webview,extension"
- [q2](../../package.json): ""vscode": "^1.128.0","
- [q3](../../node_modules/@vscode/vsce/out/validation.js): "Either upgrade engines.vscode or use an older @types/vscode version"
- q4 (`node_modules/type-coverage-core/package.json`, removed in P6): ""typescript": "2 || 3 || 4 || 5 || 6 || 7""

## Open questions

- Why does tsgolint report no-unsafe-assignment in `src/features/docs/docsYaml.ts` and `dbtTestService.ts` when ESLint with TS 6 does not? Is it a tsconfig-resolution difference or a real semantic change in TS 7?
- Does `just check` (tsc, rsbuild, Vite, Vitest, knip, dependency-cruiser and the ratchet) pass with the typescript6/typescript-7 alias? Does dependency-cruiser or knip load the `typescript` package at runtime?
- Do the repo's no-restricted-syntax selectors, including the `:not([callee.object.name='window'])` exemptions and per-file overrides, behave the same under `oxlint-plugin-eslint` as JS plugins? A fixture that must fail would show it.
- Do the unchecked @eslint-react rules (set-state-in-render, use-state, naming-convention-ref-name, web-api-no-leaked-*, no-nested-component-definitions, dom-no-unsafe-target-blank) and jsx-a11y-x/no-autofocus have native Oxlint equivalents, and does @eslint-react run as an Oxlint JS plugin?
- Will oxc keep the hidden `--suppress-all`/`--prune-suppressions` flags and the `oxlint-suppressions.json` schema stable (PR 26057 and the #22198 RFC)?
- How much formatting churn does oxfmt produce compared with Prettier plus organize-imports on this repo, and does it cover the css/html/json files in the current glob?
- Should `engines.vscode` be raised to 1.134 or later so @types/vscode can move off 1.125.0?

## Rejected citations

None.
