// lint-expect: eslint @eslint-react/no-forward-ref
import { forwardRef } from "react";
export const Input = forwardRef((props, ref) => null);
