import {
  cloneElement,
  ReactElement,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
  RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition } from "../../anchoredPosition";
import styles from "./styles.module.css";

interface Props {
  button: ReactElement<ButtonProps>;
  title?: string | ReactNode | undefined;
  width?: number | string | undefined;
  children: (args: {
    styles: CSSModuleClasses;
    close: () => void;
  }) => ReactNode;
  ref?: Ref<PopoverWithButtonRef> | undefined;
}

interface ButtonProps {
  onClick?: (event: ReactMouseEvent<HTMLElement>) => unknown;
}

export interface PopoverWithButtonRef {
  close: () => void;
  open: () => void;
  toggle: () => void;
}

/** The close handler of the popover that is open, so opening another one closes it. */
let openPopoverClose: (() => void) | null = null;

/** While open: close on Escape (focusing the button), on a pointer-down outside, or when another popover opens. */
const useDismiss = (
  open: boolean,
  setOpen: (open: boolean) => void,
  rootRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setOpen(false);
    openPopoverClose?.();
    openPopoverClose = close;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        const trigger = triggerRef.current;
        if (trigger?.isConnected) {
          trigger.focus();
        } else {
          rootRef.current
            ?.querySelector<HTMLElement>("button, [href]")
            ?.focus();
        }
      }
    };
    // Capture, so a handler that stops propagation (the lineage canvas) can't swallow it.
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      if (openPopoverClose === close) {
        openPopoverClose = null;
      }
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen, rootRef, popoverRef, triggerRef]);
};

/**
 * The element that opened the popover, which gets focus back on Escape: the control clicked (recorded in the
 * capture phase, before any open handler runs), else the focused element in the anchor when it opens.
 */
const useTrigger = (open: boolean, rootRef: RefObject<HTMLElement | null>) => {
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) {
      triggerRef.current = null;
      return;
    }
    const active = document.activeElement;
    if (
      !triggerRef.current &&
      active instanceof HTMLElement &&
      rootRef.current?.contains(active)
    ) {
      triggerRef.current = active;
    }
  }, [open, rootRef]);
  return triggerRef;
};

/** A panel below `button`, toggled by clicking it and closed by Escape or a pointer-down outside. */
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
    toggle() {
      setOpen((value) => !value);
    },
  }));

  const triggerRef = useTrigger(open, rootRef);
  useDismiss(open, setOpen, rootRef, popoverRef, triggerRef);

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
    <span
      ref={rootRef}
      className={styles.anchor}
      onClickCapture={(event) => {
        // Runs before the click handlers that open the popover.
        if (!open && event.target instanceof Element) {
          triggerRef.current =
            event.target.closest<HTMLElement>("button, [href]");
        }
      }}
    >
      {/* eslint-disable-next-line @eslint-react/no-clone-element -- aria state and toggle go on the caller's button */}
      {cloneElement(button, {
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        onClick: (event: ReactMouseEvent<HTMLElement>) => {
          button.props.onClick?.(event);
          // A button that stops propagation handles its own opening (via `open`).
          if (!event.isPropagationStopped()) {
            setOpen((value) => !value);
          }
        },
      } as Partial<ButtonProps>)}
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
