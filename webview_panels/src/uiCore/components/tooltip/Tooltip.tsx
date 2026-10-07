import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "../../anchoredPosition";
import classes from "./tooltip.module.css";

interface Props {
  children: ReactNode;
  /** Shown while the pointer or focus is on the children; hovering it keeps it open, so it may hold links. */
  title?: ReactNode | undefined;
  className?: string | undefined;
}

const Tooltip = ({ children, title, className }: Props): JSX.Element => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  useAnchoredPosition(open, anchorRef, bubbleRef, "center");

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!title) {
    return <>{children}</>;
  }
  return (
    <span
      ref={anchorRef}
      className={classes.anchor}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={(event) => {
        if (!bubbleRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        // Focus moving to another control inside the anchor keeps the tooltip open.
        if (!anchorRef.current?.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      {children}
      {open
        ? createPortal(
            <span
              id={id}
              ref={bubbleRef}
              role="tooltip"
              className={`${classes.bubble} ${className ?? ""}`}
              onMouseLeave={(event) => {
                if (
                  !anchorRef.current?.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  setOpen(false);
                }
              }}
            >
              {title}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
};

export default Tooltip;
