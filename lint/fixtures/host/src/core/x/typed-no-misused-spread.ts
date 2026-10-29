// lint-expect: oxlint typescript/no-misused-spread
export const o = { ...Promise.resolve(1) };
