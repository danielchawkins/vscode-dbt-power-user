import { ReactNode, useState } from "react";
import classes from "./tooltip.module.css";

interface Props {
  children: ReactNode;
  /** Shown while the pointer or focus is on the children; hovering it keeps it open, so it may hold links. */
  title?: ReactNode;
  className?: string;
}

const Tooltip = ({ children, title, className }: Props): JSX.Element => {
  const [open, setOpen] = useState(false);
  if (!title) {
    return <>{children}</>;
  }
  return (
    <span
      className={classes.anchor}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span role="tooltip" className={`${classes.bubble} ${className ?? ""}`}>
          {title}
        </span>
      ) : null}
    </span>
  );
};

export default Tooltip;
