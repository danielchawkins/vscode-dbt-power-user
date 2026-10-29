// lint-expect: oxlint jsx_a11y/no-noninteractive-element-interactions
export const d = () => <article onClick={() => undefined} />;
