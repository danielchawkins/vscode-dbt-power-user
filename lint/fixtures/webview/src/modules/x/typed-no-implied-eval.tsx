// lint-expect: oxlint typescript/no-implied-eval
export const t = () => setTimeout("x = 1", 0);
