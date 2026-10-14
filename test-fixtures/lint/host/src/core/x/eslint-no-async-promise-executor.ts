// lint-expect: oxlint eslint/no-async-promise-executor
export const p = new Promise(async (resolve) => resolve(1));
