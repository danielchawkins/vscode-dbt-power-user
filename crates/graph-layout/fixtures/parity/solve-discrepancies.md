# Solver parity: discrepancies from TypeScript

Source of the reference outputs: `scripts/parity/print-fixtures.mjs solve-cases` and `solve-random`, which run
`solveSeparations` from `packages/graph-layout/src/solve/vpsc.ts` (Node v20.20.2).

Checked by `crates/graph-layout/src/solve_checks.rs`:

- **MSAGL cases** (`solve-cases.txt`, 20 cases): positions within 1e-4 of MSAGL, goals within 5e-7 of MSAGL.
  Bit-identical to TypeScript: **20 of 20**.
- **Random problems** (`solve-random.txt`, 2,000 seeds): every separation holds within 1e-7; objective within
  1e-12 relative of TypeScript's. Bit-identical to TypeScript: **2,000 of 2,000**.

Discrepancies: **none**. No seed differs from TypeScript in any bit, so there are no rows to list.

The check counts the differences and lists their seeds on every run. This report must be regenerated if that list is
ever non-empty.
