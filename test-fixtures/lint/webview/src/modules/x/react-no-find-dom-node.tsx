// lint-expect: oxlint react/no-find-dom-node
import { findDOMNode } from "react-dom";
export const n = (c: object) => findDOMNode(c);
