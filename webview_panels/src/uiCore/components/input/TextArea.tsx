import { ForwardedRef, forwardRef, TextareaHTMLAttributes } from "react";
import { cx } from "../../classNames";

const TextArea = forwardRef(function textArea(
  { className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>,
  ref: ForwardedRef<HTMLTextAreaElement>,
): JSX.Element {
  return (
    <textarea {...rest} ref={ref} className={cx("form-control", className)} />
  );
});

export default TextArea;
