# Research

## Question

For every major dependency and tool in this repository, what is the latest, best-maintained option compatible with the extension hosts, and what must change so the repository has zero known vulnerabilities, zero abandoned or deprecated packages, and no deprecated APIs in use?

## Recommendation

Keep the current base toolchain: Node 24 through mise, npm 11 with `npm ci --strict-allow-scripts`, rsbuild for the host, Vite 8 and Vitest for the webviews, and vsce for packaging. Add the lint study's TypeScript 7 alias and Oxlint/oxfmt on top; both fit the hosts because they are contributor-only. The repo has zero known vulnerabilities today. It misses the zero-deprecated goal only because of glob 10.5.0, which comes in through @vscode/test-cli's mocha 11. Ship focused PRs in this order, each keeping `just check` green. (1) Remove that chain with a scoped mocha override, or by calling test-electron directly, and add a CI gate that fails on audit findings or on a `deprecated` field in package-lock.json. The trade-off is that the override is untested against test-cli. (2) Fix the six deprecated-type uses: two `OutputChannel.show(2, false)` calls and four uses of React `FormEvent`. (3) Refresh the lockfile to pick up the in-range patch and minor bumps. (4) Land the TypeScript 7 and Oxlint/oxfmt migration, removing ESLint and Prettier packages only as Oxlint covers their rules; the webview React plugins depend on alpha JS-plugin support. (5) Take a newer @vscode/vsce when it ships, to clear DEP0169 from typed-rest-client and azure-devops-node-api. (6) Retest each override for removal, starting with the fast-glob shim against current type-coverage. Leave `@types/vscode` at 1.125.0 until Cursor's API base reaches at least 1.134 and `engines.vscode` rises; the next published types version is 1.134.0. Move to Node 26 only when both VS Code and Cursor ship an Electron with Node 26. Do not adopt Bun or pnpm without new evidence. Each would need `vsce package --no-dependencies` and would give up the npm allowlist, the overrides and lockfile-lint's guarantees.

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Verdict    | Confidence  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| 1. There are no known vulnerabilities today, but the tree still has a deprecated package, and nothing stops either problem from coming back. I re-ran `npm audit --json` at the root and got 0 at every severity, from info to critical. However, package-lock.json carries an npm `deprecated` notice on glob 10.5.0, at `node_modules/@vscode/test-cli/node_modules/mocha/node_modules/glob`. It is there because @vscode/test-cli 0.0.15 pins `mocha ^11.7.6`, which installs a second, nested mocha 11 next to the root's mocha ^12. So the zero-deprecated goal is not met. A grep for `audit` across `.github/workflows`, the justfile and lefthook.yml found nothing, so no gate exists. Not every override is an advisory patch. The `fast-glob` entry is a local stand-in for type-coverage-core.                                                                                                                        | middle     | high        |
| 2. Keep contributor Node on the 24 line. mise pins `node = "24"` as a major version, and `engines.node` is `>=24 <25`. That matches both hosts: VS Code runs Node 24.21.0 and Cursor runs 24.18.1. Node 26 is an even-numbered major, so it will reach Active LTS, and vsce only needs Node 22 or newer. Neither fact is the real constraint; the hosts are. Vitest unit tests and smoke scripts run in the contributor's own Node process, so on Node 26 they could pass while relying on APIs or behaviour that Node 24 hosts lack. The rsbuild target only controls the shipped bundle. Node 26 gains nothing for shipped code. The trigger to move is both VS Code and Cursor shipping an Electron with Node 26. I did not retrieve the VS Code team's written guidance on matching dev Node to Electron's Node.                                                                                                              | middle     | medium      |
| 3. Keep npm 11. vsce officially supports only `npm >=6` and `yarn >=1 <2`. It finds dependencies by shelling out to `npm list --production --parseable`, and it has no pnpm or Bun branch. This repo bundles everything except `vscode`, and `.vscodeignore` excludes node_modules, so a pnpm or Bun switch is technically possible. It would need `package:vsix`, which is currently plain `vsce package`, to gain `--no-dependencies`. Switching would cost the npm-specific supply-chain setup: `allowScripts` with `npm ci --strict-allow-scripts`, `overrides`, lockfile-lint on package-lock.json, and the Docker `npm ci`. Nothing in the evidence offsets that cost. Several things remain unverified: Bun and pnpm allowlist equivalents, lockfile-lint support for their lockfiles, Bun running Vitest, rsbuild and Vite, and `bun test` replacing Vitest with happy-dom, React Testing Library and coverage.           | middle     | medium      |
| 4. Keep rsbuild for the host bundle. Bundling is the VS Code team's recommended practice, and the guide's list of popular bundlers is a set of examples, not a requirement. Nothing found here shows rsbuild as deprecated or stale, and the thesis's esbuild-script swap has no evidence behind it. The real drop-what-is-unneeded question is that two bundlers coexist: rsbuild for the host and Vite 8 for webview_panels. Moving the host to Vite library mode, Rolldown or tsdown could cut that to one, but none of these has been tested on the host bundle. Treat it as an experiment, not a recommendation.                                                                                                                                                                                                                                                                                                             | middle     | low         |
| 5. Keep `@types/vscode` at exactly 1.125.0. Version 1.128.0 is not published: `npm view @types/vscode@1.128.0` returns E404. The published versions between 1.120 and 1.140 are 1.120.0, 1.125.0, 1.134.0, 1.136.0, 1.137.0, 1.138.0 and 1.140.0. So 1.125.0 is the highest that does not exceed the `^1.128.0` engine floor, and the repo's docs record it as a deliberate choice. The next candidate is 1.134.0. It becomes usable only once Cursor's VS Code API base reaches at least 1.134 and `engines.vscode` is raised to match.                                                                                                                                                                                                                                                                                                                                                                                          | antithesis | high        |
| 6. The version survey was too thin: about 4 of the roughly 20 named packages. Its two concerns are also misplaced. On `@vscode/test-cli`, the real problem is not slow releases but the mocha 11 pin, which brings in the deprecated glob. Replacing `which` would just add a dependency to remove one. The antithesis reports several packages behind latest but still within their caret ranges: rsbuild, knip, dependency-cruiser, mocha, happy-dom and @tanstack/react-table. A lockfile refresh (`npm update`) covers those. mocha 12 is a root devDependency used directly by the smoke harness, so the repo runs two test runners: mocha and Vitest.                                                                                                                                                                                                                                                                       | antithesis | medium      |
| 7. Every mise tool except Fusion floats on `latest`. Node is pinned to a major version only, and dbt-fusion is pinned exactly to 2.0.6. Reproducibility depends on `lockfile = true` and the generated `mise.lock`, which records per-platform checksums. I did not check whether every platform used in CI and Docker is covered. The lint study does exist at ws-d/docs/research/toolchain-october-2026.md, and I read it. It recommends TS 7 through Microsoft's alias, plus Oxlint with tsgolint. That fits the Node 24 hosts because it is contributor-only tooling. Remove the ESLint and Prettier packages only after the Oxlint migration lands. Remove the webview's React and a11y ESLint plugins only once Oxlint covers those rules, since its JS plugins are alpha. Whether dprint overlaps with oxfmt was not checked. No maintenance data was gathered for just, lefthook, dprint, rumdl, shfmt, ShellCheck or jj. | middle     | medium      |
| 8. The thesis's PR order has to be replaced. Its first step cannot be done, because 1.128.0 is unpublished, and the rest leave the actual findings undone. The corrected order is in points 9–11 and the recommendation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | antithesis | speculative |
| 9. Deprecated-API worklist. The host `src/` has no deprecated VS Code API uses. Test code calls the deprecated two-argument `OutputChannel.show(column, preserveFocus)` twice, at lines 111 and 211 of outputChannels.test.ts; switch to `show(false)`. The webview uses the deprecated React type `FormEvent` in TestForm.tsx and DisplayTestDetails.tsx; replace it with `SubmitEvent`, `ChangeEvent` or `SyntheticEvent` as each handler requires. Nothing that React 19 removed is in use, and the entry point uses `createRoot`. Add a type-aware no-deprecated lint rule to keep it that way; I did not confirm Oxlint ships one. Deprecated `vscode-languageclient` options were not scanned.                                                                                                                                                                                                                              | new        | medium      |
| 10. `url.parse()` (DEP0169) is called in typed-rest-client and azure-devops-node-api. In this tree both arrive only through @vscode/vsce's publish stack, not through the shipped runtime dependencies. So a DEP0169 warning in a smoke log most likely comes from tooling, and the fix is a newer vsce rather than a change to `src/`. This attribution is by static search; I did not read a smoke log.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | new        | medium      |
| 11. Remove the deprecated glob in one of two ways. Either add a scoped override that forces test-cli onto the root mocha 12, for example `"@vscode/test-cli": {"mocha": "$mocha"}`, or drop @vscode/test-cli and drive @vscode/test-electron from `scripts/test/run-integration.mjs`, which already launches one label without test-cli. Then add a CI and `just check` gate that fails on `npm audit --audit-level=low` or on any `"deprecated"` field in package-lock.json. Neither fix has been tested against test-cli 0.0.15.                                                                                                                                                                                                                                                                                                                                                                                                | new        | low         |

## Detail

### 1. There are no known vulnerabilities today, but the tree still has a deprecated package, and nothing stops either problem from coming back. I re-ran `npm audit --json` at the root and got 0 at every severity, from info to critical. However, package-lock.json carries an npm `deprecated` notice on glob 10.5.0, at `node_modules/@vscode/test-cli/node_modules/mocha/node_modules/glob`. It is there because @vscode/test-cli 0.0.15 pins `mocha ^11.7.6`, which installs a second, nested mocha 11 next to the root's mocha ^12. So the zero-deprecated goal is not met. A grep for `audit` across `.github/workflows`, the justfile and lefthook.yml found nothing, so no gate exists. Not every override is an advisory patch. The `fast-glob` entry is a local stand-in for type-coverage-core

Verdict: middle. Confidence: high.

I checked the clean audit, the `deprecated` lockfile entry, the nested mocha, test-cli's `mocha ^11.7.6` range and the shim's own description myself. The thesis was right about vulnerabilities and wrong to leave the deprecation check unrun. The antithesis is right that `npm audit` does not report deprecations.

Citations:

- [r1a](../../package-lock.json): ""node_modules/@vscode/test-cli/node_modules/mocha/node_modules/glob": {"
- [r1b](../../package-lock.json): ""deprecated": "Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update."
- [r1c](../../package-lock.json): ""node_modules/@vscode/test-cli/node_modules/mocha": {"
- r1d (`scripts/quality/fast-glob-shim/package.json`, removed in P6): ""description": "Stand-in for fast-glob used by type-coverage-core; see index.cjs","

Thesis (medium): The current dependency tree has no known vulnerabilities. Running `npm audit --json` at the root, which covers all three workspaces, returned zero vulnerabilities at every severity. It covered 751 dependencies: 54 prod, 698 dev and 109 optional (the optional ones overlap the other counts). The remaining zero-known-vulnerability work is to keep the audit gate in CI and to prune the overrides that exist only to patch advisories. The `overrides` block patches uuid, serialize-javascript, diff, brace-expansion, minimatch, shell-quote and maplibre-gl, and it uses a local `fast-glob` shim. Each override should be re-tested for removal when its parent releases a fix. The shim in particular is local tooling to maintain. I did not run `npm ls --all` for deprecated transitive packages, so the zero-deprecated claim is unverified.

Thesis citations:

- [c1](../../package.json): ""fast-glob": "file:./scripts/quality/fast-glob-shim""

Antithesis: The thesis says 'the zero-deprecated claim is unverified' and stops there. The check is cheap and it fails. package-lock.json carries an npm `deprecated` notice on glob@10.5.0, nested at node_modules/@vscode/test-cli/node_modules/mocha/node_modules/glob. `npm ls glob` shows the chain: @vscode/test-cli@0.0.15 -> mocha@11.8.0 -> glob@10.5.0. The second requirement (zero deprecated packages) is therefore not met today. The thesis missed the only deprecated package in the tree.

Antithesis: The cause is that @vscode/test-cli pins `mocha ^11.7.6`, and mocha 11 depends on `glob ^10.4.5`. The root already has mocha 12.0.3 (glob ^13), so the tree carries two mocha majors. Fixes are an `overrides` entry such as `"@vscode/test-cli": {"mocha": "$mocha"}`, or dropping test-cli. The repo's own `scripts/test/run-integration.mjs` runs `node_modules/.bin/vscode-test` and has a bespoke label layout, so dropping test-cli is plausible. I did not test whether either fix works against test-cli 0.0.15.

Antithesis: The 'zero known vulnerabilities' result is true as measured: I re-ran `npm audit --json` and got 0 at every severity across 751 dependencies. But it is a point-in-time run. A grep for 'audit' in `.github/workflows` (ci.yml, check-and-package.yml, release.yml), lefthook.yml and the justfile found nothing, so no gate stops a regression. The thesis mentions this only in point 8, not in point 1 where it matters.

Antithesis: `npm audit` covers advisories only. It does not cover abandoned or deprecated packages. The thesis never checked `npm view <pkg> deprecated` or release recency for the direct dependencies, so 'no abandoned packages' is unsupported. My own check found no `deprecated` flag on the latest versions of vscode-languageclient, @rsbuild/core, vite, vitest, happy-dom, @tanstack/react-table, @tanstack/react-virtual, @xyflow/react, dependency-cruiser, knip, concurrently, type-coverage, prismjs, @dagrejs/dagre, vite-plugin-svgr and lockfile-lint. Their latest `time.modified` values fall between 2026-04 and 2026-10, which is recent.

Antithesis: The thesis lists the overrides but gives no evidence on which can be dropped. It also never says why the `fast-glob` shim exists or whether type-coverage 2.30.3 still needs it.

Antithesis: The quote `"fast-glob": "file:./scripts/quality/fast-glob-shim"` only shows that the shim exists. The thesis uses it to support the claim that the overrides are advisory patches. The shim's own package.json describes it as a 'Stand-in for fast-glob used by type-coverage-core', which is a tooling workaround, not an advisory patch.

Antithesis: The thesis counts 'optional 109' as overlapping the other counts, then treats 751 as the whole surface. The clean audit says nothing about the deprecated notice in the nested test-cli chain, because `npm audit` does not report deprecations.

Counter-evidence:

- [a1](../../package-lock.json): ""node_modules/@vscode/test-cli/node_modules/mocha/node_modules/glob": {"
- [a2](../../package-lock.json): ""deprecated": "Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update."
- [a3](../../scripts/test/run-integration.mjs): "const bin = path.join(root, "node_modules/.bin/vscode-test");"

### 2. Keep contributor Node on the 24 line. mise pins `node = "24"` as a major version, and `engines.node` is `>=24 <25`. That matches both hosts: VS Code runs Node 24.21.0 and Cursor runs 24.18.1. Node 26 is an even-numbered major, so it will reach Active LTS, and vsce only needs Node 22 or newer. Neither fact is the real constraint; the hosts are. Vitest unit tests and smoke scripts run in the contributor's own Node process, so on Node 26 they could pass while relying on APIs or behaviour that Node 24 hosts lack. The rsbuild target only controls the shipped bundle. Node 26 gains nothing for shipped code. The trigger to move is both VS Code and Cursor shipping an Electron with Node 26. I did not retrieve the VS Code team's written guidance on matching dev Node to Electron's Node

Verdict: middle. Confidence: medium.

The conclusion holds, but the thesis cited a mise comment that says nothing about Node alignment. I read the mise and engines pins directly. The vsce Node floor and the Node LTS rule come from sources I fetched. The VS Code guidance the question asked for is still unverified.

Citations:

- [r2b](https://raw.githubusercontent.com/microsoft/vscode-vsce/main/README.md): "[Node.js](https://nodejs.org/en/) at least `22.x.x`."
- [r2c](https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/about/previous-releases.mdx): "Historically (up to Node.js 26), odd-numbered releases (9, 11, etc.) become unsupported after six months, and even-numbered releases (10, 12, etc.) move to *Active LTS* status and are ready for general use."

Thesis (medium): The Node policy is already aligned with the hosts. Contributor tooling is pinned to Node 24 in mise, and `engines.node` is `>=24 <25`. Both VS Code (Node 24.21.0) and Cursor (Node 24.18.1) run Node 24. Moving build and unit tests to Node 26 gains nothing for the shipped code, which runs on Node 24. It risks tests passing on APIs that the hosts lack, so keep Node 24 until both hosts ship Node 26. This tooling is contributor-only and never ships in the VSIX. I did not retrieve the VS Code team's own written guidance on matching the dev Node to Electron's Node. The conventional rule is to develop on the Node that matches Electron, but I did not verify that claim.

Thesis citations:

- [c2](../../mise.toml): "# Contributor tooling only. None of this ships in the VSIX, and the extension must"

Antithesis: The thesis says it did not retrieve the VS Code team's guidance on matching dev Node to Electron's Node, and it gives no source for Node 26. The question asked for that explicitly. The only quote cited is a comment in mise.toml, which is the repo's own text and not external evidence.

Antithesis: It does not say what Node 26 would gain or risk. The Node release page says even-numbered majors move to Active LTS after their six-month Current phase. Node 26 first released in May 2026, so by the Node page's rule it is at or near LTS (a page summary I read showed it as 'Current', last updated Oct 07 2026; that summary is not quotable). So 'wait for LTS' is a weak reason to stay on 24, and the real constraint is the hosts: both run Node 24, and neither ships Node 26. The thesis mixes these up.

Antithesis: The thesis claims Node 26 risks 'tests passing on APIs that the hosts lack'. That is true only for tests that run in the Node process, and Vitest does exactly that. The shipped bundle is built by rsbuild, whose target is a build setting that would stay at Node 24. The thesis does not separate these two paths, so it cannot say what actually breaks.

Antithesis: vsce itself lists 'at least `22.x.x`' as its requirement, so packaging does not force Node 24 or 26.

Antithesis: The thesis's cited lint study does exist at /Users/daniel/projects/vscode-dbt-power-user/ws-d/docs/research/toolchain-october-2026.md (I read it with the shell), although the citation tooling could not fetch it. The thesis said it was 'not found'.

Antithesis: The mise.toml comment ('Contributor tooling only. None of this ships in the VSIX, and the extension must') is about not shipping mise. It says nothing about Node alignment. The support for 'aligned with the hosts' is `node = "24"` in mise.toml and `engines.node` in package.json, which the thesis did not quote.

Counter-evidence:

- [b1](https://raw.githubusercontent.com/microsoft/vscode-vsce/main/README.md): "[Node.js](https://nodejs.org/en/) at least `22.x.x`."
- [b4](https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/about/previous-releases.mdx): "Historically (up to Node.js 26), odd-numbered releases (9, 11, etc.) become unsupported after six months, and even-numbered releases (10, 12, etc.) move to *Active LTS* status and are ready for general use."

### 3. Keep npm 11. vsce officially supports only `npm >=6` and `yarn >=1 <2`. It finds dependencies by shelling out to `npm list --production --parseable`, and it has no pnpm or Bun branch. This repo bundles everything except `vscode`, and `.vscodeignore` excludes node_modules, so a pnpm or Bun switch is technically possible. It would need `package:vsix`, which is currently plain `vsce package`, to gain `--no-dependencies`. Switching would cost the npm-specific supply-chain setup: `allowScripts` with `npm ci --strict-allow-scripts`, `overrides`, lockfile-lint on package-lock.json, and the Docker `npm ci`. Nothing in the evidence offsets that cost. Several things remain unverified: Bun and pnpm allowlist equivalents, lockfile-lint support for their lockfiles, Bun running Vitest, rsbuild and Vite, and `bun test` replacing Vitest with happy-dom, React Testing Library and coverage

Verdict: middle. Confidence: medium.

The thesis reached the right conclusion, but it quoted only the README heading and called vsce's behaviour speculative. vsce's source settles that. The 'Yarn required for tests' note in the vsce README concerns vsce's own development, not how it packages other projects.

Citations:

- [r3a](https://raw.githubusercontent.com/microsoft/vscode-vsce/main/src/npm.ts): "exec('npm list --production --parseable --depth=99999 --loglevel=error', { cwd, maxBuffer: 5000 * 1024 })"
- [r3b](../../package.json): ""package:vsix": "vsce package","
- [r3c](../../rsbuild.config.ts): "config.externals = ["vscode"];"
- [r3d](../../docker/integration/Dockerfile): "RUN npm ci --strict-allow-scripts"

Thesis (medium): Staying on npm 11 is the only package-manager choice with documented `vsce` support. The `@vscode/vsce` README lists only npm >=6 and yarn 1 as supported package managers. Bun and pnpm are not listed. `vsce` inspects dependencies through `npm list`, so a pnpm or Bun layout could break `vsce package` unless `--no-dependencies` is passed with a fully bundled build. Even then, the `vsce` test suite requires Yarn. I did not verify how `vsce` handles Bun or pnpm lockfiles, so that part is speculative. A package-manager switch would also touch several repo features: `npm ci --strict-allow-scripts`, the `allowScripts` allowlist, `overrides`, lockfile-lint (which checks `package-lock.json`), the Dockerfile, and the justfile. Nothing here justifies that cost.

Thesis citations:

- [c4](https://raw.githubusercontent.com/microsoft/vscode-vsce/main/README.md): "Supported package managers:"
- [c5](../../package.json): ""check:lockfile": "lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https --validate-integrity","
- [c6](../../docker/integration/Dockerfile): "RUN npm ci --strict-allow-scripts"

Antithesis: The thesis cites the README line 'Supported package managers:' as evidence, but the quote is only the heading. The list that follows is `npm >=6` and `yarn >=1 <2`, so it names no pnpm or Bun support. The thesis's conclusion is correct. The quote does not carry it.

Antithesis: The thesis calls it 'speculative' that vsce breaks on pnpm or Bun. It is not, because vsce's source is public. `src/npm.ts` shells out to `npm list --production --parseable --depth=99999 --loglevel=error`, and its only alternative is a Yarn 1 path (`yarn list --prod --json`). There is no pnpm or Bun branch. Dependency discovery therefore depends on a node_modules tree that npm can list. Bun and pnpm installs have a different layout, so the cure would be `vsce package --no-dependencies`.

Antithesis: This repo's `package:vsix` script is plain `vsce package`, with no `--no-dependencies`. It relies on `.vscodeignore` containing `**/node_modules`, and `rsbuild.config.ts` sets only `externals = ["vscode"]`, so all production dependencies are bundled. A pnpm or Bun migration is therefore feasible but needs that flag added. The thesis does not say so.

Antithesis: It never evaluates Bun or pnpm on any other criterion the question listed: install-script allowlists (npm `allowScripts` vs pnpm `onlyBuiltDependencies` vs Bun `trustedDependencies`), `overrides` (pnpm uses `pnpm.overrides`), workspaces, mise backends, the GitHub Actions setup, lefthook, or the Docker image. 'Nothing here justifies that cost' is an assertion with no comparison behind it.

Antithesis: A narrow Bun use is never discussed: Bun only as a script runner, or `bun test`. The question asked whether Bun could replace Vitest (happy-dom, React Testing Library, coverage). The thesis does not address it.

Antithesis: The thesis says 'Even then, the vsce test suite requires Yarn.' The README note ('Yarn is required to run the tests') concerns vsce's own development, not consumers, and is irrelevant to whether vsce packages a Bun or pnpm project.

Antithesis: The thesis cites `check:lockfile` (lockfile-lint on package-lock.json) as a switching cost. That is a real cost, but the thesis does not say that lockfile-lint's `--type` covers npm and yarn only, so a pnpm or Bun lockfile would lose this check entirely. I did not verify that claim against lockfile-lint's docs.

Counter-evidence:

- [c1](https://raw.githubusercontent.com/microsoft/vscode-vsce/main/src/npm.ts): "exec('npm list --production --parseable --depth=99999 --loglevel=error', { cwd, maxBuffer: 5000 * 1024 })"
- [c2](https://raw.githubusercontent.com/microsoft/vscode-vsce/main/README.md): "> **Note:** [Yarn](https://www.npmjs.com/package/yarn) is required to run the tests."
- [c4](../../package.json): ""package:vsix": "vsce package","

### 4. Keep rsbuild for the host bundle. Bundling is the VS Code team's recommended practice, and the guide's list of popular bundlers is a set of examples, not a requirement. Nothing found here shows rsbuild as deprecated or stale, and the thesis's esbuild-script swap has no evidence behind it. The real drop-what-is-unneeded question is that two bundlers coexist: rsbuild for the host and Vite 8 for webview_panels. Moving the host to Vite library mode, Rolldown or tsdown could cut that to one, but none of these has been tested on the host bundle. Treat it as an experiment, not a recommendation

Verdict: middle. Confidence: low.

I fetched the bundling guide and confirmed the rsbuild build script. The rsbuild and Vite maintenance data comes from the antithesis's `npm view` runs, which I did not repeat. No evidence was gathered on Rolldown or tsdown.

Citations:

- [r4a](https://raw.githubusercontent.com/microsoft/vscode-docs/main/api/working-with-extensions/bundling-extension.md): "Popular ones are [rollup.js](https://rollupjs.org), [Parcel](https://parceljs.org), [esbuild](https://esbuild.github.io/), and [webpack](https://webpack.js.org/)."
- [r4b](../../package.json): ""build:app": "rsbuild build","
- [r4c](../../package.json): ""@rsbuild/core": "^2.2.8","

Thesis (low): Bundling is the VS Code team's recommended approach, and it is the basis for dropping runtime dependencies from the VSIX. The official bundling guide recommends bundling and names rollup, Parcel, esbuild and webpack as popular bundlers. rsbuild is already used here and is not listed by the guide. Replacing it with an esbuild script would follow the documented reference setup. It is not required to reach zero deprecated packages, so I would not switch unless rsbuild stops fitting. I did not verify rsbuild, tsdown or Rolldown maintenance data. Treat the rsbuild-vs-alternatives verdict as unverified.

Thesis citations:

- [c7](https://raw.githubusercontent.com/microsoft/vscode-docs/main/api/working-with-extensions/bundling-extension.md): "Popular ones are [rollup.js](https://rollupjs.org), [Parcel](https://parceljs.org), [esbuild](https://esbuild.github.io/), and [webpack](https://webpack.js.org/)."

Antithesis: The bundling guide quote lists rollup, Parcel, esbuild and webpack. It does not say rsbuild is wrong or should be replaced. The thesis then says 'replacing it with an esbuild script would follow the documented reference setup' but offers no maintenance data. rsbuild is current: @rsbuild/core 2.2.12 was modified on 2026-10-06, while the repo is on ^2.2.8. It has no npm `deprecated` flag.

Antithesis: The question asked for rsbuild vs Vite library mode, tsdown, esbuild and Rolldown. The thesis admits it checked none. A concrete observation it could have made is that the repo already depends on Vite 8 in webview_panels, and Vite 8.3.4 was modified 2026-10-08, so Vite library mode for the host is a possible way to run one bundler instead of two. I did not test that it builds the host bundle.

Antithesis: The thesis ignores that the host build and the webview build use two different bundlers (rsbuild and Vite). That is the real 'drop what is unneeded' question for point 4.

Antithesis: The thesis's own confidence is 'low' and its cited quote does not mention rsbuild. The claim 'rsbuild is not listed by the guide' is all the quote supports, and it is a weak reason to recommend anything.

Counter-evidence:

- [d1](../../rsbuild.config.ts): "config.externals = ["vscode"];"
- [d2](../../package.json): ""@rsbuild/core": "^2.2.8","

### 5. Keep `@types/vscode` at exactly 1.125.0. Version 1.128.0 is not published: `npm view @types/vscode@1.128.0` returns E404. The published versions between 1.120 and 1.140 are 1.120.0, 1.125.0, 1.134.0, 1.136.0, 1.137.0, 1.138.0 and 1.140.0. So 1.125.0 is the highest that does not exceed the `^1.128.0` engine floor, and the repo's docs record it as a deliberate choice. The next candidate is 1.134.0. It becomes usable only once Cursor's VS Code API base reaches at least 1.134 and `engines.vscode` is raised to match

Verdict: antithesis. Confidence: high.

I confirmed the E404 and the list of published versions myself. The thesis's first PR would have broken `npm install`. It also misread the vsce rule: types must not be newer than the engine, so being older is safe.

Citations:

- [r5a](../../package.json): ""@types/vscode": "1.125.0","
- [r5b](../../package.json): ""vscode": "^1.128.0","
- [r5c](practice-review-october-2026.md): "Valid: types must not exceed the engine."
- [r5d](../refactor/rearchitecture-plan.md): "`@types/vscode` stays at 1.125.0 for `engines.vscode` `^1.128.0`'s API floor."

Thesis (medium): `@types/vscode` is pinned at 1.125.0 while `engines.vscode` is ^1.128.0. The pin should be raised to exactly 1.128.0 so the types match the minimum host, because vsce requires `@types/vscode` to be no newer than `engines.vscode`. The npm registry's latest is 1.140.0, which must not be adopted while Cursor's API base is 1.128. The upgrade to 1.140 waits until Cursor's VS Code base reaches the target version and `engines.vscode` is raised to match. Raising to 1.128.0 also gives an accurate `@deprecated` surface for scanning. A repo grep for the old `rootPath` workspace API only matched local variables, not `vscode.workspace.rootPath`. I did not run a full `@deprecated` scan against the types.

Thesis citations:

- [c8](../../package.json): ""@types/vscode": "1.125.0","
- [c9](../../package.json): ""vscode": "^1.128.0","

Antithesis: The central recommendation is impossible. The thesis says to raise `@types/vscode` 'to exactly 1.128.0'. That version is not published: `npm view @types/vscode@1.128.0 version` returns E404. The published versions in the 1.120–1.140 range are 1.120.0, 1.125.0, 1.134.0, 1.136.0, 1.137.0, 1.138.0 and 1.140.0. So 1.125.0 is already the highest published version at or below the 1.128 floor. Following the thesis's PR 1 would break `npm install`.

Antithesis: The thesis calls 1.125.0 vs `^1.128.0` a 'mismatch'. The repo's own research docs record the pin as deliberate and valid: types must not exceed the engine. A lower types version is the safe direction. The cost is that APIs added in 1.126–1.128 are not typed, which the thesis does not quantify.

Antithesis: The thesis promised a deprecation scan and ran none ('I did not run a full `@deprecated` scan'). I ran the TypeScript language service's deprecation diagnostics (`getSuggestionDiagnostics`, `reportsDeprecated`) over all three tsconfigs. The host `tsconfig.json` shows 0 deprecated uses. `src/test/tsconfig.json` shows 2, both `OutputChannel.show(column, preserveFocus)` at `outputChannels.test.ts` lines 111 and 211, because that two-argument signature is `@deprecated`. `webview_panels/tsconfig.json` shows 4: `FormEvent` in `TestForm.tsx` (lines 11 and 53) and `DisplayTestDetails.tsx` (lines 21 and 112). This is the real answer to question 3; the thesis offered a grep for `rootPath` instead.

Antithesis: I also grepped `src/` for the other deprecated members in the 1.125 types (`storagePath`, `globalStoragePath`, `logPath`, `extensionPath`, `rootPath`, the old `Task` constructor, `MarkedString`, `setLanguageConfiguration`, `TextEditor.hide`, `RelativePattern.base`). The Task constructor in `dbtTask.ts` already uses the scoped form, so it is not deprecated. No production use of a deprecated VS Code member turned up.

Antithesis: Question 3 also asked about `vscode-languageclient` deprecated options and Node DEP warnings, and the thesis answered neither (see point 8 below).

Antithesis: The thesis says 'vsce requires `@types/vscode` to be no newer than `engines.vscode`' and cites the package.json pins. Its own quote shows 1.125.0 against ^1.128.0, which is older, not newer, so vsce is satisfied today. The real constraint runs the other way: the version must stay at or below the engine.

Counter-evidence:

- [e1](practice-review-october-2026.md): "Valid: types must not exceed the engine."
- [e2](../../src/test/suite/outputChannels.test.ts): "log.channel.show(2, false);"
- [e3](../../webview_panels/src/modules/documentationEditor/components/tests/forms/TestForm.tsx): "import { FormEvent, useEffect } from "react";"
- [e4](../../src/projects/project/dbtTask.ts): "workspace.getWorkspaceFolder(Uri.file(root)) ?? TaskScope.Workspace,"

### 6. The version survey was too thin: about 4 of the roughly 20 named packages. Its two concerns are also misplaced. On `@vscode/test-cli`, the real problem is not slow releases but the mocha 11 pin, which brings in the deprecated glob. Replacing `which` would just add a dependency to remove one. The antithesis reports several packages behind latest but still within their caret ranges: rsbuild, knip, dependency-cruiser, mocha, happy-dom and @tanstack/react-table. A lockfile refresh (`npm update`) covers those. mocha 12 is a root devDependency used directly by the smoke harness, so the repo runs two test runners: mocha and Vitest

Verdict: antithesis. Confidence: medium.

I verified the mocha split (root ^12, test-cli ^11.7.6) and that the smoke harness imports mocha. The other versions and dates come from the antithesis's `npm view` runs, which I did not repeat, so the full per-package table is still incomplete.

Citations:

- [r6b](../../src/test/smoke/runTests.ts): "import Mocha from "mocha";"
- [r6c](../../package.json): ""@vscode/test-cli": "^0.0.15","

Thesis (medium): Several test and packaging tools sit at or near their latest versions according to `npm view`. These are `which` 7.0.0, `concurrently` 10.0.6 (repo range ^10.0.5, so only a patch bump), `type-coverage` 2.30.3 and `lockfile-lint` 5.0.1. None reported a deprecation notice. `@vscode/test-cli` is at 0.0.15, which is the latest published, but it is a 0.0.x release with a modified date of 2026-06-22, so it is slower-moving than the rest. The owner should watch it and use `@vscode/test-electron` directly if it stalls. `@vscode/test-electron` is already ^3.1.0. The `which` package could be replaced by a small helper or an `execa`-style lookup, but that is not needed for compliance.

Thesis citations:

- [c10](../../package.json): ""@vscode/test-cli": "^0.0.15","
- [c11](../../package.json): ""concurrently": "^10.0.5","

Antithesis: The point says several tools are 'at or near their latest' from `npm view`, but only 4 of the 20 or so named packages are covered. It skips vitest, happy-dom, Vite, React, @tanstack/*, @xyflow/react, vscode-languageclient, yaml, fast-check, dependency-cruiser, knip, @vscode/vsce and @vscode/test-electron, with no versions, dates or health data. The question required current and latest versions for every dependency.

Antithesis: The thesis calls `@vscode/test-cli` 0.0.15 a slow mover to 'watch'. The registry shows 0.0.12 on 2025-10-09, then 0.0.14 and 0.0.15 on 2026-06-22, so it is alive. The real problem is that it pins `mocha ^11.7.6`, which brings in the deprecated glob (see point 1). The thesis worries about the wrong risk.

Antithesis: Several direct dependencies are behind their latest, which the thesis did not report: `@vscode/vsce` ^4.0.0 has a `next` tag 4.0.1-3, `@rsbuild/core` ^2.2.8 vs 2.2.12, `knip` ^6.38.0 vs 6.40.0, `dependency-cruiser` ^18.4.0 vs 18.5.0, `mocha` ^12.0.2 vs 12.0.3, `happy-dom` 20.14.5 installed vs 20.14.6 and `@tanstack/react-table` 9.2.6 installed vs 9.2.8. These are patch or minor within range, so `npm update` covers them.

Antithesis: The thesis suggests replacing `which` with an `execa`-style lookup. That adds a dependency in order to remove one. `which` 7.0.0 was released 2026-09-09 and is not deprecated, so there is no case for the change.

Antithesis: The thesis ignores `mocha` and `@types/mocha`. Both are devDependencies, mocha is used by `src/test/smoke/runTests.ts` and `src/test/integration/untrusted/index.ts`, and unit tests are otherwise on Vitest. This dual-runner setup is a candidate for 'drop what is unneeded'.

Antithesis: The quote `"concurrently": "^10.0.5",` is used to show 'only a patch bump'. That is correct (10.0.6 exists), but a caret range already allows 10.0.6, so the bump is a lockfile refresh and not a package.json edit.

Counter-evidence:

- [f1](../../src/test/smoke/runTests.ts): "import Mocha from "mocha";"

### 7. Every mise tool except Fusion floats on `latest`. Node is pinned to a major version only, and dbt-fusion is pinned exactly to 2.0.6. Reproducibility depends on `lockfile = true` and the generated `mise.lock`, which records per-platform checksums. I did not check whether every platform used in CI and Docker is covered. The lint study does exist at ws-d/docs/research/toolchain-october-2026.md, and I read it. It recommends TS 7 through Microsoft's alias, plus Oxlint with tsgolint. That fits the Node 24 hosts because it is contributor-only tooling. Remove the ESLint and Prettier packages only after the Oxlint migration lands. Remove the webview's React and a11y ESLint plugins only once Oxlint covers those rules, since its JS plugins are alpha. Whether dprint overlaps with oxfmt was not checked. No maintenance data was gathered for just, lefthook, dprint, rumdl, shfmt, ShellCheck or jj

Verdict: middle. Confidence: medium.

I confirmed the mise.toml pins, the generated lockfile with its checksums, and that the lint study exists. The study is outside this repo, so I cannot cite it. The thesis misread both the pin state and whether the study existed.

Citations:

- [r7a](../../mise.toml): ""aqua:getdbt.com/dbt-fusion" = "2.0.6""
- [r7b](../../mise.toml): ""aqua:koalaman/shellcheck" = "latest""
- [r7c](../../mise.lock): "checksum = "sha256:03fd8908f9b418bdc4701347ff0527a59d1c08db2bc09a9f5d8101eb711e7fe2""

Thesis (low): The contributor tool set in `mise.toml` is mostly `latest`: just, just-lsp, lefthook, dprint, rumdl, shfmt, shellcheck and jj. Only `node` and `dbt-fusion` are pinned. A `mise.lock` exists and `lockfile = true` is set, so resolved versions are reproducible. For zero-vulnerability and reproducibility goals, `latest` is acceptable only because of the lockfile, and CI should fail if the lockfile is stale. `dprint` and the ESLint/Prettier scripts overlap with the earlier lint study's Oxlint/oxfmt decision. Once that migration lands, the `eslint`, `typescript-eslint`, `eslint-config-prettier`, `eslint-plugin-sonarjs`, `prettier` and `prettier-plugin-organize-imports` devDependencies should be removed, as should the `eslint-suppressions.json` and `eslint.config.cjs` files. I did not re-check the lint study (docs/research/toolchain-october-2026.md was not found in the ws-d research listing), and I did not verify maintenance status of each mise tool.

Thesis citations:

- [c12](../../mise.toml): "# failing integration test is attributable to the extension rather than a Fusion upgrade."

Antithesis: The thesis says the lint study 'was not found in the ws-d research listing'. It is there: /Users/daniel/projects/vscode-dbt-power-user/ws-d/docs/research/toolchain-october-2026.md exists (I read it with the shell; it covers the TypeScript 7 alias plan and Oxlint/tsgolint findings). The point 7 conclusion about removing eslint/prettier packages is therefore built on a file the thesis did not open. I cannot quote it as a citation because the checker cannot fetch that path.

Antithesis: It claims `dprint` 'overlaps with' the Oxlint/oxfmt decision. The repo uses Prettier (`.prettierrc`, `format` and `check:format` scripts) for ts/js/json/css/html, while `dprint.json` is a separate formatter in mise. Which files dprint owns was not checked, so the overlap claim is speculative.

Antithesis: The lint study applies to only some of the removals. `@eslint-react/eslint-plugin`, `eslint-plugin-jsx-a11y-x`, `eslint-plugin-react-refresh` and `eslint-plugin-sonarjs` are in the webview_panels devDependencies. The study says Oxlint JS plugins are alpha, so those packages cannot simply be deleted. The thesis lists the removals without that condition.

Antithesis: The thesis offers no maintenance data for any mise tool (just, just-lsp, lefthook, dprint, rumdl, shfmt, shellcheck, jj), though the question named all of them. 'latest' plus a lockfile is called acceptable, but nothing is said about whether `mise.lock` carries checksums for every platform used in CI and Docker.

Antithesis: The quote chosen (`# failing integration test is attributable to the extension rather than a Fusion upgrade.`) is about pinning dbt-fusion. It says nothing about the `latest` tools.

Antithesis: The thesis says only `node` and `dbt-fusion` are pinned. `mise.toml` pins `node = "24"` (a major, not an exact version) and `"aqua:getdbt.com/dbt-fusion" = "2.0.6"`. So only Fusion is pinned exactly.

Counter-evidence:

- [g2](../../mise.toml): ""aqua:getdbt.com/dbt-fusion" = "2.0.6""

### 8. The thesis's PR order has to be replaced. Its first step cannot be done, because 1.128.0 is unpublished, and the rest leave the actual findings undone. The corrected order is in points 9–11 and the recommendation

Verdict: antithesis. Confidence: speculative.

Step 1 is impossible. The antithesis did the deprecation scans and DEP0169 attribution that the thesis deferred, and I verified their key evidence (points 9 and 10). An audit-only gate would still pass with the deprecated glob in the tree.

Thesis (speculative): Suggested PR order, each keeping `just check` green. (1) Raise `@types/vscode` to 1.128.0 and fix any compile errors or deprecations it surfaces. (2) Bump patch-level devDependencies, for example `concurrently`, and re-run `npm audit` and `npm ls --all` to confirm no deprecated transitive packages. (3) Try removing each overrides entry one at a time, and replace the `fast-glob` shim if its parent is fixed. (4) Land the Oxlint/oxfmt migration and remove the ESLint and Prettier packages. (5) Add `npm audit --audit-level=low` to CI. (6) Identify the emitter of each `DEP0xxx` warning in smoke logs and fix or upgrade it. (7) Run a React 19 deprecation scan of `webview_panels`. A spot grep found no `findDOMNode`, `forwardRef`, `defaultProps` or `ReactDOM.render` uses, but I only grepped part of the tree. Defer the Node 26, Bun, pnpm and `@types/vscode` above 1.128 changes until the hosts support them.

Antithesis: PR order step 1 (raise `@types/vscode` to 1.128.0) cannot be executed because the version does not exist (see point 5). Step 2 depends on an `npm ls --all` run that was never done. The first real PR should remove the deprecated glob chain by overriding or dropping the old mocha nested under `@vscode/test-cli`.

Antithesis: Step 6 ('identify the emitter of each DEP0xxx warning') defers the work the question asked for. I found that `url.parse()` (DEP0169) is called in `typed-rest-client@1.8.11` (`HttpClient.js` lines 89, 200 and 245) and in `azure-devops-node-api@12.5.0`. Both are only reachable through `@vscode/vsce@4.0.0`. The dependency tree shows `@vscode/vsce` -> `azure-devops-node-api@12.5.0` -> `typed-rest-client@1.8.11`. Vite's dist also contains a `url.parse(` call. None of the shipped runtime dependencies (vscode-languageclient, which, yaml) match. So a DEP0169 in a smoke log would come from vsce/Vite tooling, not the extension, and the fix is a newer vsce, not a change to `src/`. I did not run the smoke logs, so this attribution is by static search.

Antithesis: Step 7 ('React 19 deprecation scan') rests on a grep of part of the tree. I scanned all of `webview_panels/src` with the TypeScript deprecation diagnostics: 4 hits, all `FormEvent` (see point 5). A grep for `findDOMNode`, `forwardRef`, `defaultProps`, `propTypes`, `ReactDOM.render` and `react-dom/test-utils` found no uses. The only other pattern is `<Context.Provider>` in two test files, which is not removed in React 19. Entry uses `ReactDOM.createRoot`.

Antithesis: Step 5 ('add npm audit to CI') is right, because CI has no audit step. But the gate must also check the `deprecated` field in package-lock.json (for example `grep '"deprecated"' package-lock.json`). `npm audit` does not flag deprecated packages, so the thesis's gate would still pass with glob@10.5.0 in the tree.

Antithesis: The thesis ends by deferring Bun, pnpm and Node 26 without naming the event that unblocks each, which the question required. Node 26 needs VS Code and Cursor to ship an Electron with Node 26. The `@types/vscode` bump to 1.134+ needs Cursor's API base to move past 1.128 and `engines.vscode` to be raised.

Antithesis: The point is labelled 'speculative' and has no citations, so it is not evidence for anything. Point 1 relies on it for the claim that PR 2 will 'confirm no deprecated transitive packages'. That is the check that would have found the glob warning.

Counter-evidence:

- [h1](../../node_modules/typed-rest-client/HttpClient.js): "let parsedUrl = url.parse(requestUrl);"
- [h2](../../webview_panels/src/renderPanel.tsx): "ReactDOM.createRoot(document.getElementById("root")!).render("

### 9. Deprecated-API worklist. The host `src/` has no deprecated VS Code API uses. Test code calls the deprecated two-argument `OutputChannel.show(column, preserveFocus)` twice, at lines 111 and 211 of outputChannels.test.ts; switch to `show(false)`. The webview uses the deprecated React type `FormEvent` in TestForm.tsx and DisplayTestDetails.tsx; replace it with `SubmitEvent`, `ChangeEvent` or `SyntheticEvent` as each handler requires. Nothing that React 19 removed is in use, and the entry point uses `createRoot`. Add a type-aware no-deprecated lint rule to keep it that way; I did not confirm Oxlint ships one. Deprecated `vscode-languageclient` options were not scanned

Verdict: new. Confidence: medium.

I verified the call sites and both `@deprecated` annotations in the installed types. The 0/2/4 counts come from the antithesis's TypeScript deprecation-diagnostic run, which I did not repeat.

Citations:

- [r9a](../../src/test/suite/outputChannels.test.ts): "log.channel.show(2, false);"
- [r9b](../../node_modules/@types/vscode/index.d.ts): "@deprecated Use the overload with just one parameter (`show(preserveFocus?: boolean): void`)."
- [r9c](../../node_modules/@types/react/index.d.ts): "@deprecated FormEvent doesn't actually exist."
- [r9d](../../webview_panels/src/modules/documentationEditor/components/tests/forms/TestForm.tsx): "const handleSubmit = (event: FormEvent<HTMLFormElement>) => {"
- [r9e](../../webview_panels/src/renderPanel.tsx): "ReactDOM.createRoot(document.getElementById("root")!).render("

### 10. `url.parse()` (DEP0169) is called in typed-rest-client and azure-devops-node-api. In this tree both arrive only through @vscode/vsce's publish stack, not through the shipped runtime dependencies. So a DEP0169 warning in a smoke log most likely comes from tooling, and the fix is a newer vsce rather than a change to `src/`. This attribution is by static search; I did not read a smoke log

Verdict: new. Confidence: medium.

I confirmed the `url.parse` calls in both installed packages. The vsce dependency chain and the absence of matches in the runtime dependencies come from the antithesis.

Citations:

- [r10a](../../node_modules/typed-rest-client/HttpClient.js): "let parsedUrl = url.parse(requestUrl);"
- [r10b](../../node_modules/azure-devops-node-api/WebApi.js): "const serverUrl = url.parse(_url).host.toLowerCase();"

### 11. Remove the deprecated glob in one of two ways. Either add a scoped override that forces test-cli onto the root mocha 12, for example `"@vscode/test-cli": {"mocha": "$mocha"}`, or drop @vscode/test-cli and drive @vscode/test-electron from `scripts/test/run-integration.mjs`, which already launches one label without test-cli. Then add a CI and `just check` gate that fails on `npm audit --audit-level=low` or on any `"deprecated"` field in package-lock.json. Neither fix has been tested against test-cli 0.0.15

Verdict: new. Confidence: low.

I verified the deprecated entry, the mocha ranges and the label that is launched directly. The fixes themselves are untested.

Citations:

- [r11a](../../scripts/test/integration-layout.mjs): "/** The label launched directly, without test-cli, because test-electron always disables workspace trust. */"

## Alternatives the thesis missed

Fix the one deprecated package by forcing @vscode/test-cli onto the root mocha 12 with a scoped override (for example `"@vscode/test-cli": {"mocha": "$mocha"}`). This removes the nested mocha 11.8.0 and glob 10.5.0, the only `deprecated` entry in package-lock.json. The fallback is to drop @vscode/test-cli and call `@vscode/test-electron` directly from `scripts/test/run-integration.mjs`, since that script already launches one label without test-cli. Either way, add a CI step that fails when package-lock.json contains `"deprecated"`, because `npm audit` does not report deprecations. Not tested here; test-cli's compatibility with mocha 12 is unverified.

- [m1](../../package-lock.json): ""node_modules/@vscode/test-cli/node_modules/mocha/node_modules/glob": {"
- [m2](../../scripts/test/integration-layout.mjs): "/** The label launched directly, without test-cli, because test-electron always disables workspace trust. */"

Keep @types/vscode at 1.125.0. That is the highest published version at or below the engine floor, and the repo's research docs record the decision. A change only becomes possible when Cursor's VS Code base moves past 1.128 and `engines.vscode` is raised, at which point the next published candidate is 1.134.0. This replaces the thesis's PR 1.

- [m3](../refactor/rearchitecture-plan.md): "`@types/vscode` stays at 1.125.0 for `engines.vscode` `^1.128.0`'s API floor."

The real deprecated-API worklist is small and concrete. Test code: replace `log.channel.show(2, false)` (two places in `outputChannels.test.ts`) with the one-argument `show(preserveFocus)` form, since the two-argument `OutputChannel.show(column, preserveFocus)` is `@deprecated` in the 1.125 types. Webview code: replace the deprecated `FormEvent` type in `TestForm.tsx` and `DisplayTestDetails.tsx` with the non-deprecated event type that fits each handler. Host `src/` has no deprecated uses. A guard would be a type-aware no-deprecated lint rule, so the finding is enforced and not scanned once. I did not confirm that Oxlint's version in the lint study ships such a rule.

- [m4](../../node_modules/@types/vscode/index.d.ts): "@deprecated Use the overload with just one parameter (`show(preserveFocus?: boolean): void`)."

Treat package-manager migration as a packaging-flag question first. vsce shells out to `npm list --production --parseable --depth=99999`, and its only other path is Yarn 1, so a pnpm or Bun layout would need `vsce package --no-dependencies`. That is plausible here because `.vscodeignore` already excludes `**/node_modules` and the build bundles the runtime dependencies. The npm-specific costs remain (npm `allowScripts` with `--strict-allow-scripts`, `overrides`, lockfile-lint on package-lock.json, Docker `npm ci`). That is a reasoned basis for keeping npm 11, which the thesis asserted without one.

- [m5](https://raw.githubusercontent.com/microsoft/vscode-vsce/main/src/npm.ts): "exec('npm list --production --parseable --depth=99999 --loglevel=error', { cwd, maxBuffer: 5000 * 1024 })"
- [m6](../../docker/integration/Dockerfile): "RUN npm ci --strict-allow-scripts"

The Node 24 DEP0169 warning in smoke logs most likely comes from @vscode/vsce's publish stack, not the extension. `typed-rest-client@1.8.11` and `azure-devops-node-api@12.5.0` call `url.parse()`. The actions are to check whether the smoke run invokes the vsce Marketplace client, and to take a newer vsce when it ships (4.0.1 is on the `next` tag). Do not change `src/`. This is attributed by static search of installed packages, not by reading a smoke log.

- [m7](../../node_modules/typed-rest-client/HttpClient.js): "let parsedUrl = url.parse(requestUrl);"

Drop mocha as a candidate. It is a devDependency used by only two harness files (`src/test/smoke/runTests.ts` and `src/test/integration/untrusted/index.ts`) alongside Vitest for unit tests, and it is the root of the deprecated glob chain via test-cli. This only works if the integration runner can be driven without the Mocha runner API, and vscode-test needs a Mocha-style `run()` entry, so confirm that before committing. Treat it as a candidate, not a finding.

- [m8](../../src/test/integration/untrusted/index.ts): "const mocha = new Mocha({ ui: "tdd", timeout: 30_000, color: true });"

## Open questions

- Does @vscode/test-cli 0.0.15 work when overridden to mocha 12, or must the integration harness drop test-cli and call test-electron directly?
- Which package actually emits each DEP0xxx warning in a real smoke log? A run with `--trace-deprecation` would confirm the static attribution of DEP0169 to vsce's typed-rest-client and azure-devops-node-api.
- What is the VS Code team's written guidance on matching an extension's development Node version to Electron's Node?
- As of October 2026, do Bun and pnpm offer equivalents to npm `allowScripts`/`--strict-allow-scripts`, `overrides` and lockfile-lint? Can Bun run Vitest, rsbuild and Vite reliably, and could `bun test` cover happy-dom, React Testing Library and coverage?
- Can Vite library mode, Rolldown or tsdown build the host bundle with output equivalent to rsbuild's, so the repo needs only one bundler?
- Does the Oxlint version chosen in the lint study ship a type-aware no-deprecated rule? Are any deprecated `vscode-languageclient` options in use?
- Is the fast-glob shim still needed with type-coverage 2.30.3? Which of the advisory overrides (uuid, serialize-javascript, diff, brace-expansion, minimatch, shell-quote, maplibre-gl) can be removed without audit findings coming back?
- Does mise.lock carry checksums for every platform used in CI and Docker? What is the maintenance status of just, lefthook, dprint, rumdl, shfmt, ShellCheck and jj, and does dprint overlap with oxfmt?

## Rejected citations

None.
