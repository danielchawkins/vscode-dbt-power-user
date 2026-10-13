// lint-expect: eslint @eslint-react/dom-no-render
import { render } from "react-dom";
export const run = () => render(null, document.body);
