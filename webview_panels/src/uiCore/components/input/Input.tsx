import { InputHTMLAttributes, Ref } from "react";
import { cx } from "../../classNames";

const Input = ({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element => {
  return (
    <input {...rest} ref={ref} className={cx("form-control", className)} />
  );
};

export default Input;
