// lint-expect: eslint @eslint-react/dom-no-dangerously-set-innerhtml
export const Html = () => (
  <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />
);
