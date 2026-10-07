import { ButtonHTMLAttributes, ReactNode, useState } from "react";
import { ButtonColor, buttonClassName } from "../../classNames";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  color?: ButtonColor | undefined;
  /** A border in the color instead of a fill. */
  outline?: boolean | undefined;
  /** With an icon, the label shows only on hover unless `showTextAlways` is set. */
  icon?: ReactNode | undefined;
  showTextAlways?: boolean | undefined;
}

export const Button = ({
  color = "secondary",
  outline,
  icon,
  showTextAlways,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps): JSX.Element => {
  const [hovered, setHovered] = useState(false);
  const showText = showTextAlways ?? (!icon || hovered);
  return (
    <button
      {...rest}
      type={type}
      className={buttonClassName(color, outline, className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon}
      {icon && showText ? " " : null}
      {showText ? children : null}
    </button>
  );
};
