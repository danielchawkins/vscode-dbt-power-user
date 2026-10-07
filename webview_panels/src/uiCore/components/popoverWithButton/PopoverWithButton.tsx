import {
  ReactNode,
  Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "../../anchoredPosition";
import styles from "./styles.module.css";

interface Props {
  button: ReactNode;
  title?: string | ReactNode | undefined;
  width?: number | string | undefined;
  children: (args: {
    styles: CSSModuleClasses;
    close: () => void;
  }) => ReactNode;
  ref?: Ref<PopoverWithButtonRef> | undefined;
}

export interface PopoverWithButtonRef {
  close: () => void;
  open: () => void;
}

/** A panel below `button`, opened by clicking it and closed by a click anywhere outside. */
const PopoverWithButton = ({
  title,
  button,
  children,
  width = 350,
  ref,
}: Props): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  useAnchoredPosition(open, rootRef, popoverRef, "end");

  useImperativeHandle(ref, () => ({
    close() {
      setOpen(false);
    },
    open() {
      setOpen(true);
    },
  }));

  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseUp = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLElement>("button, [href]")?.focus();
      }
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      popoverRef.current
        ?.querySelector<HTMLElement>(
          "input, textarea, select, button, [href], [tabindex]:not([tabindex='-1'])",
        )
        ?.focus();
    }
  }, [open]);

  return (
    <span ref={rootRef} className={styles.anchor}>
      {/* eslint-disable-next-line jsx-a11y-x/no-static-element-interactions, jsx-a11y-x/click-events-have-key-events -- child is always an interactive control; wrapper only forwards clicks */}
      <span onClick={() => setOpen(true)}>{button}</span>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              className={styles.popover}
              style={{ width }}
            >
              {title ? <h4>{title}</h4> : null}
              {children({ styles, close: () => setOpen(false) })}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
};

export default PopoverWithButton;
