// lint-expect: eslint @eslint-react/dom-no-unsafe-iframe-sandbox
export const Frame = () => (
  <iframe sandbox="allow-scripts allow-same-origin" title="x" />
);
