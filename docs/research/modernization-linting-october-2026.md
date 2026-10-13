# Research

## Question

Which automated checks and codemods, compatible with an Oxlint-only toolchain, flag and fix code that uses older-but-supported Node, TypeScript, React or ECMAScript patterns where Node 24, TypeScript 7, React 19 and Electron 42's Chromium offer newer ones, like Ruff's pyupgrade rules for Python, and what do they find in this repository today?

## Recommendation

Use Oxlint for all of it, in three layers in .oxlintrc.json. Layer one is the built-in rules with `options.typeAware: true` and the react plugin on: unicorn/prefer-node-protocol, prefer-import-meta-properties, prefer-string-replace-all, prefer-at, prefer-global-this, prefer-set-has, prefer-optional-catch-binding, eslint/prefer-object-has-own, typescript/prefer-optional-chain, prefer-nullish-coalescing, prefer-includes, no-deprecated, consistent-type-imports and parameter-properties, plus the react compiler rules (globals, refs, immutability, purity, set-state-in-effect, preserve-manual-memoization, use-memo). Layer two is e18e's untyped modernization rules through `jsPlugins` (prefer-array-to-sorted, prefer-array-from-map, prefer-timer-args, prefer-regex-test, prefer-spread-syntax). Leave prefer-static-regex off unless you want a performance sweep. Layer three is eslint-plugin-compat through `jsPlugins` with a Chromium-148 Browserslist on webview_panels/src only, as a floor guard. Skip eslint-plugin-n, because it duplicates the built-in node-protocol rule, and skip prefer-structured-clone. Wire `oxlint` into `just lint`. Seed oxlint-suppressions.json with `--suppress-all` so every rule with findings starts at error but suppressed, and let `just lint-ratchet` stop the count rising. That way new code can't add violations. Add TS 7 `tsc --noEmit` runs with `--erasableSyntaxOnly` and `--verbatimModuleSyntax` as ratcheted counts until each reaches zero, then set the flag in tsconfig. PRs, in order: (1) config, suppressions and type-aware wiring, with no code changes; (2) `oxlint --fix` for prefer-node-protocol (317 fixes in 155 files) plus the other safe fixes (import-meta-properties, object-has-own, string-replace-all, optional-catch-binding); (3) typescript/consistent-type-imports `--fix` (about 515 TS1484 sites), then enable verbatimModuleSyntax; (4) reviewed dangerous and suggestion fixes: prefer-at, e18e toSorted and array-from-map, optional-chain and nullish-coalescing (the `??` swap changes behaviour for falsy values); (5) `npx codemod react/19/remove-context-provider` on webview_panels/src (14 sites in 6 files); (6) manual work: the 16 no-deprecated findings, the 13 React Compiler findings and the 7 exhaustive-deps findings; (7) convert parameter properties, about 200 sites with no autofix, then enable erasableSyntaxOnly. The Node userland codemods find nothing to change here, so make no PR from them. Package changes are not warranted: keep `which`, and uuid is only an override.

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Verdict    | Confidence |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1. Oxlint 1.87.0's built-in rules handle much of the pyupgrade-style modernization. That includes unicorn/prefer-node-protocol, prefer-import-meta-properties, prefer-string-replace-all, prefer-at, prefer-set-has, prefer-structured-clone, prefer-global-this, eslint/prefer-object-has-own and others. Their fix kinds (safe, dangerous, suggestion) are as the thesis listed. The list was incomplete in three ways. First, the typed rules (typescript/prefer-optional-chain, prefer-nullish-coalescing, prefer-includes, prefer-string-starts-ends-with, no-deprecated) only run with `--type-aware` (or `options.typeAware: true`) and the oxlint-tsgolint binary. Without that flag they never run, so they report nothing. Second, the React Compiler-style rules (react/globals, immutability, refs, purity, set-state-in-effect, preserve-manual-memoization, use-memo and others) need the react plugin turned on. Third, typescript/no-deprecated is the closest native match for pyupgrade's deprecated-API checks. | middle     | high       |
| 2. The untyped counts hold. I re-ran several of them: unicorn/prefer-node-protocol 317 findings, unicorn/prefer-structured-clone 3 (all in packages/webview-contract/src/guards.test.ts), and the others the antithesis also confirmed. The claimed 'zero hits' for the typed rules is an error caused by the missing flag. With `--type-aware` I measured (findings/files) typescript/prefer-nullish-coalescing 40/23, prefer-optional-chain 14/12, prefer-includes 8/6, and no-deprecated 16/7. So node: protocol is the largest single autofix sweep, but not the only meaningful one. The antithesis also reported prefer-string-starts-ends-with 4/4 and prefer-regexp-exec 9/7, which I did not re-run. Root-level config files (rsbuild.config.ts, vitest.config.ts, typings.d.ts, webview_panels/*.config.*) were outside both sweeps.                                                                                                                                                                                     | antithesis | high       |
| 3. @e18e/eslint-plugin 0.8.1 runs under Oxlint 1.87.0 through `jsPlugins`. It is the strongest pyupgrade-like layer beyond the built-in rules. With its untyped modernization, module-replacement and performance rules enabled, I measured on the four roots: prefer-static-regex 146, prefer-array-at 27, prefer-spread-syntax 16, prefer-array-from-map 13, prefer-array-to-sorted 13, prefer-object-has-own 3, prefer-regex-test 3, prefer-timer-args 3. prefer-array-to-sorted (ES2023 `toSorted`) and prefer-array-from-map have no built-in Oxlint counterpart. e18e's type-aware rules do not run under Oxlint. Linting package.json with ban-dependencies needs ESLint's JSON language support (@eslint/json or jsonc-eslint-parser), so that use has no Oxlint home. The antithesis says the separate `@e18e/cli analyze` command covers it without ESLint; I did not verify that.                                                                                                                                       | antithesis | high       |
| 4. The root package.json has only three runtime dependencies: vscode-languageclient, which and yaml. `uuid` and `fast-glob` appear only in the `overrides` block, which pins transitive versions. Nothing in the source imports them, so 'replace uuid with crypto.randomUUID' is not a task. `which` is imported once, in src/fusion/fusionExecutable.ts. Node 24 has no drop-in equivalent, so keeping it is reasonable. On the npm side, the lockfile has one deprecated package: node_modules/@vscode/test-cli/node_modules/mocha/node_modules/glob 10.5.0. That glob is pulled in by @vscode/test-cli, not by this repo directly.                                                                                                                                                                                                                                                                                                                                                                                             | antithesis | high       |
| 5. React 19 patterns are almost entirely modern already. `use(Context)` is in use (useAppContext.ts), and no file in webview_panels/src calls `useContext(`. The one legacy pattern left is the 14 `Context.Provider` sites in 6 test files. The official codemod react/19/remove-context-provider converts them. Oxlint has built-in React Compiler-readiness rules, and with the react plugin on, webview_panels/src gives (findings/files): react/globals 4/3, refs 3/1, immutability 2/2, set-state-in-effect 2/2, incompatible-library 1/1, preserve-manual-memoization 1/1, react-hooks/exhaustive-deps 7/7. That is 13 compiler-style findings plus 7 exhaustive-deps. Oxlint has no rule that flags `Context.Provider` or `useContext`, so the codemod is the tool for that.                                                                                                                                                                                                                                               | antithesis | high       |
| 6. The Node.js userland-migrations codemods have nothing to change in this repo. The antithesis ran `@nodejs/v22-to-v24` in dry-run over every root and reported 'Would modify 0 files'. Its recipe list (chalk-to-util-styletext, axios-to-whatwg-fetch, import-assertions-to-attributes, rmdir and others) has no recipe for node: protocol, fs.promises, promisify, fs.glob or uuid. The one site that looks like a candidate, `fs.rmdirSync(testDir)`, is non-recursive, so the rmdir recipe does not apply. Run the codemods once as a check, not as a recurring gate, and make no PR from them.                                                                                                                                                                                                                                                                                                                                                                                                                              | antithesis | medium     |
| 7. TypeScript 7.0.2 compiles the root and integration tsconfigs, webview_panels/tsconfig.json and tsconfig.test.json, and the contract tsconfig with no diagnostics. So no removed or deprecated tsconfig option is in use today. The antithesis also reports webview_panels/tsconfig.node.json clean; I did not run that one. The real TS-7-era work is in two opt-in flags. `--erasableSyntaxOnly` gives 205 TS1294 errors in 78 files in the root project; about 200 are constructor parameter properties, not enums. It also gives 10 in webview_panels/tsconfig.test.json and 0 in the contract. `--verbatimModuleSyntax` gives TS1484 errors: 337 in root, 159 in webview_panels/tsconfig.test.json, 19 in the contract. Oxlint's typescript/consistent-type-imports autofix handles that one. Parameter properties have no autofix; Oxlint's typescript/parameter-properties can only stop new ones being added.                                                                                                            | antithesis | high       |
| 8. eslint-plugin-n 18.4.1 and eslint-plugin-compat 7 both run under Oxlint 1.87.0 through `jsPlugins`. eslint-plugin-n gives n/prefer-node-protocol 317 (the same as the built-in unicorn rule, so redundant) and n/prefer-promises/fs 2 (fs.watch in one integration test). Its no-deprecated-api, prefer-global/* and no-unsupported-features/* rules find nothing. eslint-plugin-compat with `BROWSERSLIST='chrome 148'` finds 0 issues across 164 webview files; at `chrome 40` it finds 21, which shows it is really running. So compat can guard the webview's Chromium floor. It catches APIs that are too new, which is the opposite of what pyupgrade does. eslint-plugin-es-x was installed but nobody measured it. No tool flags hand-written `Promise.withResolvers`-style deferreds or `util.styleText` and `fs.glob` opportunities. The 3 `promisify(execFile)` sites are correct, because child_process has no promise-based module.                                                                                | antithesis | high       |
| 9. The thesis's wiring is sound: add the rules to .oxlintrc.json, seed oxlint-suppressions.json with `--suppress-all`, and let the existing ratchet (`just lint-ratchet`, scripts/quality/ceilings.json) shrink the count. The details need changing. prefer-includes, prefer-optional-chain and prefer-nullish-coalescing are not zero-finding rules, so they must start suppressed, not as plain errors. `options.typeAware: true` and oxlint-tsgolint must be part of `just lint`. 'Replace uuid' is not a task. The TS step needs no sequencing, because TS 7 already passes. prefer-structured-clone should not be swept, because the guards.test.ts JSON round trips test what survives wire serialization. The missing sweeps are e18e `--fix`, consistent-type-imports `--fix` (which unblocks verbatimModuleSyntax), react/19/remove-context-provider, and manual fixes for the no-deprecated and React Compiler findings.                                                                                                | middle     | high       |
| 10. typescript/no-deprecated (type-aware, built into Oxlint) is the pyupgrade-style check for deprecated APIs that matters most here. It finds 16 uses in 7 files: test calls to the deprecated `OutputChannel.show(preserveFocus, column)` overload, and React `FormEvent` uses in the documentationEditor test forms. The rule follows `@deprecated` tags from @types/vscode, @types/react and @types/node. It will therefore catch new Node 24, VS Code and React 19 deprecations as those type packages are upgraded, which no codemod does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | new        | high       |
| 11. Some capabilities have no home under Oxlint today. The thesis named ban-dependencies on package.json in point 3; the full list is: (a) e18e's type-aware rules; (b) linting package.json with ban-dependencies; (c) any lint for hand-written deferred promises that should be `Promise.withResolvers`, or for `fs.glob`, `util.styleText`, `Object.groupBy` or `Array.fromAsync`. The repo has 0 uses of any of these APIs. Both (a) and (b) need ESLint, which the owner has ruled out. For (b), the CLI-based `@e18e/cli analyze` and npm's lockfile `deprecated` field are the substitutes.                                                                                                                                                                                                                                                                                                                                                                                                                                | new        | medium     |

## Detail

### 1. Oxlint 1.87.0's built-in rules handle much of the pyupgrade-style modernization. That includes unicorn/prefer-node-protocol, prefer-import-meta-properties, prefer-string-replace-all, prefer-at, prefer-set-has, prefer-structured-clone, prefer-global-this, eslint/prefer-object-has-own and others. Their fix kinds (safe, dangerous, suggestion) are as the thesis listed. The list was incomplete in three ways. First, the typed rules (typescript/prefer-optional-chain, prefer-nullish-coalescing, prefer-includes, prefer-string-starts-ends-with, no-deprecated) only run with `--type-aware` (or `options.typeAware: true`) and the oxlint-tsgolint binary. Without that flag they never run, so they report nothing. Second, the React Compiler-style rules (react/globals, immutability, refs, purity, set-state-in-effect, preserve-manual-memoization, use-memo and others) need the react plugin turned on. Third, typescript/no-deprecated is the closest native match for pyupgrade's deprecated-API checks

Verdict: middle. Confidence: high.

I ran the same rules with and without `--type-aware`. Without it, the typed rules found nothing. With it and tsgolint, they found real issues (see point 2). The Oxlint docs say type-aware linting is opt-in and backed by tsgolint. The thesis's per-rule fix markers were not contested. Its headline rule count (871 rules, 328 fixable) says nothing about how well modernization is covered.

Citations:

- [r1a](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Type-aware linting currently supports 59 out of 61 type-aware rules from typescript-eslint."
- [r1b](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "CLI flag: --type-aware"

Thesis (high): Oxlint natively covers much of the pyupgrade-style syntax modernization. Rules and fixes, from `oxlint --rules` on v1.87.0: unicorn/prefer-node-protocol (🛠️ fix), prefer-import-meta-properties (🛠️), prefer-string-replace-all (🛠️), prefer-array-flat (⚠️ dangerous fix), prefer-at (⚠️ dangerous fix or 💡 suggestion), prefer-set-has (⚠️ dangerous fix), prefer-optional-catch-binding (🛠️), prefer-spread (🛠️), prefer-structured-clone (💡 suggestion only), prefer-global-this (💡), prefer-date-now (🛠️), eslint/prefer-object-has-own (🛠️), eslint/prefer-exponentiation-operator (🛠️), typescript/prefer-optional-chain and prefer-nullish-coalescing (typed). These are mostly in the pedantic, style and restriction categories, so none is on by default and each must be enabled explicitly. The Oxlint docs list 871 rules, 328 with fixes.

Thesis citations:

- [c1](https://oxc.rs/docs/guide/usage/linter/rules.html): "Total number of rules: 871 Rules turned on by default: 111 Rules with fixes available: 328"

Antithesis: The point lists only built-in rules. It leaves out two runnable homes that cover most of the same ground: @e18e/eslint-plugin and eslint-plugin-n, both loaded through Oxlint `jsPlugins`. I ran both under Oxlint 1.87.0.

Antithesis: It calls `typescript/prefer-optional-chain` and `prefer-nullish-coalescing` 'typed' but never says they need `--type-aware` and the tsgolint binary. Without that flag Oxlint silently skips them, which is what produced the false zero counts in point 2.

Antithesis: It omits `typescript/no-deprecated`, the one built-in rule that behaves like pyupgrade's deprecated-API checks (it reads `@deprecated` JSDoc). It also omits the `react/*` compiler-readiness rules, which exist in 1.87.0.

Antithesis: It says the pedantic, style and restriction rules are off by default, which is true, but gives no way to enable them for one-shot sweeps. The `react` plugin also needs `--react-plugin`, or its rules report zero without warning.

Antithesis: The cited 'Total number of rules: 871 ... 328' line is a count of all rules. It says nothing about modernization coverage. Dumping `oxlint --rules` shows the modernization rules are thin. `unicorn/prefer-array-find`, `no-array-for-each` and `prefer-top-level-await` are marked 🚧, meaning no autofix. `prefer-spread` (eslint) and `prefer-global-this` have no autofix, and `prefer-includes` (unicorn) is a suggestion only.

Counter-evidence:

- [a1](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Type-aware linting currently supports 59 out of 61 type-aware rules from typescript-eslint."
- [a2](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "CLI flag: --type-aware"

### 2. The untyped counts hold. I re-ran several of them: unicorn/prefer-node-protocol 317 findings, unicorn/prefer-structured-clone 3 (all in packages/webview-contract/src/guards.test.ts), and the others the antithesis also confirmed. The claimed 'zero hits' for the typed rules is an error caused by the missing flag. With `--type-aware` I measured (findings/files) typescript/prefer-nullish-coalescing 40/23, prefer-optional-chain 14/12, prefer-includes 8/6, and no-deprecated 16/7. So node: protocol is the largest single autofix sweep, but not the only meaningful one. The antithesis also reported prefer-string-starts-ends-with 4/4 and prefer-regexp-exec 9/7, which I did not re-run. Root-level config files (rsbuild.config.ts, vitest.config.ts, typings.d.ts, webview_panels/*.config.*) were outside both sweeps

Verdict: antithesis. Confidence: high.

I ran Oxlint 1.87.0 with `OXLINT_TSGOLINT_PATH` set and `--type-aware`, using `-A all -D` for each rule over src, scripts, webview_panels/src and packages. Typed-rule results: nullish-coalescing 40/23, optional-chain 14/12, includes 8/6, no-deprecated 16/7. They match the antithesis exactly.

Citations:

- [r2a](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "CLI flag: --type-aware"
- [r2b](../../packages/webview-contract/src/guards.test.ts): "expect(guard(JSON.parse(JSON.stringify(fixture.message)))).toBe(true);"

Thesis (high): Measured on this repo with Oxlint 1.87.0 (`oxlint -A all -D <rule> -f json src scripts webview_panels/src packages`), read-only, as findings/files: unicorn/prefer-node-protocol 317/155 (autofix); unicorn/prefer-at 31/13; prefer-string-replace-all 40/26; prefer-global-this 14/8; prefer-spread 16/9; prefer-import-meta-properties 8/8; prefer-set-has 4/4; prefer-structured-clone 3/1; eslint/prefer-object-has-own 3/3; prefer-code-point 4/3; prefer-string-slice 3/2; prefer-optional-catch-binding 1/1; prefer-top-level-await 1/1; prefer-type-error 1/1; eslint/prefer-template 33/27. Zero hits for prefer-array-flat, prefer-date-now, prefer-includes, prefer-array-find, prefer-array-some, no-var, prefer-const, prefer-object-spread, prefer-optional-chain and prefer-nullish-coalescing. The `node:` protocol is the only large and mechanically safe sweep. Noisy or opinionated rules: unicorn/no-useless-undefined 269/105, and typescript/consistent-type-imports 601/275 (a verbatimModuleSyntax-style import cleanup, not a runtime upgrade).

Thesis citations:

- [c2](toolchain-october-2026.md): "I ran `oxlint --rules` (v1.87.0) and found native typescript/* versions of every host rule"

Antithesis: The 'zero hits' list is wrong for the type-checked rules. The thesis ran `oxlint -A all -D <rule>` without `--type-aware`, so tsgolint rules were never executed. I re-ran with `--type-aware` and `OXLINT_TSGOLINT_PATH` set (findings/files): typescript/prefer-includes 8/6; prefer-optional-chain 14/12; prefer-nullish-coalescing 40/23; prefer-string-starts-ends-with 4/4; prefer-regexp-exec 9/7. Without the flag, prefer-optional-chain reports 0.

Antithesis: It never ran `typescript/no-deprecated`, a real deprecation finding: 16/7 with `--type-aware`. These are `OutputChannel.show(preserveFocus, column)` overloads in src/test/suite and src/test/mock/vscode.ts, `TextDocument`-style `.value` in two integration tests, and two uses of React's deprecated `FormEvent` in webview_panels/src/modules/documentationEditor/components/tests/{forms/TestForm,DisplayTestDetails}.tsx.

Antithesis: The React plugin rules were not measured. `react/*` rules need `--react-plugin`; with it, webview_panels/src gives (findings/files): react/globals 4/3, immutability 2/2, incompatible-library 1/1, preserve-manual-memoization 1/1, refs 3/1, set-state-in-effect 2/2, exhaustive-deps 7/7, jsx-no-constructed-context-values 7/6. Without the flag every one of them reports 0.

Antithesis: The sweep covers only src, scripts, webview_panels/src and packages. Root-level files (rsbuild.config.ts, vitest.config.ts, eslint.config.cjs, typings.d.ts, webview_panels/*.config.*) are not covered.

Antithesis: The thesis says the `node:` protocol is the 'only large and mechanically safe sweep'. Since I found 28 files auto-fixed by e18e (see point 3), that is an overstatement.

Antithesis: I did confirm the counts that were measured correctly: prefer-node-protocol 317/155, prefer-string-replace-all 40/26, prefer-at 31/13, prefer-global-this 14/8, prefer-import-meta-properties 8/8, prefer-object-has-own 3/3, prefer-structured-clone 3/1.

Antithesis: The cited research doc line says Oxlint has native typescript/* versions of the host rules. It does not support the claim that zero-count typed rules are already clean, and the thesis used it that way.

Counter-evidence:

- [a3](../../src/fusion/process.ts): "const execFileAsync = promisify(execFile);"

### 3. @e18e/eslint-plugin 0.8.1 runs under Oxlint 1.87.0 through `jsPlugins`. It is the strongest pyupgrade-like layer beyond the built-in rules. With its untyped modernization, module-replacement and performance rules enabled, I measured on the four roots: prefer-static-regex 146, prefer-array-at 27, prefer-spread-syntax 16, prefer-array-from-map 13, prefer-array-to-sorted 13, prefer-object-has-own 3, prefer-regex-test 3, prefer-timer-args 3. prefer-array-to-sorted (ES2023 `toSorted`) and prefer-array-from-map have no built-in Oxlint counterpart. e18e's type-aware rules do not run under Oxlint. Linting package.json with ban-dependencies needs ESLint's JSON language support (@eslint/json or jsonc-eslint-parser), so that use has no Oxlint home. The antithesis says the separate `@e18e/cli analyze` command covers it without ESLint; I did not verify that

Verdict: antithesis. Confidence: high.

I ran Oxlint with an e18e-only config (`jsPlugins: ["@e18e/eslint-plugin"]`) against the repo and got the counts above. They match the antithesis. I did not repeat the antithesis's `--fix` run on a copy of src/ (28 files changed). So 'JS-plugin autofix works' rests on its report plus the plugin's documented compatibility with ESLint's plugin API. The README confirms both the Oxlint setup and the type-aware limit.

Citations:

- [r3a](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "If you're using oxlint, you can enable the e18e plugin by adding it to your `.oxlintrc.json` file:"
- [r3b](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "Our type-aware rules depend on TypeScript ESLint's parser, which means they > will not work with oxlint at this time."
- [r3c](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "You can achieve this by using `@eslint/json` or `jsonc-eslint-parser`."
- [r3d](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "JS plugins are currently in alpha, and remain under active development."

Thesis (medium): @e18e/eslint-plugin is the closest thing to a pyupgrade for modernization. It has Modernization, Module-replacements and Performance categories (for example prefer-array-at, prefer-includes, ban-dependencies). Its README documents running under Oxlint via `jsPlugins` in .oxlintrc.json. Type-aware e18e rules need typescript-eslint's parser and do not work in Oxlint. Autofix support varies per rule, and the README marks some with 🔶, which I did not decode. ban-dependencies is meant for package.json, which Oxlint does not lint. Under an Oxlint-only toolchain it therefore has no home, and it needs a one-shot `eslint` run or a manual review of module-replacements. I did not run it here.

Thesis citations:

- [c3](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "{ "jsPlugins": ["@e18e/eslint-plugin"], "rules": { "e18e/prefer-includes": "error" } }"
- [c4](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "Our type-aware rules depend on TypeScript ESLint's parser, which means they > will not work with oxlint at this time."
- [c5](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "Some rules (e.g. `ban-dependencies`) can be used against your `package.json`."

Antithesis: The thesis did not run the plugin. I did: @e18e/eslint-plugin 0.8.1 loads under Oxlint 1.87.0 via `jsPlugins`. The plugin has 30 rules. Enabling the modernization, module-replacement and performance configs gives (findings/files): prefer-static-regex 146/69; prefer-array-at 27/12; prefer-spread-syntax 16/9; prefer-array-from-map 13/8; prefer-array-to-sorted 13/11; prefer-timer-args 3/3; prefer-regex-test 3/2; prefer-object-has-own 3/3.

Antithesis: Running `oxlint --fix` on a copy of src/ with the e18e rules changed 28 files, so JS-plugin autofix works. Only prefer-static-regex (111) and prefer-array-from-map (3) remained. prefer-array-to-sorted (ES2023 `toSorted`) has no native Oxlint counterpart. This is the closest thing to pyupgrade the thesis could have recommended, and it is a real addition.

Antithesis: The thesis says `ban-dependencies` 'has no home'. The e18e project ships its own CLI. `npx @e18e/cli analyze --json` (v0.7.0) scans the project and package.json with no ESLint involved. On this repo it reported 152 'can use newer web features' suggestions, 48 duplicate dependencies and 4 package-metadata warnings. It reported no module-replacement findings. Its scan also includes the `out/` build output, so the counts need a `--src` restriction.

Antithesis: 'Autofix support varies, I did not decode 🔶' is weak. The plugin's own `meta.fixable` shows 22 of 30 rules are fixable. Of the 30 rules, only `ban-dependencies`, the static-regex rules, `no-delete-property`, `no-spread-in-reduce`, `prefer-url-canparse` and a few others lack fixes.

Antithesis: The thesis treats `ban-dependencies` as the mechanism that would flag `uuid` and `which`. The module-replacements manifests in the `module-replacements` npm package contain no `which` entry. `uuid` is in `preferred.json` only via `node-uuid`. The CLI therefore produces no replacement finding for either.

Counter-evidence:

- [a4](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "- Module replacements - Community recommended alternatives to popular libraries, focused on performance and size"
- [a5](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "JS plugins are currently in alpha, and remain under active development."

### 4. The root package.json has only three runtime dependencies: vscode-languageclient, which and yaml. `uuid` and `fast-glob` appear only in the `overrides` block, which pins transitive versions. Nothing in the source imports them, so 'replace uuid with crypto.randomUUID' is not a task. `which` is imported once, in src/fusion/fusionExecutable.ts. Node 24 has no drop-in equivalent, so keeping it is reasonable. On the npm side, the lockfile has one deprecated package: node_modules/@vscode/test-cli/node_modules/mocha/node_modules/glob 10.5.0. That glob is pulled in by @vscode/test-cli, not by this repo directly

Verdict: antithesis. Confidence: high.

I read package.json: `dependencies` lists only the three packages, and `uuid` and `fast-glob` sit inside `overrides` next to react and other pins. I scanned package-lock.json for `deprecated` fields and found only that nested glob@10.5.0. The claim that the module-replacements manifests have no `which` entry comes from the antithesis; I did not check it.

Citations:

- [r4a](../../package.json): ""fast-glob": "file:./scripts/quality/fast-glob-shim""
- [r4c](../../src/fusion/fusionExecutable.ts): "import which from "which";"

Thesis (medium): Package replacements found in the root package.json: `which` (src/fusion/fusionExecutable.ts:5 `import which from "which"`) and `uuid ^14` are candidates for native replacement (`crypto.randomUUID`). `fast-glob` is already a local shim (`file:./scripts/quality/fast-glob-shim`). No rimraf, mkdirp, node-fetch, chalk or lodash entries were found in any of the three workspace package.json files. `which` has no exact native Node equivalent, so I would keep it unless a small PATH lookup is acceptable. These are manual PRs, not autofixes. e18e `ban-dependencies` or `module-replacements` would report them, but only through ESLint or a JS plugin, because package.json is not linted by Oxlint.

Thesis citations:

- [c6](../../src/fusion/fusionExecutable.ts): "import which from "which";"
- [c7](../../package.json): ""fast-glob": "file:./scripts/quality/fast-glob-shim""

Antithesis: `uuid` is not a dependency. In package.json it is an npm `overrides` pin, a transitive-dependency version pin (`"uuid": "^14.0.0"` inside the `overrides` block, next to `react` and `minimatch@<9.0.7`). No file under src, scripts, webview_panels/src or packages imports it. 'Replace `uuid` with `crypto.randomUUID`' is therefore not a task. `crypto.randomUUID` is already used (3 hits).

Antithesis: `fast-glob` is likewise an override pointing at a local shim. It is not a source import.

Antithesis: The only real runtime dependencies are `vscode-languageclient`, `which` and `yaml`. `which` is imported once, in src/fusion/fusionExecutable.ts. The e18e manifests have no replacement entry for it. The thesis was right to keep it, but it reached that conclusion by asserting it, not by checking.

Antithesis: The lockfile has exactly one deprecated package, the nested `@vscode/test-cli/mocha/glob@10.5.0`. This is the npm-side detection the question asked for, and the thesis left it out.

Antithesis: The thesis cites only the fast-glob override as evidence of a package dependency. Both uuid and fast-glob sit in the `overrides` block next to `react` and `minimatch@<9.0.7`, which are pins.

Counter-evidence:

- [a6](../../package.json): ""fast-glob": "file:./scripts/quality/fast-glob-shim""
- [a7](../../src/fusion/fusionExecutable.ts): "import which from "which";"

### 5. React 19 patterns are almost entirely modern already. `use(Context)` is in use (useAppContext.ts), and no file in webview_panels/src calls `useContext(`. The one legacy pattern left is the 14 `Context.Provider` sites in 6 test files. The official codemod react/19/remove-context-provider converts them. Oxlint has built-in React Compiler-readiness rules, and with the react plugin on, webview_panels/src gives (findings/files): react/globals 4/3, refs 3/1, immutability 2/2, set-state-in-effect 2/2, incompatible-library 1/1, preserve-manual-memoization 1/1, react-hooks/exhaustive-deps 7/7. That is 13 compiler-style findings plus 7 exhaustive-deps. Oxlint has no rule that flags `Context.Provider` or `useContext`, so the codemod is the tool for that

Verdict: antithesis. Confidence: high.

I ran `oxlint --react-plugin` with those rules on webview_panels/src and got exactly the antithesis's numbers. I confirmed `return use(AppContext);` exists and that no file under webview_panels/src matches `useContext(`. The file count for the codemod dry-run (6 files) comes from the antithesis; I did not re-run it, but it matches the 14 sites the thesis found by grep.

Citations:

- [r5a](https://raw.githubusercontent.com/reactjs/react-codemod/master/README.md): "Converts `Context.Provider` JSX opening and closing elements into `Context`."
- [r5b](../../webview_panels/src/modules/app/useAppContext.ts): "return use(AppContext);"
- [r5c](../../webview_panels/src/uiCore/components/codeblock/CodeBlock.test.tsx): "<AppContext.Provider"

Thesis (medium): React 19 patterns are already clean in webview_panels/src. forwardRef, defaultProps, propTypes, ReactDOM.render, findDOMNode and useContext: 0 hits. Only 14 `Context.Provider` usages remain, in test files such as CodeBlock.test.tsx and useQueryPanelListeners.test.tsx. Oxlint natively has react/forward-ref-uses-ref (💡), no-render-return-value, no-string-refs and rules-of-hooks. I found no native rule that flags `Context.Provider`→`<Context>` or `useContext`→`use`. Those two have no Oxlint home, so use the React codemods or a manual edit; I did not run react-codemod. The Oxlint docs banner announces React Compiler support, but I did not verify which compiler diagnostics Oxlint implements. useMemo/useCallback are used 35 times in 18 files, which is a candidate manual review if the React Compiler is adopted.

Thesis citations:

- [c8](../../webview_panels/src/uiCore/components/codeblock/CodeBlock.test.tsx): "<AppContext.Provider"
- [c9](https://oxc.rs/docs/guide/usage/linter/rules.html): "Announcing React Compiler Support"

Antithesis: 'I did not run react-codemod' leaves the central React question unanswered. I ran the React 19 codemods in dry-run through the `codemod` CLI (v1.18.3) with `--dry-run --allow-dirty`, on webview_panels/src: remove-context-provider would modify 6 files (14 sites: 4+2+2+2+2+2). remove-forward-ref, use-context-hook and replace-act-import would modify 0. The thesis's 14 is correct, and this is the autofix that confirms it.

Antithesis: The point 'no native rule for Context.Provider or useContext' is correct. The thesis never mentions that `use(Context)` is already in place, in useAppContext.ts and three more files, while `useContext` has 0 hits.

Antithesis: 'I did not verify which compiler diagnostics Oxlint implements' is the wrong gap to leave. `oxlint --rules` lists them: error-boundaries, globals, immutability, incompatible-library, preserve-manual-memoization, purity, refs, set-state-in-effect, set-state-in-render, static-components, use-memo, void-use-memo and unsupported-syntax. Run with `--react-plugin`, 13 compiler-style findings appear in webview_panels/src: globals 4, immutability 2, incompatible-library 1, preserve-manual-memoization 1, refs 3, set-state-in-effect 2. These are the actual React Compiler readiness diagnostics.

Antithesis: The 35 useMemo/useCallback sites (18 files) are mentioned only as candidates for manual review. `react/use-memo`, `void-use-memo` and `preserve-manual-memoization` are the native rules that would classify them, and they report 0, 0 and 1.

Antithesis: The thesis reads the 'Announcing React Compiler Support' banner as evidence about rule coverage. A site banner says nothing about which rules exist.

Counter-evidence:

- [a8](https://raw.githubusercontent.com/reactjs/react-codemod/master/README.md): "Converts `Context.Provider` JSX opening and closing elements into `Context`."
- [a9](https://raw.githubusercontent.com/reactjs/react-codemod/master/README.md): "Replaces usages of `React.useContext(...)` with `React.use(...)`."
- [a10](../../webview_panels/src/modules/app/useAppContext.ts): "return use(AppContext);"

### 6. The Node.js userland-migrations codemods have nothing to change in this repo. The antithesis ran `@nodejs/v22-to-v24` in dry-run over every root and reported 'Would modify 0 files'. Its recipe list (chalk-to-util-styletext, axios-to-whatwg-fetch, import-assertions-to-attributes, rmdir and others) has no recipe for node: protocol, fs.promises, promisify, fs.glob or uuid. The one site that looks like a candidate, `fs.rmdirSync(testDir)`, is non-recursive, so the rmdir recipe does not apply. Run the codemods once as a check, not as a recurring gate, and make no PR from them

Verdict: antithesis. Confidence: medium.

I did not re-run the codemod CLI or re-fetch the recipes directory, so the zero-file result rests on the antithesis's run. I confirmed the rmdirSync call in the source. The thesis's 'low' confidence and lack of measurements left the point open, and the antithesis's measurement is the better evidence.

Citations:

- [r6a](../../src/test/suite/commandProcessExecution.test.ts): "fs.rmdirSync(testDir);"

Thesis (low): The Node.js official codemods live in nodejs/userland-migrations. They are run with the `codemod` CLI, and the README says to commit first because the scripts change source. The README does not enumerate recipes and points to the Codemod Registry. I did not run any recipe in dry-run, so I can give no per-recipe counts. Recommended approach: run `npx codemod @nodejs/<recipe>` only for recipes that exist and match a measured finding, such as node: protocol or deprecated-API fixes. Oxlint's prefer-node-protocol already handles the 317 `node:` imports, so a codemod adds little there.

Thesis citations:

- [c10](https://raw.githubusercontent.com/nodejs/userland-migrations/main/README.md): "npx codemod @nodejs/<recipe>"
- [c11](https://raw.githubusercontent.com/nodejs/userland-migrations/main/README.md): "You can find official Node.js codemods in the [Codemod Registry](https://codemod.link/nodejs-official)."

Antithesis: Unmeasured, though it was easy to measure. I ran `npx codemod@latest run @nodejs/v22-to-v24 --dry-run --allow-dirty --no-interactive` against each root. Every run reported 'Would modify 0 files': src (4784 files scanned), scripts (507), webview_panels/src (2132), packages (91). The codemods find nothing here.

Antithesis: The 'README does not enumerate recipes' complaint is answerable. The recipes directory lists 40, including chalk-to-util-styletext, kleur-to-util-styletext, axios-to-whatwg-fetch, mocha-to-node-test-runner, correct-ts-specifiers, import-assertions-to-attributes and rmdir. None targets the thesis's headline examples: `node:` protocol, `fs.promises`, `promisify`, `fs.glob`, rimraf/mkdirp/node-fetch/uuid. The thesis lists those as replaceable without saying that no recipe exists for any of them.

Antithesis: The thesis says 'use `npx codemod @nodejs/<recipe>` for recipes that match a measured finding'. Zero findings match. The only candidate-looking site is `fs.rmdirSync(testDir)` in src/test/suite/commandProcessExecution.test.ts:36. It is non-recursive, so the `rmdir` recipe does not apply to it.

Antithesis: The README quote 'npx codemod @nodejs/<recipe>' is a template, not a recipe list. The thesis gives it 'low' confidence correctly, but then still proposes using the codemods.

Counter-evidence:

- [a11](https://github.com/nodejs/userland-migrations/tree/main/recipes): "chalk-to-util-styletext chalk-to-util-styletext"
- [a12](../../src/test/suite/commandProcessExecution.test.ts): "fs.rmdirSync(testDir);"

### 7. TypeScript 7.0.2 compiles the root and integration tsconfigs, webview_panels/tsconfig.json and tsconfig.test.json, and the contract tsconfig with no diagnostics. So no removed or deprecated tsconfig option is in use today. The antithesis also reports webview_panels/tsconfig.node.json clean; I did not run that one. The real TS-7-era work is in two opt-in flags. `--erasableSyntaxOnly` gives 205 TS1294 errors in 78 files in the root project; about 200 are constructor parameter properties, not enums. It also gives 10 in webview_panels/tsconfig.test.json and 0 in the contract. `--verbatimModuleSyntax` gives TS1484 errors: 337 in root, 159 in webview_panels/tsconfig.test.json, 19 in the contract. Oxlint's typescript/consistent-type-imports autofix handles that one. Parameter properties have no autofix; Oxlint's typescript/parameter-properties can only stop new ones being added

Verdict: antithesis. Confidence: high.

I installed TS 7.0.2 outside the repo and ran `tsc -p <cfg> --noEmit` with each flag. Counts: root 205/78 files (TS1294) and 337 (TS1484); webview test 10 and 159; contract 19 (TS1484). On the lines named by the 205 root errors, 200 contain a private, public, protected or readonly modifier. My webview TS1484 count (159, on tsconfig.test.json) differs slightly from the antithesis's 150, probably because of which config each of us used.

Citations:

- [r7a](../../src/core/manifest/macroParser.ts): "constructor(private terminal: Pick<Log, "debug">) {}"
- [r7b](../../src/dbt_integration/domain.ts): "export enum RunModelType {"
- [r7c](../../tsconfig.json): ""esModuleInterop": true,"

Thesis (medium): TypeScript config is already modern. Across tsconfig.json, tsconfig.integration.json, webview_panels/tsconfig*.json and packages/webview-contract/tsconfig.json: all use moduleResolution `bundler`, target ES2024 and lib ES2024; none sets baseUrl, outFile or an ES5 target. The one redundant-looking option is `esModuleInterop: true` in the root tsconfig.json. TS 7 was not installed locally, so I did not run `tsc --noEmit` and cannot list its deprecation diagnostics. TS 7's own deprecation errors are the only check for removed options and have no Oxlint equivalent. For `erasableSyntaxOnly`, grep found 13 `enum` lines in non-test files (for example `enum QueryPanelViewType`, `export enum RunModelType`, `enum Pages`). Oxlint's typescript/prefer-enum-initializers hit 19 times in 6 files, but I found no native no-enum rule, so `erasableSyntaxOnly` in tsconfig is the enforcement.

Thesis citations:

- [c12](../../tsconfig.json): ""moduleResolution": "bundler","
- [c13](../../src/dbt_integration/domain.ts): "export enum RunModelType {"

Antithesis: 'TS 7 was not installed locally, so I did not run tsc' is the biggest omission. TS 7.0.2 is `latest` on npm. I installed it outside the repo and ran `tsc -p <cfg> --noEmit` on all six tsconfigs (root, integration, webview, webview node, webview test, contract). All six pass with zero diagnostics. The only errors, TS6379 on the two composite projects, came from my own `--incremental false` flag. There are no removed or deprecated option diagnostics today.

Antithesis: The enum count is the wrong measure for `erasableSyntaxOnly`. Running TS 7 with `--erasableSyntaxOnly` gives 205 TS1294 errors in 78 files in the root project and 10 in 8 files in webview_panels. Contract has 0. About 190 of the root errors are constructor parameter properties (`constructor(private x: T)`), not enums. Only 4 of the root errors are enums. Enums and parameter properties are the erasable-syntax blockers.

Antithesis: `--verbatimModuleSyntax` was not run either. With TS 7: root 337 TS1484 in 98 files, webview_panels 150 in 72 files, contract 19 in 4 files. That is 506 import-type errors in 174 files. Oxlint's `typescript/consistent-type-imports` has an autofix (🛠️), so this is the one TS-7-era pattern that is both large and autofixable. The thesis dismissed it as 'not a runtime upgrade'.

Antithesis: The thesis says there is no native 'no-enum' rule. It misses `typescript/parameter-properties` (no autofix) and `oxc/no-const-enum` (🛠️), the two native rules that map to erasable-syntax. Neither changes the point that the TS flag is the real gate.

Antithesis: 'Only esModuleInterop: true looks redundant' misses that TS 7 behavior is a compiler matter, not a lint matter. TS 7 itself compiled the config without complaint.

Antithesis: The thesis cites `"moduleResolution": "bundler",` from tsconfig.json as proof of TS-7 readiness. tsconfig.integration.json pairs `module: CommonJS` with `bundler`. TS 7.0.2 accepts it today, which is the evidence, but the thesis neither saw nor checked this.

Counter-evidence:

- [a13](../../src/core/manifest/macroParser.ts): "constructor(private terminal: Pick<Log, "debug">) {}"
- [a14](../../tsconfig.json): ""esModuleInterop": true,"

### 8. eslint-plugin-n 18.4.1 and eslint-plugin-compat 7 both run under Oxlint 1.87.0 through `jsPlugins`. eslint-plugin-n gives n/prefer-node-protocol 317 (the same as the built-in unicorn rule, so redundant) and n/prefer-promises/fs 2 (fs.watch in one integration test). Its no-deprecated-api, prefer-global/* and no-unsupported-features/* rules find nothing. eslint-plugin-compat with `BROWSERSLIST='chrome 148'` finds 0 issues across 164 webview files; at `chrome 40` it finds 21, which shows it is really running. So compat can guard the webview's Chromium floor. It catches APIs that are too new, which is the opposite of what pyupgrade does. eslint-plugin-es-x was installed but nobody measured it. No tool flags hand-written `Promise.withResolvers`-style deferreds or `util.styleText` and `fs.glob` opportunities. The 3 `promisify(execFile)` sites are correct, because child_process has no promise-based module

Verdict: antithesis. Confidence: high.

I ran both plugin configs: n gave 317 prefer-node-protocol and 2 prefer-promises/fs; compat gave 0 at chrome 148 and 21 at chrome 40. The claim that Electron 42 ships Chromium 148 comes from the antithesis's electron-to-chromium lookup and I did not verify it. The repo's own research doc called JS plugins alpha, which is a reason for caution, not proof that they don't work.

Citations:

- [r8a](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "Oxlint's plugin API is compatible with ESLint v9+, so most existing ESLint plugins should work out of the box with Oxlint."
- [r8b](toolchain-october-2026.md): "and JS plugins are alpha."
- [r8c](../../src/fusion/process.ts): "const execFileAsync = promisify(execFile);"

Thesis (low): The repo's own plan is a hybrid: move typed and native rules into .oxlintrc.json, keep a thin untyped ESLint, and drop ESLint only after the remaining rules are proven under Oxlint JS plugins. JS plugins are alpha. Placement of the modernization rules: the native unicorn/eslint/typescript rules go in .oxlintrc.json. e18e rules (untyped) go in via `jsPlugins`. eslint-plugin-n (prefer-node-protocol, no-deprecated-api, prefer-global/*, prefer-promises/*), eslint-plugin-es-x and eslint-plugin-compat are not verified on Oxlint's conformance list, so I treat them as having no confirmed Oxlint home. Native replacements: unicorn/prefer-node-protocol, prefer-global-this and typescript/no-deprecated. There is nothing for `util.promisify`→promise APIs, `fs.glob`, `util.styleText`, or `fs.promises`→`node:fs/promises`. Biome comparison was not examined.

Thesis citations:

- [c14](toolchain-october-2026.md): "JS plugins are alpha and support ESLint selectors."

Antithesis: 'eslint-plugin-n ... not verified, so no confirmed home' is wrong. I ran eslint-plugin-n 18.4.1 under Oxlint 1.87.0 with `jsPlugins` over all four roots. n/prefer-node-protocol: 317/155, identical to the native rule. n/prefer-promises/fs: 2/1 (both in src/test/integration/targetMutationCapture.test.ts, `fs.watch`; low value). n/no-deprecated-api, n/prefer-global/*, n/no-unsupported-features/*: 0. The plugin has a home.

Antithesis: `eslint-plugin-compat` also runs under Oxlint JS plugins. `BROWSERSLIST='chrome 148'` over webview_panels/src (164 files) gives 0 findings. Chrome 148 is Electron 42's Chromium per `electron-to-chromium` (42.0→148). A sanity run with `chrome 40` reports 21, so the plugin is actually working. This gives the owner a floor-regression guard in Oxlint.

Antithesis: It misses that no Browserslist or Baseline equivalent is needed. `eslint-plugin-compat` with an Electron/Chromium query is that equivalent.

Antithesis: 'Nothing for util.promisify, fs.glob, util.styleText, fs.promises→node:fs/promises' is mostly right as to tools, but it hides the measurement. There are 3 `promisify(execFile)` sites, and `child_process` has no promise-module equivalent, so they are correct and not outdated. There are 0 hits for styleText, fs.glob, `Object.groupBy`, `Promise.withResolvers` and `Array.fromAsync`. `Promise.withResolvers` deferred patterns appear in 5 test sites (runModel.test.ts:95, fusionClientPool.test.ts:265/366/392, graph.test.ts:144), which no tool detects.

Antithesis: The 'hybrid' plan summary does not say that the JS-plugin layer is alpha but that it ran cleanly for e18e, n and compat in this repo.

Antithesis: The thesis cites 'JS plugins are alpha and support ESLint selectors' from the repo's research doc. That supports 'proceed cautiously', not 'unverified, so no home'. The conformance question can be answered by running the plugins, which I did.

Counter-evidence:

- [a15](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "JS plugins are currently in alpha, and remain under active development."
- [a16](../../src/fusion/process.ts): "const execFileAsync = promisify(execFile);"

### 9. The thesis's wiring is sound: add the rules to .oxlintrc.json, seed oxlint-suppressions.json with `--suppress-all`, and let the existing ratchet (`just lint-ratchet`, scripts/quality/ceilings.json) shrink the count. The details need changing. prefer-includes, prefer-optional-chain and prefer-nullish-coalescing are not zero-finding rules, so they must start suppressed, not as plain errors. `options.typeAware: true` and oxlint-tsgolint must be part of `just lint`. 'Replace uuid' is not a task. The TS step needs no sequencing, because TS 7 already passes. prefer-structured-clone should not be swept, because the guards.test.ts JSON round trips test what survives wire serialization. The missing sweeps are e18e `--fix`, consistent-type-imports `--fix` (which unblocks verbatimModuleSyntax), react/19/remove-context-provider, and manual fixes for the no-deprecated and React Compiler findings

Verdict: middle. Confidence: high.

The measurements in rulings 2 to 7 contradict the step-1 rule list, the uuid task and the TS 7 sequencing. The suppress-all ratchet mechanism is documented in the repo's own research, and that doc reports Oxlint writes the same suppression-file shape.

Citations:

- [r9a](toolchain-october-2026.md): "Seed `oxlint-suppressions.json` with the hidden `--suppress-all` flag"
- [r9b](toolchain-october-2026.md): "I ran `oxlint --suppress-all`, and it wrote `oxlint-suppressions.json` in exactly that shape."

Thesis (medium): Wiring and PR order. Enforcement: add the zero-finding native rules to .oxlintrc.json as errors now (prefer-array-flat, prefer-date-now, prefer-includes, prefer-array-find, prefer-optional-chain, prefer-nullish-coalescing, no-var, prefer-const) so they cannot regress. Run `oxlint` in `just lint`/`just check`. Seed oxlint-suppressions.json for rules with non-zero counts, and use the existing ratchet to decrease the totals. PR order: (1) config with the zero-count rules and the new rules in warn or suppressed state; (2) `oxlint --fix` sweep for prefer-node-protocol (317 fixes, 155 files) plus prefer-optional-catch-binding, prefer-import-meta-properties, prefer-object-has-own, prefer-string-replace-all, prefer-exponentiation-operator; (3) reviewed sweep for the dangerous-fix rules prefer-at, prefer-set-has, prefer-spread, prefer-structured-clone (manual 💡 only); (4) manual: replace `uuid` with `crypto.randomUUID`, decide on `which`, convert the 14 test `.Provider` usages to `<Context>`, evaluate enums versus `erasableSyntaxOnly`; (5) after TS 7 is installed, run `tsc --noEmit` and fix any deprecation diagnostics, optionally enable `erasableSyntaxOnly` and `verbatimModuleSyntax`. Skip no-useless-undefined (269) and prefer-template (33) as style churn, not runtime upgrades.

Thesis citations:

- [c15](toolchain-october-2026.md): "Seed `oxlint-suppressions.json` with the hidden `--suppress-all` flag"

Antithesis: Step (1) would break CI. It tells the owner to add 'zero-finding' rules as errors, naming prefer-includes, prefer-optional-chain and prefer-nullish-coalescing. With `--type-aware` they have 8, 14 and 40 findings. They must start at warn or be suppressed in `oxlint-suppressions.json`, like the other rules.

Antithesis: It also makes the type-aware rules a CI cost the thesis never mentions. The typed run needs `oxlint-tsgolint` and `options.typeAware: true` in config. The thesis wires `oxlint` into `just lint` without it.

Antithesis: Step (4) 'replace `uuid` with `crypto.randomUUID`' is a non-task, since uuid is only an override. 'Evaluate enums versus erasableSyntaxOnly' undercounts the work by about 50 times: 205 root errors in 78 files, mostly parameter properties.

Antithesis: Step (5) 'after TS 7 is installed, run tsc' is unnecessary sequencing. TS 7.0.2 runs clean on every tsconfig today.

Antithesis: The ordered PR list leaves out the cheapest autofix sweeps: e18e `--fix` (28 files changed on src), `typescript/consistent-type-imports --fix` (a prerequisite for `verbatimModuleSyntax`) and `react/19/remove-context-provider` (6 files). It also gives no PR for fixing the 16 `no-deprecated` findings or the 13 React-Compiler-style findings.

Antithesis: 'Skip prefer-template (33) as style churn' is fine, but the thesis then recommends `prefer-structured-clone`, which would change behaviour for two of the three hits. In guards.test.ts:546 and :704, `JSON.parse(JSON.stringify(x))` is an intentional wire-serialization round trip, not a clone.

Antithesis: The cited research-doc line ('Seed `oxlint-suppressions.json` with the hidden `--suppress-all` flag') supports the ratchet mechanism. It says nothing about which modernization rules are safe to enable at error level.

Counter-evidence:

- [a17](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "CLI flag: --type-aware"

### 10. typescript/no-deprecated (type-aware, built into Oxlint) is the pyupgrade-style check for deprecated APIs that matters most here. It finds 16 uses in 7 files: test calls to the deprecated `OutputChannel.show(preserveFocus, column)` overload, and React `FormEvent` uses in the documentationEditor test forms. The rule follows `@deprecated` tags from @types/vscode, @types/react and @types/node. It will therefore catch new Node 24, VS Code and React 19 deprecations as those type packages are upgraded, which no codemod does

Verdict: new. Confidence: high.

I measured 16/7 with `--type-aware`. Which files contain the hits comes from the antithesis's breakdown; I checked only the total and the file count.

Citations:

- [r10a](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Type-aware linting currently supports 59 out of 61 type-aware rules from typescript-eslint."

### 11. Some capabilities have no home under Oxlint today. The thesis named ban-dependencies on package.json in point 3; the full list is: (a) e18e's type-aware rules; (b) linting package.json with ban-dependencies; (c) any lint for hand-written deferred promises that should be `Promise.withResolvers`, or for `fs.glob`, `util.styleText`, `Object.groupBy` or `Array.fromAsync`. The repo has 0 uses of any of these APIs. Both (a) and (b) need ESLint, which the owner has ruled out. For (b), the CLI-based `@e18e/cli analyze` and npm's lockfile `deprecated` field are the substitutes

Verdict: new. Confidence: medium.

The e18e README states (a) and (b) directly. For (c), I grepped and found 0 uses of those APIs, and none of the checkers I ran flags the older idioms they replace. The CLI substitute rests on the antithesis's run, which I did not verify.

Citations:

- [r11a](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "Some rules (e.g. `ban-dependencies`) can be used against your `package.json`."

## Alternatives the thesis missed

Use `@e18e/eslint-plugin` through Oxlint `jsPlugins` as the main pyupgrade-like layer, not as a footnote. Measured on this repo, 18 rules from the modernization, module-replacements and performance configs run under Oxlint 1.87.0. They cover `Array.prototype.toSorted`, `Array.from(map)`, `Object.hasOwn`, `at()`, spread and `timer` args. `oxlint --fix` changed 28 files in a copy of src/. Rules marked as type-aware in e18e still do not run under Oxlint.

- [m1](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "- Modernization - New syntax and APIs which improve code readability and performance"
- [m2](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "JS plugins are currently in alpha, and remain under active development."

Run `npx @e18e/cli analyze --json --src 'src/**/*.ts'` (and the other roots) as a read-only report in `just check`. It is the one tool here that reads package.json and the project, and needs no ESLint. It reports 'can use newer web features' per file, duplicate dependencies and metadata errors. It scans `out/` unless restricted, so pass `--src`. On this repo it found no module-replacement targets.

- [m3](https://raw.githubusercontent.com/e18e/eslint-plugin/main/README.md): "## Linting `package.json`"

Use `eslint-plugin-compat` as an Oxlint `jsPlugins` rule with an Electron 42 / Chromium 148 Browserslist query (`BROWSERSLIST='chrome 148'`) as the webview floor. It runs, reports 0 on webview_panels/src, and reports 21 at `chrome 40`. It guards against too-new APIs, which is the opposite direction from pyupgrade, but it enforces the floor.

- [m4](https://oxc.rs/docs/guide/usage/linter/js-plugins.html): "JS plugins are currently in alpha, and remain under active development."

Use TS 7.0.2 diagnostics as the real TS gate and turn them into a ratchet. Run `tsc -p <cfg> --noEmit --erasableSyntaxOnly` (205 errors in 78 files in the root project; about 190 are constructor parameter properties) and `--verbatimModuleSyntax` (506 errors in 174 files across the three workspaces). The latter is autofixable with Oxlint `typescript/consistent-type-imports --fix`. Parameter properties have no autofix. Oxlint's `typescript/parameter-properties` can only forbid new ones.

- [m5](../../src/core/manifest/macroParser.ts): "constructor(private terminal: Pick<Log, "debug">) {}"

Use the React Compiler-style rules built into Oxlint (`react/purity`, `refs`, `immutability`, `set-state-in-effect`, `globals`, `incompatible-library`, `preserve-manual-memoization`, `exhaustive-deps`) with `--react-plugin` or the `react` plugin in config. They give 13 compiler-readiness findings in webview_panels/src and need no ESLint. The React 19 codemod `react/19/remove-context-provider` autofixes the 14 `Context.Provider` sites in 6 test files.

- [m6](https://raw.githubusercontent.com/reactjs/react-codemod/master/README.md): "Converts `Context.Provider` JSX opening and closing elements into `Context`."

Use `typescript/no-deprecated` (type-aware, native in Oxlint) as the closest equivalent to pyupgrade's deprecated-API checks. It finds 16 uses in 7 files in this repo: the `OutputChannel.show` overloads in tests and two React `FormEvent` uses. Add it as a ratcheted warn-to-error rule.

- [m7](https://oxc.rs/docs/guide/usage/linter/type-aware.html): "Type-aware linting currently supports 59 out of 61 type-aware rules from typescript-eslint."

Run the Node codemods once, not as a recurring check. `@nodejs/v22-to-v24` is a no-op on this repo (0 files modified over about 7,500 files scanned). That is evidence the repo has no old Node-deprecated API usage, so no PR is needed. There is also no tool for the idioms this repo does use, and no recipe for `node:` protocol or fs.promises.

- [m8](https://github.com/nodejs/userland-migrations/tree/main/recipes): "chalk-to-util-styletext chalk-to-util-styletext"

## Open questions

- Does `oxlint --fix` through JS plugins (e18e) give correct, type-checked output across all four roots? The antithesis reported 28 changed files on a copy of src/ but did not run tsc or the tests afterwards.
- Does eslint-plugin-es-x, installed in the scratch environment but never run, add anything under Oxlint beyond the built-in unicorn and e18e rules?
- How do Biome's modernization rules (for example the useNodejsImportProtocol family) compare? Nobody examined them; they are for comparison only.
- Is Electron 42's Chromium really version 148? Check electron-to-chromium or the Electron 42 release notes, because the compat floor query depends on it.
- Does `npx @e18e/cli analyze --src ...` report findings, such as the 152 'newer web features' it gave over the whole tree, that are useful once `out/` is excluded? Is it stable enough to run in `just check`?
- How much does `--type-aware` with tsgolint add to `just lint` run time across the three workspaces, and does that justify a separate typed-lint recipe?
- Is webview_panels/tsconfig.node.json clean under TS 7 and the two opt-in flags? It was not part of my runs.

## Rejected citations

None.
