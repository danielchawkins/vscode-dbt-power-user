// lint-expect: oxlint jsx_a11y/mouse-events-have-key-events
export const d = () => <div onMouseOver={() => undefined} />;
