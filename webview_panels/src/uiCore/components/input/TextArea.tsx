import { Ref, TextareaHTMLAttributes } from "react";
import { cx } from "../../classNames";

const TextArea = ({
  className,
  ref,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement> | undefined;
}): React.JSX.Element => {
  return (
    <textarea {...rest} ref={ref} className={cx("form-control", className)} />
  );
};

export default TextArea;
