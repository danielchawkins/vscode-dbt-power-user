// lint-expect: eslint @eslint-react/dom-no-dangerously-set-innerhtml-with-children
export const Html = () => (
  <div dangerouslySetInnerHTML={{ __html: "x" }}>child</div>
);
