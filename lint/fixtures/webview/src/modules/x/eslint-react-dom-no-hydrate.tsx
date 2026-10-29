// lint-expect: eslint @eslint-react/dom-no-hydrate
import { hydrate } from "react-dom";
export const run = () => hydrate(null, document.body);
