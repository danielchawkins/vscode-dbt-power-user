# Research

## Question

How can clean-code and modular-design principles best be applied to this repository (a TypeScript VS Code extension plus a React 19 webview build) to improve separation of concerns, remove duplication, make modules composable, and keep boundaries clean and enforceable? Identify the concrete places in the code where concerns are mixed, logic is duplicated, modules are hard to compose or test, or boundaries leak, and for each give the improvement, the principle behind it, and how it could be enforced mechanically (dependency-cruiser, oxlint/eslint, ast-grep, types, tests).

## Recommendation

On the fundamentals, this codebase already does most things right. Wiring happens in one place with plain constructors (compositionRoot). Boundaries are checked mechanically on both sides: the root depcruise run passes with 0 violations over 213 modules, and the webview has its own contract-only depcruise rule and posting rule. One shared lint list covers settings and fs writes. Debt is held by a CI-enforced suppression ratchet. So don't add gates. Do the few structural changes that remove a present cost, in order of value against risk: (1) add src/dbt_integration/domain.ts to the pure-modules-stay-pure rule and add a depcruise `allowed` section so new folders must be placed in a layer (one-line changes, low risk); (2) declare the twelve-map manifest shape once in core/ and make ParsedManifest an alias of it (low risk; mostly tidying, since tsc already checks the two match); (3) flatten Project → ProjectDbtCommands → ProjectQueries into composition, removing the abstract-member protocol and the one-line delegations (medium risk, the largest real gain for modularity); (4) optionally, a subscribe function for inbound webview messages in src/webview where the caller keeps the disposable, followed by a lint ban on onDidReceiveMessage outside src/webview; (5) pay down parameter-properties and max-params suppressions through the existing ratchet, which can include a parameter object for DBTPowerUserExtension. Do not add reader ports for core parsers or features, a factory for Project's private collaborators, a split composition root, a PanelHost demand helper, or root depcruise coverage of the webview: each fails the repo's second-user-or-test-seam rule or duplicates a check that already exists. Treat 'functional core' here as 'vscode-free core' and document it that way, or freeze the five node:fs importers with an allowlist rule. Before relying on ast-grep for anything, add an sgconfig.yml and prove that one rule works.

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Verdict    | Confidence |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1. The manifest shape really is declared twice: ParsedManifest in src/dbt_integration/domain.ts and MergeableManifest in src/core/metadata/mergeMetadata.ts. The cost is small, though, because the compiler already checks that the two match. compositeMetadataSource keeps a ParsedManifest and passes it to mergeMetadata, which takes a MergeableManifest. The cheap fix is to declare the twelve-map shape once in core/ (domain.ts already imports its map types only from core/manifest/types) and turn ParsedManifest into an alias or re-export of it. An expectTypeOf equality test would add nothing, because tsc already enforces the match. Risk is low and value is low to medium: this is tidying, not a bug fix.                                                                                                                                                                                                 | middle     | high       |
| 2. dbt_integration/ is a documented home for shared domain types, not an unclassified layer. Its one logic file, dbtAssociations.ts, is already covered by the pure-modules-stay-pure rule. The real gap is narrower: no purity rule covers domain.ts, and that file mixes types with a runtime enum (RunModelType) and file-name constants. Fix it by adding domain.ts to the path list of pure-modules-stay-pure, a one-line change, rather than moving a folder whose imports would touch many files. To catch new unclassified folders later, use dependency-cruiser's native `allowed` section. The current config has only `forbidden` rules.                                                                                                                                                                                                                                                                               | antithesis | high       |
| 3. Project does build its private collaborators in its constructor: ManifestState, ProjectDiagnostics, ProjectErrors, ProjectTasks, RunResultsReader and ManifestTrigger. Those collaborators are wired with closures over `this`. Project's external dependencies are already injected through ProjectOptions, and a test harness builds it with overrides. A factory that takes a typed graph of these private parts would have to rebuild those back-references, and it would break the repo's own rule against abstractions without a second user or a named test seam. Leave the constructor alone. The structural issue in this area is the inheritance chain (point 16).                                                                                                                                                                                                                                                   | antithesis | medium     |
| 4. DBTPowerUserExtension does take 21 constructor parameters, all of them TypeScript parameter properties. Its suppression entry holds 1 max-params violation and 21 typescript/parameter-properties violations. The class is constructed in exactly one place (compositionRoot.ts:383). A parameter object would clear the single max-params suppression and, if the fields become explicit, the 21 parameter-property suppressions. It would not make the disposal order any more explicit, because that order lives in the push order. Value is low to medium and risk is low. Do it only as part of shrinking the ratchet, using the ratchet that already exists (point 10).                                                                                                                                                                                                                                                  | middle     | high       |
| 5. Inbound webview messages have no funnel. Exactly three feature files call onDidReceiveMessage (docsEditPanel, lineageViewProvider and queryResultPanel), and each disposes differently. A PanelHost method cannot fix this, because LineageViewProvider is a WebviewViewProvider and not a PanelHost. The disposal policies also differ for real reasons: docsEditPanel re-resolves, and queryResultPanel's subscription dies with its tab. If a funnel is wanted, the right design is a free function in src/webview, roughly subscribe(webview, handler, sink): Disposable. The caller keeps ownership of the disposable, so the function needs no policy flag. Only after that function exists should lint/boundaries.mjs ban onDidReceiveMessage outside src/webview, mirroring the outbound postMessage rule. PanelHost's abstract `entry`/`csp` template method is conventional inheritance and does not need replacing. | middle     | medium     |
| 6. The demand-following blocks are not identical copies. Each one calls the already-shared ParseDemand.follow, and a third caller exists in treeViews.ts. docsEditPanel stores the subscription in a field and disposes it when the panel is disposed. lineageViewProvider pushes it into a list only when it is defined. This is ordinary use of an extracted helper with different ownership, so leave it. No jscpd-style tool is configured, and none is needed here.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | antithesis | high       |
| 7. core/ is free of vscode, not free of I/O. Five core files import node:fs: docParser, macroParser, manifest/utils, dbtProjectFile and dbtEnvironment. docParser and macroParser read files the same way inside their parse loops. The repo only promises 'no vscode', so nothing is broken. Still, 'functional core' should be read as 'vscode-free core'. The honest options are: (a) document that promise exactly; or (b) when a named test seam appears, apply the injected-reader pattern from dbtProjectFile to both parsers together, never to one alone. A depcruise rule against node:fs in core would need a five-file allowlist. As a freeze on new fs importers that is acceptable, but it is weak as a purity rule.                                                                                                                                                                                                | middle     | medium     |
| 8. Seven non-test feature files read the disk: dbtTestService, docsYaml, docGenService, docsEditHandlers, projectConfigCommands, cte/commands and cteProfilerService. At least one of them prefers the open editor buffer and only falls back to disk. The shared lint list restricts fs writes on purpose and leaves reads alone. Banning reads, or adding a reader port owned by projects, would break seven files at once to serve a storage backend that is not planned. Leave reads alone unless one specific project fact, such as dbt_project.yml, turns out to be read in several places. That is the kind of defect the plan counts, and it should be fixed for that fact only.                                                                                                                                                                                                                                          | antithesis | medium     |
| 9. Imports in the webview are already checked. webview_panels has its own dependency-cruiser config with a webview-imports-contract-only rule, a lint:imports script that runs it, and its own lint/boundaries.mjs that lets only the request executor post to the host. The root config ignores webview_panels/** because that workspace lints itself. Adding the webview to the root depcruise run would duplicate the rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | antithesis | high       |
| 10. The thesis counts are right: 1234 host suppressions. The gate it asks for already exists, though. ceilings.json records the totals, ratchet.mjs fails when a ceiling loosens, CI compares the ceilings against the PR base, and AGENTS.md documents that `just lint-ratchet` fails when a count rises. The work left is to pay the debt down, for example the 233 parameter-properties suppressions, not to build more gating.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | antithesis | high       |
| 11. Keep the four seams the thesis lists: the exhaustive Handlers map in messageRouter, the shared lint/boundaries.mjs, the injected `exists` in dbtProjectFile, and the shared webview requestExecutor. Add to that list the suppression ratchet, the webview's own depcruise config, ParseDemand.follow, and ProjectOptions together with the test harness. The list itself holds. It is incomplete, and it conflicts with the thesis's own point 7 proposal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | middle     | high       |
| 12. Keeping documentationTreeview and modelTreeviewProvider apart is correct, but the overlap that was measured is mostly imports, so it proves little either way. The more interesting module is modelTreeviewProvider.ts: 339 lines holding an abstract ModelTreeviewProvider plus small Node and NodeTreeItem subclass families. The many tiny subclasses are cheap tag types, and splitting the file would be cosmetic. Leave it unless a new node kind adds conditionals to the base.                                                                                                                                                                                                                                                                                                                                                                                                                                        | middle     | medium     |
| 13. Keep compositionRoot.ts as a single readable wiring file. The plan's rule is 'plain constructors, one place, no container', and nobody showed what is hard to change in the file today. A narrow read port of Project for features cannot be enforced by depcruise, which sees modules and not members, or by ast-grep, which has no type information. Without a rule it would only be a convention. If coupling from features to Project becomes a problem, a TypeScript interface that each feature takes as its constructor type is the mechanism that can be enforced.                                                                                                                                                                                                                                                                                                                                                    | antithesis | medium     |
| 14. This one is done. getConfiguration appears only in src/settings/index.ts (8 occurrences, all outside tests), down from the 12 files the plan recorded. The SETTINGS_NAMES restriction in lint/boundaries.mjs keeps it that way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | thesis     | high       |
| 15. Most of the caveats hold. There is no sgconfig.yml and no .ast-grep directory, so any recommendation that depends on ast-grep is aspirational. webview_panels uses React 19 and has no Redux. I re-ran the depcruise numbers: 'no dependency violations found (213 modules, 1135 dependencies cruised)'. The caveats missed the bigger error in point 9 and the existing ratchet in point 10. I did not run tsc, the tests or oxlint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | middle     | high       |
| 16. The clearest misuse of inheritance in the repo is the Project chain: Project extends ProjectDbtCommands, which extends ProjectQueries. The two abstract bases declare abstract members that the leaf class fills in, so the inheritance mainly splits one class across three files (470 + 67 + 126 lines). ProjectDbtCommands is mostly one-line delegations to this.tasks. Composing instead, by exposing the task and query objects or making them plain modules that take what they need, would delete the pass-through methods and the abstract-member protocol. Value is medium and risk is medium, because callers of project.runModel and similar methods would change. A lint or ast-grep rule against `abstract class X extends` under src/projects could keep the chain from coming back.                                                                                                                           | new        | medium     |
| 17. Use dependency-cruiser's native features before writing custom rules. An `allowed` section catches new top-level folders that no layer covers. numberOfDependentsMoreThan sets a mechanical fan-in ceiling on hub modules such as settings/index.ts and project.ts, which turns 'god module' from a judgement into a ratcheted number. Today the config uses only `forbidden`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | new        | medium     |
| 18. The repo's own rule ('an abstraction is introduced only with its second user or a named test seam') is the right filter for this whole list. Applied consistently, it rejects the docParser reader port, the feature reader port, the Project collaborator factory, and splitting the composition root. It keeps the narrow work: one manifest shape in core, domain.ts under the purity rule, the Project inheritance chain flattened, and possibly an inbound message funnel.                                                                                                                                                                                                                                                                                                                                                                                                                                               | new        | medium     |

## Detail

### 1. The manifest shape really is declared twice: ParsedManifest in src/dbt_integration/domain.ts and MergeableManifest in src/core/metadata/mergeMetadata.ts. The cost is small, though, because the compiler already checks that the two match. compositeMetadataSource keeps a ParsedManifest and passes it to mergeMetadata, which takes a MergeableManifest. The cheap fix is to declare the twelve-map shape once in core/ (domain.ts already imports its map types only from core/manifest/types) and turn ParsedManifest into an alias or re-export of it. An expectTypeOf equality test would add nothing, because tsc already enforces the match. Risk is low and value is low to medium: this is tidying, not a bug fix

Verdict: middle. Confidence: high.

I confirmed both declarations and the call site where tsc checks them against each other. The antithesis is right on both counts: the duplicate exists because core-is-pure stops core from importing dbt_integration, and tsc already enforces the match. The thesis is right that a single declaration is the cleaner end state. Neither side showed a bug caused by drift, so the value is modest.

Citations:

- [r1a](../../src/core/metadata/mergeMetadata.ts): "/** The maps consumers read; `ParsedManifest` has the same shape. */"
- [r1b](../../src/metadata/compositeMetadataSource.ts): "const merged = mergeMetadata(server, this.parsed, {"
- [r1c](../../src/metadata/compositeMetadataSource.ts): "private parsed: ParsedManifest | undefined;"
- [r1d](../../.dependency-cruiser.cjs): "core/ imports neither vscode nor any other layer."

Thesis (high): The parsed-manifest shape is declared twice. dbt_integration/domain.ts defines ParsedManifest with 12 map fields, and core/metadata/mergeMetadata.ts defines MergeableManifest with the same 12 fields. The mergeMetadata comment admits the duplication. Fix: define the shape once in core/manifest/types and derive the other as a type alias or Pick. Principle: one source of truth per fact (plan rule). Enforcement: tsc with an expectTypeOf equality test, and knip for unused exports after the move.

Thesis citations:

- [c01](../../src/core/dbt/domain.ts): "export interface ParsedManifest {"
- [c02](../../src/core/metadata/mergeMetadata.ts): "The maps consumers read; `ParsedManifest` has the same shape."

Antithesis: The thesis proposes moving the shape into core/manifest/types. It never says that this direction is forced by the layer rules. core-is-pure stops core from importing src/dbt_integration, so MergeableManifest exists because of that rule. The duplicate is a symptom of dbt_integration/domain.ts sitting in the wrong layer. Point 2 is the real cause, and the thesis ranks it separately from point 1.

Antithesis: A type alias or Pick is a real fix, but the thesis calls it 'low risk, high value' without saying what it buys. Both interfaces are twelve map fields and only one lives in core. Drift between them is already caught by the compiler, because projects/ passes a ParsedManifest into functions that accept a MergeableManifest. tsc already enforces the structural equality, so an expectTypeOf equality test adds nothing.

Antithesis: Confidence 'high' is justified for the fact that the duplicate exists. It is not justified for 'high value': nothing in the thesis shows a bug or a change that touched both.

Antithesis: The mergeMetadata comment says only that ParsedManifest 'has the same shape'. The thesis reads it as an admission of harmful duplication. It is equally a deliberate decoupling note: the core function takes a minimal structural input type.

Counter-evidence:

- [a01](../../.dependency-cruiser.cjs): "name: "pure-modules-stay-pure","
- [a02](../../src/core/metadata/mergeMetadata.ts): "/** The maps consumers read; `ParsedManifest` has the same shape. */"

### 2. dbt_integration/ is a documented home for shared domain types, not an unclassified layer. Its one logic file, dbtAssociations.ts, is already covered by the pure-modules-stay-pure rule. The real gap is narrower: no purity rule covers domain.ts, and that file mixes types with a runtime enum (RunModelType) and file-name constants. Fix it by adding domain.ts to the path list of pure-modules-stay-pure, a one-line change, rather than moving a folder whose imports would touch many files. To catch new unclassified folders later, use dependency-cruiser's native `allowed` section. The current config has only `forbidden` rules

Verdict: antithesis. Confidence: high.

I read the rule. Its `from` path is the dbtAssociations.ts file, so the thesis claim that the layer rules 'never name' the folder is false. AGENTS.md documents the folder. domain.ts imports only from ../core/manifest/types. grep found no `allowed:` section in .dependency-cruiser.cjs.

Citations:

- [r2a](../../.dependency-cruiser.cjs): ""These modules hold logic that property tests cover without the vscode module.","
- [r2b](../../AGENTS.md): "shared domain types, `DBTCommand`, `DBTTerminal`"
- [r2c](../../src/core/dbt/domain.ts): "export enum RunModelType {"
- [r2d](../../src/core/dbt/domain.ts): "export const MANIFEST_FILE = "manifest.json";"

Thesis (high): dbt_integration/ is an unclassified layer. It holds only domain.ts, dbtAssociations.ts and NOTICE.md, yet projects/ imports from it on about 15 edges and 25 modules import it. The layer rules in .dependency-cruiser.cjs never name it, so it escapes every layer check. Principle: a cycle or a misplaced module means a layer is wrong (the depcruise comment says so). Fix: move the types to core/ (pure) or rename the folder to the layer it really is, then add it to the layer rules. Enforcement: a depcruise rule that fails when a new top-level src folder is not listed in a layer.

Thesis citations:

- [c03](../../src/projects/manifest/manifest.ts): "import type { ParsedManifest } from "../dbt_integration/domain";"
- [c04](../../.dependency-cruiser.cjs): "A cycle means two modules are one concept or one of them is in the wrong layer."

Antithesis: The claim that the layer rules 'never name' dbt_integration is false. .dependency-cruiser.cjs has a pure-modules-stay-pure rule whose `from` is src/dbt_integration/dbtAssociations.ts. It forbids vscode and every src/ path outside core/. The only logic file in the folder is therefore already guarded.

Antithesis: dbt_integration/ is documented, not unclassified. AGENTS.md lists it as the home of shared domain types. domain.ts and dbtAssociations.ts import only from ../core/ and node:path, which I read. The real hole is narrower: domain.ts has no purity rule and mixes types with a runtime enum (RunModelType) and the constants MANIFEST_FILE, RUN_RESULTS_FILE and CATALOG_FILE. Extending the existing rule's path list by one entry is a one-line fix. The thesis instead proposes a folder move.

Antithesis: A move or rename touches 34 files that mention dbt_integration (23 non-test imports of domain). That is a wide change for a folder with no violations and no logic.

Antithesis: The proposed enforcement, 'a depcruise rule that fails when a new top-level src folder is not listed in a layer', is something depcruise already offers natively through the `allowed` whitelist section. The thesis proposes a custom rule instead.

Antithesis: The thesis cites the core-is-pure comment. That comment says only that core imports no other layer. It says nothing about whether dbt_integration is a layer, so it does not support the claim.

Counter-evidence:

- [a03](../../AGENTS.md): "shared domain types, `DBTCommand`, `DBTTerminal`"
- [a04](../../src/core/dbt/dbtAssociations.ts): "import type { ProjectPaths } from "../core/project";"
- [a05](https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/doc/rules-reference.md): "A list of rules that describe dependencies that are *allowed*."

### 3. Project does build its private collaborators in its constructor: ManifestState, ProjectDiagnostics, ProjectErrors, ProjectTasks, RunResultsReader and ManifestTrigger. Those collaborators are wired with closures over `this`. Project's external dependencies are already injected through ProjectOptions, and a test harness builds it with overrides. A factory that takes a typed graph of these private parts would have to rebuild those back-references, and it would break the repo's own rule against abstractions without a second user or a named test seam. Leave the constructor alone. The structural issue in this area is the inheritance chain (point 16)

Verdict: antithesis. Confidence: medium.

I confirmed the `new` calls in the constructor, the closure wiring, the harness and the plan rule. Only compositionRoot.ts and the test harness construct a Project. I did not check the fan-in figure of 42.

Citations:

- [r3a](../../src/projects/project/project.ts): "this.runResultsReader = new RunResultsReader("
- [r3b](../../src/test/projectHarness.ts): "Builds a `Project` with inert collaborators; `overrides` replaces any of them."
- [r3c](../refactor/rearchitecture-plan.md): "An abstraction is introduced only with its second user or a named test seam."

Thesis (medium): Project builds most of its collaborators inside its constructor rather than receiving them. The constructor (project.ts:131 onward) creates ProjectDiagnostics, ProjectErrors, ProjectTasks, RunResultsReader, ManifestTrigger and ManifestRebuild, and it calls readProjectSnapshot directly. Project has 42 importers, so this hidden wiring makes it hard to test in isolation and to compose differently. Principle: separate configuration from use (Fowler) and keep the shell thin. Fix: a factory that takes a typed graph (the ProjectOptions pattern extended), so each internal collaborator becomes an injected port. Enforcement: an ast-grep rule that flags new of a collaborator class inside src/projects outside the factory file.

Thesis citations:

- [c05](../../src/projects/project/project.ts): "this.runResultsReader = new RunResultsReader("
- [c06](../../src/projects/project/project.ts): "() => readProjectSnapshot(this.projectRoot),"
- [c07](../../src/projects/project/project.ts): "The collaborators a `Project` is built from."

Antithesis: Project is already composable and testable. Its ProjectOptions injects the resolver, cliFactory, parsers, sharedState, runHistoryService, fusionClient, clientChanged and parseDemand. The tests build it through buildTestProject with `Partial<ProjectOptions>` overrides. ProjectDiagnostics, ProjectTasks and the other internals have their own unit tests (projectDiagnostics.test.ts constructs ProjectDiagnostics directly).

Antithesis: The internal collaborators are wired with closures over `this`: `() => this.getProjectName()`, `() => this.manifestRebuild.rebuild(this.getFusionCli())`, and ManifestTrigger callbacks into `this.scheduler`. A factory taking a 'typed graph' would have to re-create those back-references. The result is a mutually recursive construction problem and more indirection, not less.

Antithesis: The ast-grep rule 'flag new of a collaborator class inside src/projects outside the factory file' would ban new in the only file where a Project is assembled. It also contradicts the plan's own rule: an abstraction needs a second user or a named test seam. Neither exists for these private collaborators.

Antithesis: The thesis says Project has '42 importers'. My count of files importing projects/project or ./project was 29, and `new Project(` appears only in compositionRoot.ts and the test harness. The fan-in figure is not reproducible by the obvious measure.

Antithesis: The thesis misses the structural problem that is here: Project is the bottom of a three-level inheritance chain (see missed alternatives).

Antithesis: The thesis cites `() => readProjectSnapshot(this.projectRoot)` as hidden wiring. readProjectSnapshot is a function that has its own depcruise rule (snapshot-reader-reads-only). It is a deliberately fenced shell function, not an unseen dependency.

Counter-evidence:

- [a06](../../src/test/projectHarness.ts): "Builds a `Project` with inert collaborators; `overrides` replaces any of them."
- [a07](../../src/projects/project/project.ts): "rebuildOnce: () => this.manifestRebuild.rebuild(this.getFusionCli()),"
- [a08](../../src/projects/project/project.ts): "parsers: ManifestParsers;"
- [a09](../refactor/rearchitecture-plan.md): "An abstraction is introduced only with its second user or a named test seam."

### 4. DBTPowerUserExtension does take 21 constructor parameters, all of them TypeScript parameter properties. Its suppression entry holds 1 max-params violation and 21 typescript/parameter-properties violations. The class is constructed in exactly one place (compositionRoot.ts:383). A parameter object would clear the single max-params suppression and, if the fields become explicit, the 21 parameter-property suppressions. It would not make the disposal order any more explicit, because that order lives in the push order. Value is low to medium and risk is low. Do it only as part of shrinking the ratchet, using the ratchet that already exists (point 10)

Verdict: middle. Confidence: high.

I counted 21 private/readonly constructor parameters and read the suppression counts. The antithesis correctly separates the two kinds of suppression. The thesis is right that grouping is a legitimate small cleanup, so the ruling falls between them.

Citations:

- [r4a](../../src/compositionRoot.ts): "const extension = new DBTPowerUserExtension("
- [r4b](../../oxlint-suppressions.json): ""typescript/parameter-properties": {"
- [r4c](https://martinfowler.com/articles/injection.html): "principle of separating configuration from use."

Thesis (high): DBTPowerUserExtension's constructor takes 21 parameters (dbtPowerUserExtension.ts:35 onward), and the Oxlint suppressions record a max-params exception for this file. The parameters group naturally by lifecycle: the constructor comments already say sharedState and runHistoryService must be disposed last. Fix: group them into named parameter objects (Fowler's Introduce Parameter Object) by lifecycle or feature, and ratchet max-params downward. Principle: a parameter object keeps ordering and disposal explicit. Enforcement: lower the max-params limit and let oxlint-suppressions shrink; a CI script can fail if the suppression count for this file grows.

Thesis citations:

- [c08](../../src/fusionPowerUserExtension.ts): "private projects: Projects,"
- [c09](../../src/fusionPowerUserExtension.ts): "private projectEnvironments: ProjectEnvironments,"
- [c10](../../oxlint-suppressions.json): ""src/dbtPowerUserExtension.ts": {"
- [c11](https://martinfowler.com/articles/injection.html): "The choice between them is less important than the principle of separating configuration from use."

Antithesis: DBTPowerUserExtension has exactly one construction site, compositionRoot.ts. A parameter object here renames the problem and moves the 21 fields into an interface that the root fills in. Only the root and the class change, so the gain is small.

Antithesis: The ratchet suppression for this file is `max-params` count 1 and `typescript/parameter-properties` count 21. Only one violation belongs to the 21 parameters. The other 21 come from using TypeScript parameter properties. Grouping into parameter objects does not remove the parameter-property violations unless the class is also rewritten. The thesis blurs the two.

Antithesis: The proposed enforcement, 'a CI script can fail if the suppression count for this file grows', already exists in a stronger form (see point 10). The thesis says to build something the repo has.

Antithesis: The constructor comments say sharedState and runHistoryService must be disposed last. The thesis reads this as evidence for grouping by lifecycle. The constructor already states the disposal order explicitly in its `disposables.push(...)` list. A parameter object would not enforce it, because ordering lives in the push order.

Counter-evidence:

- [a10](../../src/compositionRoot.ts): "const extension = new DBTPowerUserExtension("
- [a11](../../oxlint-suppressions.json): ""typescript/parameter-properties": {"

### 5. Inbound webview messages have no funnel. Exactly three feature files call onDidReceiveMessage (docsEditPanel, lineageViewProvider and queryResultPanel), and each disposes differently. A PanelHost method cannot fix this, because LineageViewProvider is a WebviewViewProvider and not a PanelHost. The disposal policies also differ for real reasons: docsEditPanel re-resolves, and queryResultPanel's subscription dies with its tab. If a funnel is wanted, the right design is a free function in src/webview, roughly subscribe(webview, handler, sink): Disposable. The caller keeps ownership of the disposable, so the function needs no policy flag. Only after that function exists should lint/boundaries.mjs ban onDidReceiveMessage outside src/webview, mirroring the outbound postMessage rule. PanelHost's abstract `entry`/`csp` template method is conventional inheritance and does not need replacing

Verdict: middle. Confidence: medium.

I confirmed with grep the three call sites and their different disposal, and that LineageViewProvider implements WebviewViewProvider. The thesis's diagnosis (no inbound funnel) holds. Its fix (a PanelHost-centred helper, with the ban introduced first) does not.

Citations:

- [r5a](../../src/features/lineage/lineageViewProvider.ts): "export class LineageViewProvider implements WebviewViewProvider, Disposable {"
- [r5b](../../src/features/docs/docsEditPanel.ts): "this.onMessageDisposable?.dispose();"
- [r5c](../../src/features/queryResults/queryResultPanel.ts): "const subscription = panel.webview.onDidReceiveMessage((message: unknown) =>"
- [r5d](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction): "If you find yourself passing parameters and adding conditional paths through shared code, the abstraction is incorrect."

Thesis (high): Panel plumbing is repeated by inheritance rather than shared by composition. PanelHost is an abstract base whose four-parameter constructor every subclass re-declares; LineagePanel (lineagePanel.ts:74) declares five. Each panel also subscribes to webview messages on its own with different disposal policies: docsEditPanel keeps an onMessageDisposable, queryResultPanel disposes with the tab, and lineageViewProvider pushes to this.disposables. Principle: composition over inheritance. Fix: extract a WebviewChannel helper (subscribe, route through dispatchMessage, dispose) that panels own as a field. Enforcement: extend lint/boundaries.mjs so that onDidReceiveMessage may only appear under src/webview, matching the existing postMessage rule.

Thesis citations:

- [c12](../../src/webview/panelHost.ts): "Renders a panel's Vite entry and routes the commands every panel sends; each panel subclasses it."
- [c13](../../src/features/docs/docsEditPanel.ts): "this.onMessageDisposable = this._panel!.webview.onDidReceiveMessage("
- [c14](../../src/features/lineage/lineageViewProvider.ts): "(message: unknown) => this.getPanel().handleCommand(message),"
- [c15](../../src/features/queryResults/queryResultPanel.ts): "panel.onDidDispose(() => subscription.dispose());"
- [c16](https://en.wikipedia.org/wiki/Composition_over_inheritance): "composition simulates inheritance by having the children include a copy of a "pseudo-parent" class as a field"

Antithesis: The thesis proposes a shared helper placed on PanelHost or in a WebviewChannel. LineageViewProvider is not a PanelHost. It is a separate WebviewViewProvider that owns a LineagePanel, so a PanelHost method cannot reach it.

Antithesis: The three disposal policies may not be accidental. DocsEditViewPanel re-resolves a WebviewView, so it must dispose the previous subscription (`this.onMessageDisposable?.dispose()`) before resubscribing. QueryResultPanel manages WebviewPanels that die with their tab. A single helper would need a policy flag. That is the flag-driven abstraction the thesis's own point 12 warns against.

Antithesis: The thesis states the rule 'onDidReceiveMessage may only appear under src/webview'. The repo has zero uses of that API under src/webview, since only three feature files call it. The ban would fail immediately unless the helper is built first. The rule is a consequence of the refactor, not an independent safeguard.

Antithesis: The existing postMessage rule is a precedent only for the outbound direction, where a single funnel (PanelHost.post) already exists. The inbound direction has no funnel to point a rule at yet.

Antithesis: The thesis cites only PanelHost's four-parameter constructor being re-declared. LineagePanel's extra parameters (terminal, dbtLineageService) are subclass needs and not duplication; only extensionContext, emitterService, dbtTerminal and queryManifestService are repeated.

Antithesis: The Wikipedia quote about composition is generic. The thesis does not demonstrate that PanelHost's inheritance causes a defect here. PanelHost uses abstract members (`entry`, `csp`) as a template-method hook, which is a conventional use of inheritance.

Counter-evidence:

- [a12](../../src/features/lineage/lineageViewProvider.ts): "export class LineageViewProvider implements WebviewViewProvider, Disposable {"
- [a13](../../src/features/docs/docsEditPanel.ts): "this.onMessageDisposable?.dispose();"

### 6. The demand-following blocks are not identical copies. Each one calls the already-shared ParseDemand.follow, and a third caller exists in treeViews.ts. docsEditPanel stores the subscription in a field and disposes it when the panel is disposed. lineageViewProvider pushes it into a list only when it is defined. This is ordinary use of an extracted helper with different ownership, so leave it. No jscpd-style tool is configured, and none is needed here

Verdict: antithesis. Confidence: high.

I read all three call sites. The disposal code differs, and the behaviour that is the same already lives in ParseDemand.follow.

Citations:

- [r6a](../../src/features/docs/docsEditPanel.ts): "panel.onDidDispose(() => this.demandSubscription?.dispose());"
- [r6b](../../src/features/lineage/lineageViewProvider.ts): "this.disposables.push(demand);"
- [r6c](../../src/features/treeViews.ts): "parseDemand.follow(() => view.visible, view.onDidChangeVisibility),"

Thesis (high): The demand-following block is duplicated word for word in two panels: docsEditPanel.ts:189 and lineageViewProvider.ts:81 both call parseDemand.follow with the same panel.visible and onDidChangeVisibility arguments, then wire disposal. This is a true duplicate of behaviour (the rule: duplicate when the copies change together), and it is cheap to share as one PanelHost method. Principle: DRY, applied only to the behaviour that is identical. Enforcement: a jscpd-style check or a six-line duplicate window test in CI; the existing scan finds it.

Thesis citations:

- [c17](../../src/features/docs/docsEditPanel.ts): "this.demandSubscription = this.parseDemand?.follow("
- [c18](../../src/features/lineage/lineageViewProvider.ts): "const demand = this.parseDemand?.follow("

Antithesis: The thesis calls this a duplicate 'word for word'. The blocks differ. docsEditPanel stores the subscription in a field, disposes the previous one on re-resolve, and handles the optional case through `?.`. lineageViewProvider pushes the subscription into a list only `if (demand)` and does not dispose a previous one. The behaviours are not identical.

Antithesis: The shared behaviour is already extracted. ParseDemand.follow is the shared function, and src/features/treeViews.ts uses it a third time. What remains is two or three call sites of the same helper with different disposal ownership, which is ordinary use of a helper.

Antithesis: A PanelHost method cannot serve LineageViewProvider (see point 5), so the 'cheap' fix reaches only one of the two copies.

Antithesis: The thesis cites a jscpd-style check, but no such tool is configured in package.json, the justfile or lefthook.yml. I found none.

Counter-evidence:

- [a14](../../src/projects/manifest/metadataDemand.ts): "/** Keeps a demand while `isVisible` holds, following `onDidChange`. */"
- [a15](../../src/features/treeViews.ts): "parseDemand.follow(() => view.visible, view.onDidChangeVisibility),"

### 7. core/ is free of vscode, not free of I/O. Five core files import node:fs: docParser, macroParser, manifest/utils, dbtProjectFile and dbtEnvironment. docParser and macroParser read files the same way inside their parse loops. The repo only promises 'no vscode', so nothing is broken. Still, 'functional core' should be read as 'vscode-free core'. The honest options are: (a) document that promise exactly; or (b) when a named test seam appears, apply the injected-reader pattern from dbtProjectFile to both parsers together, never to one alone. A depcruise rule against node:fs in core would need a five-file allowlist. As a freeze on new fs importers that is acceptable, but it is weak as a purity rule

Verdict: middle. Confidence: medium.

grep confirmed the five node:fs importers and the identical readFileSync lines in both parsers. The thesis misses macroParser. The antithesis is right that the plan's second-user rule argues against a seam today, but the gap between the purity the code implies and what it enforces is real, so the ruling falls between them.

Citations:

- [r7a](../../src/core/manifest/docParser.ts): "const docFile: string = readFileSync(fullPath).toString("utf8");"
- [r7b](../../src/core/manifest/macroParser.ts): "const macroFile: string = readFileSync(fullPath).toString("utf8");"
- [r7c](../../src/core/snapshot/dbtProjectFile.ts): "exists: (p: string) => boolean = existsSync,"
- [r7d](https://www.destroyallsoftware.com/talks/boundaries): "This talk is about using simple values (as opposed to complex objects) not just for holding data, but also as the boundaries between components and subsystems."

Thesis (medium): core/ is pure with respect to vscode but not with respect to disk. docParser.ts reads each doc file with readFileSync during parsing, and core/project/dbtProjectFile.ts and core/manifest/utils.ts use node:fs. The depcruise rule forbids only vscode and other layers, so the purity claim is weaker than it reads. dbtProjectFile.ts already shows the fix: it injects an exists seam with an existsSync default. Principle: functional core, imperative shell (Bernhardt: values as the boundaries between components). Fix: pass a reader function into docParser, as dbtProjectFile does. Enforcement: a depcruise rule that forbids node:fs from core/ with an explicit allowlist for the injected-default files.

Thesis citations:

- [c19](../../src/core/manifest/docParser.ts): "const docFile: string = readFileSync(fullPath).toString("utf8");"
- [c20](../../src/core/snapshot/dbtProjectFile.ts): "exists: (p: string) => boolean = existsSync,"
- [c21](../../.dependency-cruiser.cjs): "core/ imports neither vscode nor any other layer."
- [c22](https://www.destroyallsoftware.com/talks/boundaries): "This talk is about using simple values (as opposed to complex objects) not just for holding data, but also as the boundaries between components and subsystems."

Antithesis: The thesis lists docParser, dbtProjectFile and manifest/utils. It misses macroParser.ts, the exact sibling of docParser, which reads each macro file with readFileSync in the same loop. The fix is not a single injected reader for docParser. It is the same change in at least two parsers (plus dbtEnvironment's realpathSync).

Antithesis: The fix for docParser proposes injecting a reader. The plan says an abstraction is allowed only with a second user or a named test seam. The tests construct `new DocParser(logger)` and call createDocMetaMap on real paths, and the parser already catches the missing-file case. No test needs a fake reader, so the seam has no present caller.

Antithesis: A depcruise rule forbidding node:fs in core/ 'with an explicit allowlist for the injected-default files' encodes the exception list as the rule. The existing code already has five node:fs importers in core (docParser, macroParser, utils, dbtProjectFile, dbtEnvironment), so the allowlist would be nearly the whole directory.

Antithesis: 'Pure with respect to vscode' is what the rule's comment promises. The AGENTS-level contract is 'no vscode', not 'no I/O'. The thesis reads a stronger claim than the repo makes.

Antithesis: dbtProjectFile's `exists` seam is a default parameter that is overridden in tests. It is an example of an injected seam with a real second caller (a fake). docParser has no such second caller, so the analogy does not carry.

Counter-evidence:

- [a16](../../src/core/manifest/macroParser.ts): "const macroFile: string = readFileSync(fullPath).toString("utf8");"
- [a17](../../src/core/snapshot/dbtProjectFile.ts): "exists: (p: string) => boolean = existsSync,"

### 8. Seven non-test feature files read the disk: dbtTestService, docsYaml, docGenService, docsEditHandlers, projectConfigCommands, cte/commands and cteProfilerService. At least one of them prefers the open editor buffer and only falls back to disk. The shared lint list restricts fs writes on purpose and leaves reads alone. Banning reads, or adding a reader port owned by projects, would break seven files at once to serve a storage backend that is not planned. Leave reads alone unless one specific project fact, such as dbt_project.yml, turns out to be read in several places. That is the kind of defect the plan counts, and it should be fixed for that fact only

Verdict: antithesis. Confidence: medium.

grep confirmed the seven files and the importNames list. I did not check whether any of those reads repeat a fact that projects/ already owns.

Citations:

- [r8a](../../lint/boundaries.mjs): "importNames: ["default", "promises", ...FS_WRITES],"
- [r8b](../../src/features/projectSetup/projectConfigCommands.ts): "const text = open?.getText() ?? readFileSync(file.fsPath, "utf8");"
- [r8c](../refactor/rearchitecture-plan.md): "most recent defects were one fact resolved in several places"

Thesis (medium): Features read files directly, and the lint rules do not cover reads. docsYaml.ts, cteProfilerService.ts and dbtTestService.ts call readFileSync, and diagnostics/commands.ts calls existsSync. The shared boundary list forbids fs writes and child_process imports in features but not node:fs reads. Fix: a projects-owned reader port that features consume. Enforcement: add a node:fs import restriction for src/features to the shared lint/boundaries.mjs lists, which both ESLint and Oxlint read. Risk is medium because it moves call sites, so check each file.

Thesis citations:

- [c23](../../src/features/docs/docsYaml.ts): "const docFile = readFileSync("
- [c24](../../src/features/cte/cteProfilerService.ts): "bytes = readFileSync(filePath);"
- [c25](../../lint/boundaries.mjs): "const processImports = ["child_process", "node:child_process"].map((name) => ({"

Antithesis: The list of feature-side reads is incomplete. I also found readFileSync in docsEditHandlers.ts, cte/commands.ts and projectConfigCommands.ts (and readFile in docGenService.ts). Seven or more feature files read the disk, so a 'projects-owned reader port' is a larger change than the thesis says.

Antithesis: projectConfigCommands.ts reads `open?.getText() ?? readFileSync(...)`. That is editor-buffer-first logic: it already prefers an open document and falls back to disk. Moving it behind a port would need the port to know about open documents, which makes it a wider abstraction than 'a reader'.

Antithesis: lint/boundaries.mjs restricts only the write-side names of node:fs (`importNames: ["default", "promises", ...FS_WRITES]`). Banning read imports from features would make about seven files fail at once. Under the repo's own ratchet that means seven new suppressions or a rewrite, so 'medium risk' understates it.

Antithesis: The thesis does not weigh the cost against the benefit. These are local reads of files inside a local-first extension, with no second storage backend planned.

Counter-evidence:

- [a18](../../lint/boundaries.mjs): "importNames: ["default", "promises", ...FS_WRITES],"
- [a19](../../src/features/projectSetup/projectConfigCommands.ts): "const text = open?.getText() ?? readFileSync(file.fsPath, "utf8");"
- [a20](../../src/features/docs/docsEditHandlers.ts): "const raw = readFileSync(filePath, { encoding: "utf-8" });"
- [a21](../../src/features/cte/commands.ts): "const query = previewSql(readFileSync(cte.compiledPath), cte);"

### 9. Imports in the webview are already checked. webview_panels has its own dependency-cruiser config with a webview-imports-contract-only rule, a lint:imports script that runs it, and its own lint/boundaries.mjs that lets only the request executor post to the host. The root config ignores webview_panels/** because that workspace lints itself. Adding the webview to the root depcruise run would duplicate the rule

Verdict: antithesis. Confidence: high.

I read the webview config, its package.json script and its boundaries file.

Citations:

- [r9a](../../webviews/.dependency-cruiser.cjs): "Outside its own tree, the webview imports only packages and the webview contract, never host code."
- [r9b](../../webviews/package.json): ""lint:imports": "depcruise src --config .dependency-cruiser.cjs --output-type err","
- [r9c](../../webviews/lint/boundaries.mjs): "// Only the request executor posts to the host; every other file sends through its panel's requests module."

Thesis (high): The webview side sits outside the import checker. depcruise is run only on src and packages/webview-contract/src, and the root Oxlint config ignores webview_panels/**, so webview_panels/src is never checked against the host boundary. The webview has its own 518-line oxlint config. Fix: add webview_panels/src to depcruise with a rule that it may import only @fusion-power-user/webview-contract and itself. Enforcement: the depcruise rule, which the existing contract-is-pure rule already models.

Thesis citations:

- [c26](../../package.json): "depcruise src packages/webview-contract/src --config .dependency-cruiser.cjs"
- [c27](../../oxlint.config.ts): ""packages/*/dist/**", "webview_panels/**", "src/test/fixtures/**","

Antithesis: This point is wrong. webview_panels has its own .dependency-cruiser.cjs, with a rule webview-imports-contract-only that forbids imports leaving the webview tree except the webview contract and node_modules. webview_panels/package.json has a `lint:imports` script that runs it, and the root justfile and webview_panels/justfile call it. The thesis looked only at the root `package.json` script and the root Oxlint ignore list.

Antithesis: The webview also has its own lint boundary module: webview_panels/lint/boundaries.mjs restricts imports of the `@vscodeApi` module and posting from anywhere but the request executor, with a shared vendor-name list imported from the root. The webview boundary is enforced twice.

Antithesis: The proposed 'add webview_panels/src to the root depcruise' would duplicate a rule that already exists and would need the root config to understand the webview's tsconfig paths (@modules, @uicore, @vscodeApi). That is why the separate config exists.

Antithesis: The thesis cites the root package.json depcruise command and the root oxlint ignore of `webview_panels/**` as proof that the webview is unchecked. Both are consistent with a separate workspace config. The root ignores it because the webview lints itself.

Counter-evidence:

- [a22](../../webviews/.dependency-cruiser.cjs): "name: "webview-imports-contract-only","
- [a23](../../webviews/package.json): ""lint:imports": "depcruise src --config .dependency-cruiser.cjs --output-type err""
- [a24](../../webviews/lint/boundaries.mjs): "// Only the request executor posts to the host; every other file sends through its panel's requests module."

### 10. The thesis counts are right: 1234 host suppressions. The gate it asks for already exists, though. ceilings.json records the totals, ratchet.mjs fails when a ceiling loosens, CI compares the ceilings against the PR base, and AGENTS.md documents that `just lint-ratchet` fails when a count rises. The work left is to pay the debt down, for example the 233 parameter-properties suppressions, not to build more gating

Verdict: antithesis. Confidence: high.

I read ceilings.json, the ratchet.mjs header, the CI workflow step and AGENTS.md.

Citations:

- [r10a](../../scripts/quality/ceilings.json): ""oxlintSuppressions.host": 1234,"
- [r10b](../../scripts/quality/ratchet.mjs): "fail when ceilings.json loosens a key relative to <file>"
- [r10c](../../.github/workflows/check-and-package.yml): "Compare ratchet ceilings with the base branch"
- [r10d](../../AGENTS.md): "`just lint-ratchet` fails when a count rises."

Thesis (high): Rule enforcement is a ratchet, not a gate. Oxlint's rules are errors, yet oxlint-suppressions.json covers 370 files with 1234 suppressed violations, including 113 max-params, 233 typescript/parameter-properties and 23 max-lines-per-function. The ratchet keeps new code clean only if the counts never grow. Fix: a CI check that fails when any suppression count rises, and a script that shrinks the file as items are fixed. Principle: enforce the rule where it is cheap and track the debt by count.

Thesis citations:

- [c28](../../oxlint-suppressions.json): ""src/dbtPowerUserExtension.ts": {"

Antithesis: The recommended fix, 'a CI check that fails when any suppression count rises, and a script that shrinks the file', already exists. scripts/quality/ratchet.mjs compares measured values with scripts/quality/ceilings.json. ceilings.json holds `oxlintSuppressions.host: 1234`, the same total the thesis found. The CI workflow compares ceilings against the PR base. The ratchet is a fail-on-loosen gate with an explicit `Ratchet-Loosen` commit trailer. `just lint-prune` shrinks the baseline.

Antithesis: The thesis's own counts are right (370 files, 1234 suppressions). Reporting them as an unprotected debt, with 'Rule enforcement is a ratchet, not a gate' as the headline, misses that the ratchet is itself enforced in CI.

Antithesis: The ratchet also tracks webview suppressions, coverage floors, bundle sizes and TS flags. The thesis names none of this.

Antithesis: The thesis cites only the per-file suppression entry for dbtPowerUserExtension.ts as evidence that the count is unenforced. That file entry is one of the baselines the ratchet totals.

Counter-evidence:

- [a25](../../scripts/quality/ceilings.json): ""oxlintSuppressions.host": 1234,"
- [a26](../../scripts/quality/ratchet.mjs): "fail when ceilings.json loosens a key relative to <file>"
- [a27](../../AGENTS.md): "`just lint-ratchet` fails when a count rises."

### 11. Keep the four seams the thesis lists: the exhaustive Handlers map in messageRouter, the shared lint/boundaries.mjs, the injected `exists` in dbtProjectFile, and the shared webview requestExecutor. Add to that list the suppression ratchet, the webview's own depcruise config, ParseDemand.follow, and ProjectOptions together with the test harness. The list itself holds. It is incomplete, and it conflicts with the thesis's own point 7 proposal

Verdict: middle. Confidence: high.

I confirmed the messageRouter comment and the extra seams named by the antithesis (see points 3, 6, 9 and 10).

Citations:

- [r11a](../../src/webview/messageRouter.ts): "One handler per command of `M`; a missing or extra command is a compile error."
- [r11b](../../src/test/projectHarness.ts): "Builds a `Project` with inert collaborators; `overrides` replaces any of them."

Thesis (high): Keep these seams. (a) messageRouter's Handlers type maps every command to one handler, so a missing or extra command is a compile error. (b) lint/boundaries.mjs is one list that both ESLint and Oxlint read. (c) dbtProjectFile returns a discriminated union and takes an injected exists function. (d) All three webview request modules share one requestExecutor. Changing these would add indirection without removing a real duplicate.

Thesis citations:

- [c29](../../src/webview/messageRouter.ts): "One handler per command of `M`; a missing or extra command is a compile error."
- [c30](../../lint/boundaries.mjs): "// Boundary lists shared by the root ESLint config and the root Oxlint config (O1)."
- [c31](../../webviews/src/modules/lineage/requests.ts): "import { panelRequests } from "@modules/app/requestExecutor";"

Antithesis: The list of seams to keep is useful but it is built on the same incomplete view of the tooling. It leaves out the seams that make the other recommendations unnecessary: the ratchet (point 10), the webview's own depcruise config (point 9), ParseDemand.follow (point 6), and Project's ProjectOptions with its test harness (point 3).

Antithesis: The thesis keeps dbtProjectFile's `exists` seam as exemplary and then, in point 7, proposes forbidding node:fs in core with an allowlist. The two recommendations pull against each other.

Counter-evidence:

- [a28](../../src/test/projectHarness.ts): "Builds a `Project` with inert collaborators; `overrides` replaces any of them."

### 12. Keeping documentationTreeview and modelTreeviewProvider apart is correct, but the overlap that was measured is mostly imports, so it proves little either way. The more interesting module is modelTreeviewProvider.ts: 339 lines holding an abstract ModelTreeviewProvider plus small Node and NodeTreeItem subclass families. The many tiny subclasses are cheap tag types, and splitting the file would be cosmetic. Leave it unless a new node kind adds conditionals to the base

Verdict: middle. Confidence: medium.

I read the class list and line count. I found no defect in the hierarchy itself. Metz's warning about the wrong abstraction supports leaving it as it is.

Citations:

- [r12a](../../src/features/modelTree/modelTreeviewProvider.ts): "abstract class ModelTreeviewProvider"
- [r12b](../../src/features/modelTree/modelTreeviewProvider.ts): "class NodeTreeItem extends TreeItem {"
- [r12c](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction): "duplication is far cheaper than the wrong abstraction"

Thesis (medium): Keep the tree-view pair apart. documentationTreeview.ts and modelTreeviewProvider.ts share about four six-line windows, mostly imports and the refreshOnProjectChange call that is already extracted to treeSupport. Sandi Metz's point applies: a shared class that serves two diverging tree views would need flags, so the wrong abstraction would cost more than the duplicate. Keep the current split and extract only the helper that already exists.

Thesis citations:

- [c32](../../src/features/modelTree/documentationTreeview.ts): "lookupModelByEditorContent,"
- [c33](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction): "Programmer B feels honor-bound to retain the existing abstraction"

Antithesis: The thesis cites a Metz quote about 'Programmer B', but the claim it supports is a measurement (about four six-line windows). The windows are mostly imports, so the finding has no weight in either direction. It is filler rather than a keep-it-apart justification.

Antithesis: modelTreeviewProvider.ts already has a shared abstract base (ModelTreeviewProvider) with three subclasses (ModelTestTreeview, ParentModelTreeview, ChildrenModelTreeview). The question the thesis should have asked is about that hierarchy: 339 lines holding ten or more Node and TreeItem subclasses in one file. The thesis reports only the imports that overlap with documentationTreeview.ts.

Counter-evidence:

- [a29](../../src/features/modelTree/modelTreeviewProvider.ts): "abstract class ModelTreeviewProvider"

### 13. Keep compositionRoot.ts as a single readable wiring file. The plan's rule is 'plain constructors, one place, no container', and nobody showed what is hard to change in the file today. A narrow read port of Project for features cannot be enforced by depcruise, which sees modules and not members, or by ast-grep, which has no type information. Without a rule it would only be a convention. If coupling from features to Project becomes a problem, a TypeScript interface that each feature takes as its constructor type is the mechanism that can be enforced

Verdict: antithesis. Confidence: medium.

I confirmed the plan quotes. The 417-line size is unproblematic on its own terms. The point that depcruise cannot express a member-level port is conceded by both sides.

Citations:

- [r13a](../refactor/rearchitecture-plan.md): "plain constructors, one place, no container"
- [r13b](../refactor/rearchitecture-plan.md): "A layer with one implementation and no second planned is merged into its caller."

Thesis (medium): compositionRoot.ts is the single place for wiring (417 lines, about 61 cross-folder imports), and the plan says plain constructors, no container. Splitting it into per-layer composers (projects, fusion, features) that each return a typed graph, as ProjectsGraph already does, keeps the one-place rule while lowering fan-out. Features depend heavily on Project: features to projects is 100 import edges, against 80 to vscode. A narrow read port for features would reduce coupling. Enforcement: a depcruise rule can restrict folders but not named imports, so the port would need an ast-grep rule or a lint rule.

Thesis citations:

- [c34](../../src/compositionRoot.ts): "The composed graph: the extension plus the collaborators tests inspect."
- [c35](../../src/compositionRoot.ts): "interface ProjectsGraph {"
- [c36](../refactor/rearchitecture-plan.md): "plain constructors, one place, no container"
- [c37](https://ast-grep.github.io/guide/rule-config.html): "Rules are like CSS selectors that can compose together to filter AST nodes based on certain criteria."

Antithesis: The call to split compositionRoot.ts into per-layer composers is asserted without a measurement of what is hard today. The file is 417 lines. Splitting it adds files that each need a graph type, while the plan says 'plain constructors, one place, no container'. A single readable file is the thing that rule protects.

Antithesis: The 'narrow read port for features' needs a rule, and the thesis concedes depcruise cannot express it. Without the rule it is a convention. No named place shows a feature harmed by seeing all of Project, so the value is speculative.

Antithesis: The ast-grep citation is only about the tool's rule syntax. It does not show that an ast-grep rule can express 'which Project members a feature may call'. That needs type information, which ast-grep does not have.

Counter-evidence:

- [a30](../refactor/rearchitecture-plan.md): "A layer with one implementation and no second planned is merged into its caller."

### 14. This one is done. getConfiguration appears only in src/settings/index.ts (8 occurrences, all outside tests), down from the 12 files the plan recorded. The SETTINGS_NAMES restriction in lint/boundaries.mjs keeps it that way

Verdict: thesis. Confidence: high.

A grep over the non-test files in src shows only src/settings/index.ts. The antithesis adds the rule that enforces this, and that addition is reflected here.

Citations:

- [r14a](../../lint/boundaries.mjs): "export const SETTINGS_NAMES = "/^(getConfiguration|onDidChangeConfiguration)$/";"
- [r14b](../refactor/rearchitecture-plan.md): "`getConfiguration` is called in 12 non-test files"

Thesis (high): Verified done: the plan's first rule, one source of truth for configuration, now holds. The plan counted getConfiguration in 12 non-test files, and the current tree calls it only in src/settings/index.ts, which has 27 in-edges. Settings is the only module that reads configuration, as the plan requires. The depcruise check passes with 0 violations across 213 modules.

Thesis citations:

- [c38](../../src/settings/index.ts): "return workspace.getConfiguration(CONFIGURATION_SECTION).update(key, value);"
- [c39](../refactor/rearchitecture-plan.md): "`getConfiguration` is called in 12 non-test files"

Antithesis: This finding is correct. The only getConfiguration calls under src (excluding tests) are in src/settings/index.ts. It is presented as a 'verified done' but is not tied to a rule that keeps it true. The enforcement is lint/boundaries.mjs (SETTINGS_NAMES), which the thesis does not connect to it in this point.

Counter-evidence:

- [a31](../../lint/boundaries.mjs): "export const SETTINGS_NAMES = "/^(getConfiguration|onDidChangeConfiguration)$/";"

### 15. Most of the caveats hold. There is no sgconfig.yml and no .ast-grep directory, so any recommendation that depends on ast-grep is aspirational. webview_panels uses React 19 and has no Redux. I re-ran the depcruise numbers: 'no dependency violations found (213 modules, 1135 dependencies cruised)'. The caveats missed the bigger error in point 9 and the existing ratchet in point 10. I did not run tsc, the tests or oxlint

Verdict: middle. Confidence: high.

I ran depcruise, and ls confirmed there is no sgconfig.yml or .ast-grep. A grep of webview_panels/package.json shows React 19 dependencies and no Redux entry.

Citations:

- [r15a](../../webviews/package.json): ""react": "^19.3.0", "react-dom": "^19.3.0", "react-error-boundary": "^6.1.6""

Thesis (high): Caveats. I did not run tests, tsc, oxlint or eslint. There is no sgconfig file, so the ast-grep rules are not yet in the tree. The docs/research host audit is stale: it cites src/webview_provider, which does not exist. The brief mentions Redux Toolkit, but webview_panels/package.json has no Redux dependency and uses React 19 with Vite; state uses a custom typed reducer. Treat the plan's counts as history and re-measure before acting.

Thesis citations:

- [c40](../../webviews/package.json): ""react": "^19.3.0", "react-dom": "^19.3.0""

Antithesis: The caveats admit that nothing was run. That undermines the 'measured state' in the summary. The thesis states 'depcruise passes with 0 violations over 213 modules and 1135 dependencies' and also 'I did not run tests, tsc or lint'. I could not tell from the thesis which numbers came from a run.

Antithesis: The thesis says there is no sgconfig file, so ast-grep rules are not in the tree. That is true: I found no sgconfig.yml and no rules directory. But four of its recommendations (points 3, 5, 13 and the ban rule in 8) rely on ast-grep rules that do not exist yet, with no check that ast-grep can express them.

Antithesis: The thesis states 'webview_panels/package.json has no Redux dependency'. That is correct. It is a useful correction of the brief, but it comes alongside the false claim in point 9 that the webview has no import checking, so the 'caveats' section did not catch the larger error.

### 16. The clearest misuse of inheritance in the repo is the Project chain: Project extends ProjectDbtCommands, which extends ProjectQueries. The two abstract bases declare abstract members that the leaf class fills in, so the inheritance mainly splits one class across three files (470 + 67 + 126 lines). ProjectDbtCommands is mostly one-line delegations to this.tasks. Composing instead, by exposing the task and query objects or making them plain modules that take what they need, would delete the pass-through methods and the abstract-member protocol. Value is medium and risk is medium, because callers of project.runModel and similar methods would change. A lint or ast-grep rule against `abstract class X extends` under src/projects could keep the chain from coming back

Verdict: new. Confidence: medium.

I read the extends declarations and the delegation methods. I did not count the callers of the delegating methods, so the size of the change is not measured.

Citations:

- [r16a](../../src/projects/project/projectDbtCommands.ts): "export abstract class ProjectDbtCommands extends ProjectQueries {"
- [r16b](../../src/projects/project/projectDbtCommands.ts): "return this.tasks.runModel(params);"
- [r16c](../../src/projects/project/projectQueries.ts): "export abstract class ProjectQueries implements WarehouseProject {"

### 17. Use dependency-cruiser's native features before writing custom rules. An `allowed` section catches new top-level folders that no layer covers. numberOfDependentsMoreThan sets a mechanical fan-in ceiling on hub modules such as settings/index.ts and project.ts, which turns 'god module' from a judgement into a ratcheted number. Today the config uses only `forbidden`

Verdict: new. Confidence: medium.

I read the rules reference, and grep found no `allowed:` section in the config. I have not tested how such rules behave against this tree.

Citations:

- [r17a](https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/doc/rules-reference.md): "Matches when the number of dependents of a module is more than the provided number."

### 18. The repo's own rule ('an abstraction is introduced only with its second user or a named test seam') is the right filter for this whole list. Applied consistently, it rejects the docParser reader port, the feature reader port, the Project collaborator factory, and splitting the composition root. It keeps the narrow work: one manifest shape in core, domain.ts under the purity rule, the Project inheritance chain flattened, and possibly an inbound message funnel

Verdict: new. Confidence: medium.

The quote comes from the plan. The filter itself is a synthesis of the rulings above.

Citations:

- [r18a](../refactor/rearchitecture-plan.md): "A layer with one implementation and no second planned is merged into its caller. An abstraction is introduced only with its second user or a named test seam."

## Alternatives the thesis missed

The biggest inheritance problem is not PanelHost. It is the Project chain: Project extends ProjectDbtCommands, which extends ProjectQueries. Both bases are abstract classes that declare abstract members (`tasks`, `withRunResults`, `projectRoot`, `terminal`, `sharedState`, `lsp`, `manifest`, `getFusionCli`) which the leaf class fulfils. ProjectDbtCommands is 67 lines of one-line delegations to `this.tasks`. The inheritance is a way to split one class across files. Composition would expose `project.tasks` and `project.queries` directly and remove the pass-through methods. Enforcement: an Oxlint rule or ast-grep rule limiting `extends` depth for project classes, plus tests that already use RecordingTasks (which itself extends ProjectTasks) as the substitution point.

- [m01](../../src/projects/project/projectDbtCommands.ts): "export abstract class ProjectDbtCommands extends ProjectQueries {"
- [m02](../../src/projects/project/projectQueries.ts): "export abstract class ProjectQueries implements WarehouseProject {"
- [m03](../../src/projects/project/project.ts): "extends ProjectDbtCommands"

Use dependency-cruiser's `allowed` whitelist, or its `numberOfDependentsMoreThan` condition, to catch new unclassified folders and fan-in hot spots. This does what the thesis's custom 'unlisted folder' rule would do, and the repo currently uses only `forbidden` rules. It also covers the dbt_integration gap with one entry, and `numberOfDependentsMoreThan` provides a mechanical fan-in ceiling for hub modules such as Project and settings/index.ts.

- [m04](https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/doc/rules-reference.md): "Matches when the number of dependents of a module is more than the provided number."

Extend the existing pure-modules-stay-pure rule to cover src/dbt_integration/domain.ts. This closes the real gap in point 2 with one edit and no folder move. Add a type-level guard for the duplicate in point 1: make mergeMetadata take `Pick<ParsedManifest, ...>` where the shared type is visible, or keep the structural type and accept the duplication.

- [m05](../../.dependency-cruiser.cjs): "name: "pure-modules-stay-pure","

Treat the repo's own plan rule as the filter for every refactor in the thesis: an abstraction needs a second user or a named test seam. Applied honestly, this rejects the docParser reader port (point 7), the projects-owned reader port (point 8) and the Project collaborator factory (point 3), and keeps only changes that remove a present cost. The better-value work is then the narrower one: add domain.ts to the purity rule, collapse the ProjectDbtCommands/ProjectQueries inheritance chain, and decide whether the inbound-message funnel (the three onDidReceiveMessage sites) is worth building at all.

- [m06](../refactor/rearchitecture-plan.md): "An abstraction is introduced only with its second user or a named test seam."

## Open questions

- How many call sites use Project's delegating methods (runModel, buildModel and the rest), and would exposing the task and query objects increase how much of Project each feature depends on?
- Do any of the seven feature-side file reads parse a project fact (dbt_project.yml, manifest paths) that projects/ already owns? That is the plan's 'one fact in several places' defect, and it would justify a narrow fix.
- Would a numberOfDependentsMoreThan ceiling flag project.ts or settings/index.ts today, and at what threshold?
- Does any other depcruise rule, such as lower-layers-skip-webview, already constrain src/dbt_integration/domain.ts's imports, so that the purity-rule edit only adds documentation?
- Can ast-grep express the proposed bans (onDidReceiveMessage outside src/webview, extends chains in src/projects) without false positives in tests? No sgconfig exists yet to check this.
- Would the tsc, unit-test and oxlint runs, which were not executed here, confirm the suppression counts and show regressions after each proposed change?

## Rejected citations

None.
