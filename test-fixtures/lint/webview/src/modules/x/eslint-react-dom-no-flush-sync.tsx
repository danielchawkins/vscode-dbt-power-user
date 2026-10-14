// lint-expect: eslint @eslint-react/dom-no-flush-sync
import { flushSync } from "react-dom";
export const run = () => flushSync(() => undefined);
