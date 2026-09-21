import { HTMLAttributes, ReactNode } from "react";
import classes from "./tag.module.scss";

const Tag = ({
  children,
  color = "default",
  className,
  type = "default",
  onClick,
  ...rest
}: {
  children: ReactNode;
  color?: "primary" | "orange" | "default";
  type?: "rounded" | "default";
} & HTMLAttributes<HTMLSpanElement>): JSX.Element => {
  const classNames = `${className ?? ""} ${classes.tag} ${color === "default" ? "" : color} ${type === "rounded" ? classes.rounded : ""}`;
  if (onClick) {
    return (
      <button type="button" className={classNames} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <span className={classNames} {...rest}>
      {children}
    </span>
  );
};

export default Tag;
