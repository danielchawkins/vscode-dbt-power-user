// lint-expect: eslint @eslint-react/dom-no-unsafe-target-blank
export const Link = () => (
  <a href="https://example.com" target="_blank">
    x
  </a>
);
