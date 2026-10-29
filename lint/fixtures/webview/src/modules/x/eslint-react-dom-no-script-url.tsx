// lint-expect: eslint @eslint-react/dom-no-script-url
export const Link = () => <a href="javascript:void(0)">x</a>;
