import type { ButtonHTMLAttributes } from "react";
import type { ButtonColor } from "../../classNames";
import { buttonClassName } from "../../classNames";
import classes from "./styles.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  color?: ButtonColor | undefined;
}

const IconButton = ({
  color,
  className,
  type = "button",
  ...rest
}: Props): React.JSX.Element => (
  <button
    {...rest}
    type={type}
    className={buttonClassName(
      color,
      false,
      `${className ?? ""} ${classes.iconButton}`,
    )}
  />
);

export default IconButton;
