import { ChevronRightIcon } from "@assets/icons";
import {
  forwardRef,
  ForwardRefRenderFunction,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import IconButton from "../iconButton/IconButton";
import classes from "./styles.module.css";

interface Props {
  title?: string | undefined;
  /** Called when the user closes the drawer; `DrawerRef.close` does not call it. */
  onClose?: (() => void) | undefined;
  children: ReactNode;
  /** A backdrop that closes the drawer on click; without it the page stays usable. */
  backdrop?: boolean | undefined;
}

export interface DrawerRef {
  close: () => void;
  open: () => void;
}

/** A panel on the right edge; its children mount only while it is open. Escape closes it. */
const Drawer: ForwardRefRenderFunction<DrawerRef, Props> = (
  { title, onClose, children, backdrop = true },
  ref,
) => {
  const [show, setShow] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  const handleClose = useCallback(() => {
    setShow(false);
    onClose?.();
  }, [onClose]);

  useImperativeHandle(ref, () => ({
    close() {
      setShow(false);
    },
    open() {
      setShow(true);
    },
  }));

  useEffect(() => {
    if (!show) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show, handleClose]);

  useEffect(() => {
    if (!show) {
      return;
    }
    returnFocusRef.current = document.activeElement;
    drawerRef.current
      ?.querySelector<HTMLElement>("button, [href], input, select, textarea")
      ?.focus();
    return () => {
      if (returnFocusRef.current instanceof HTMLElement) {
        returnFocusRef.current.focus();
      }
    };
  }, [show]);

  if (!show) {
    return null;
  }
  return (
    <>
      {backdrop ? (
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          className={classes.backdrop}
          onClick={handleClose}
        />
      ) : null}
      <aside ref={drawerRef} aria-label={title} className={classes.drawer}>
        <IconButton
          color="primary"
          title="Close"
          onClick={handleClose}
          className={classes.closeBtn}
        >
          <ChevronRightIcon />
        </IconButton>
        {title ? <h2 className={classes.title}>{title}</h2> : null}
        <div className={classes.body}>{children}</div>
      </aside>
    </>
  );
};

export default forwardRef(Drawer);
