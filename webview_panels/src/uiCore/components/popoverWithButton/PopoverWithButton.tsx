import {
  forwardRef,
  ForwardRefRenderFunction,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import styles from "./styles.module.css";

interface Props {
  button: ReactNode;
  title?: string | ReactNode;
  width?: number | string;
  children: (args: {
    styles: CSSModuleClasses;
    close: () => void;
  }) => ReactNode;
}

export interface PopoverWithButtonRef {
  close: () => void;
  open: () => void;
}

/** A panel below `button`, opened by clicking it and closed by a click anywhere outside. */
const PopoverWithButton: ForwardRefRenderFunction<
  PopoverWithButtonRef,
  Props
> = ({ title, button, children, width = 350 }, ref) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

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
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [open]);

  return (
    <span ref={rootRef} className={styles.anchor}>
      {/* eslint-disable-next-line jsx-a11y-x/no-static-element-interactions, jsx-a11y-x/click-events-have-key-events -- child is always an interactive control; wrapper only forwards clicks */}
      <span onClick={() => setOpen(true)}>{button}</span>
      {open ? (
        <div role="dialog" className={styles.popover} style={{ width }}>
          {title ? <h4>{title}</h4> : null}
          {children({ styles, close: () => setOpen(false) })}
        </div>
      ) : null}
    </span>
  );
};

export default forwardRef(PopoverWithButton);
