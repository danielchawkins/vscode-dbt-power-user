# Solver parity: discrepancies from TypeScript

Source of the reference outputs: `scripts/parity/print-fixtures.mjs solve-cases` and `solve-random`, which run
`solveSeparations` from `packages/graph-layout/src/solve/vpsc.ts` on Node v24.18.1 (the repository's pin). Every
TypeScript output is stored as the hex of its IEEE 754 bits, so -0 and every ulp are kept.

## What is compared, and how

- **MSAGL cases** (`solve-cases.txt`, 20 cases): positions within 1e-4 of MSAGL, goals within 5e-7 of MSAGL, and
  bit-identical to TypeScript (`to_bits`): **20 of 20**.
- **Random problems** (`solve-random.txt`, 2,000 seeds): every separation holds within 1e-7; objective within 1e-12
  relative of TypeScript's; bit-identical to TypeScript (`to_bits`): **2,000 of 2,000**.
- **Native against WebAssembly**: the core's whole test suite runs under `wasm32-wasip1` on Node's WASI
  (`scripts/quality/wasi-run.mjs`). Each run writes its 2,000 random outputs as bits, and
  `scripts/parity/compare-solve.mjs` compares the two files byte for byte: **2,000 of 2,000 identical**.
- **Finance placement solves** (`record-finance-solves.mjs` on `finance_general/target/manifest.json`): the TypeScript
  layout makes 102 solves (fast 1, balanced 101), none of them with zero variables and none throwing. Every separation
  holds, and every output is bit-identical to TypeScript: **102 of 102**, 0 values differ.
  The counts come from the dump at the time it is taken: the manifest's dump has 1,126 nodes and 1,273 edges (`financeGraph`, one edge per parent-child pair) at the Phase 2 and 3 dumps, and 1,127 and 1,291 at the Phase 4 dump; the plan's earlier figures (1,122 and 1,241) describe an earlier export.

## Discrepancies

- **Problem with no variables (`n = 0`).** Rust returns an empty slice. TypeScript throws
  `separation projection did not converge within its operation budget`. Neither language produces a numeric result,
  and no placement solve in the finance graph is empty. Rust's behaviour is documented on `Projector::solve`.

This is the only known difference. The Rust behaviour is documented on `Projector::solve`. No numeric difference
exists: no MSAGL case, no random problem, no finance solve and no native-or-WebAssembly output differs in any bit.
The check counts differences and lists their seeds on every run; this report must be regenerated if that list is
ever non-empty.
