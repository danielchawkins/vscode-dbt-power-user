# Pin contributor tooling with mise and Just

This repository pins its Node runtime, contributor CLIs, and a dbt Fusion binary in `mise.toml` with a committed
`mise.lock`, and exposes every operation through a short root `justfile` whose recipes are facades over the existing
npm scripts. `just check` is the only gate; CI, the Lefthook pre-push hook, and humans all call it. dprint and rumdl
own Markdown so that no file type has two formatters, while ESLint and Prettier keep TypeScript, JavaScript, JSON, and
CSS. Lefthook replaces Husky and lint-staged because staged-file scoping is clearer in one declarative file. These
conveniences are borrowed from the `finance-pipelines` consumer repository, which also supplies the vendored skills
under `.agents/skills/`; its uv, Python, Snowflake, Dagster, and multi-root workspace conventions are deliberately not
imported into a TypeScript extension repository. Pinning Fusion here is a development-environment decision and does not
weaken the product boundary: the shipped extension remains tool-manager-neutral, resolving `dbt` from `PATH` or an
explicit path setting, and neither the extension nor its tests may invoke mise.
