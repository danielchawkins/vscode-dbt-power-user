import { ForwardedRef, forwardRef, InputHTMLAttributes } from "react";
import { cx } from "../../classNames";

const Input = forwardRef(function input(
  { className, ...rest }: InputHTMLAttributes<HTMLInputElement>,
  ref: ForwardedRef<HTMLInputElement>,
): JSX.Element {
  return (
    <input {...rest} ref={ref} className={cx("form-control", className)} />
  );
});

export default Input;
