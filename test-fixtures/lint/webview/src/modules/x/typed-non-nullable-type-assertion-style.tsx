// lint-expect: oxlint typescript/non-nullable-type-assertion-style
export const v = (a: string | null) => a as string;
