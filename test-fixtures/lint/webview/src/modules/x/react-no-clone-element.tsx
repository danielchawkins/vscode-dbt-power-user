// lint-expect: oxlint react/no-clone-element
import { cloneElement, type ReactElement } from "react";
export const c = (el: ReactElement) => cloneElement(el);
