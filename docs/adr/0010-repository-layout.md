# Lay out the repository by consumer

**Status:** Decided 2026-10-28.

## Context

Top-level directories were placed case by case. `test-fixtures/` collected three unrelated consumers, and the VSIX shipped contributor Docker tooling because packaging used a denylist. A reader could not tell from the tree what ships, what is a library, and what is tooling.

## Decision

Each top-level directory has one consumer:

| Path                               | Holds                                                                         | Consumer                                               |
| ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `src/`                             | The extension host and its tests                                              | The extension bundle (rsbuild) and Vitest              |
| `webview_panels/`                  | The React webview app                                                         | Vite, which emits into `dist/webview/`                 |
| `packages/`                        | Host-side TypeScript libraries                                                | `tsc -b`                                               |
| `media/`, `syntaxes/`, `snippets/` | Assets that `package.json` contributes                                        | VS Code, at runtime                                    |
| `dist/`                            | Build output, not tracked                                                     | The VSIX                                               |
| `scripts/`                         | Tooling that Just and CI run, plus research harnesses with their own fixtures | Contributors and CI                                    |
| `lint/`                            | Lint glue shared by the Oxlint and ESLint configs, and its must-fire fixtures | The lint configs and their tests                       |
| `ast-grep/`                        | ast-grep rules and rule tests                                                 | `sgconfig.yml`                                         |
| `docker/`                          | Contributor images, each with a `Dockerfile.dockerignore` beside it           | `just smoke-docker` and `just test-integration-docker` |
| `docs/`                            | ADRs, plans, research and architecture                                        | Readers                                                |

- The root package is the extension, in the layout VS Code documents. The webview app stays at the root rather than under `packages/`, because every `packages/*` glob here means a library built by `tsc -b`.
- The VSIX is an allowlist: `package.json` `files` names build output and contributed assets, and `just package` fails on any other entry. Shipped code builds runtime paths under `dist/`, never under a source directory (`ts-runtime-paths-not-source-dirs`).
- A fixture lives beside its only consumer. The extension's dbt projects are under `src/test/fixtures/`.
- Root config files stay where each tool discovers them. The `.git-dotfiles`, `.workspace-dotfiles` and `.typescript-dotfiles` anchors group them in the Explorer (`.vscode/settings.json`).

## Consequences

- A new top-level directory or root file is a visible change: `rootLayout.test.ts` lists both, and a config glob that matches nothing fails `configPaths.test.ts`.
- A new runtime asset ships only once `files` names it; the panel smoke catches an omission.
