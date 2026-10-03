import { ButtonHTMLAttributes } from "react";
import { ButtonColor, buttonClassName } from "../../classNames";
import classes from "./styles.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  color?: ButtonColor;
}

const IconButton = ({
  color,
  className,
  type = "button",
  ...rest
}: Props): JSX.Element => (
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
