import { RefObject, useLayoutEffect } from "react";

const MARGIN = 4;

/**
 * Places `floating` (position: fixed) below `anchor`, centred or right-aligned when `align` is "end", clamped
 * to the viewport and flipped above the anchor when it would overflow the bottom. Runs before paint and on
 * resize or scroll while `open`.
 */
export function useAnchoredPosition(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  floating: RefObject<HTMLElement | null>,
  align: "center" | "end",
): void {
  useLayoutEffect(() => {
    const anchorEl = anchor.current;
    const floatingEl = floating.current;
    if (!open || !anchorEl || !floatingEl) {
      return;
    }
    const place = () => {
      const a = anchorEl.getBoundingClientRect();
      const f = floatingEl.getBoundingClientRect();
      const wanted =
        align === "end" ? a.right - f.width : a.left + (a.width - f.width) / 2;
      const left = Math.max(
        MARGIN,
        Math.min(wanted, window.innerWidth - f.width - MARGIN),
      );
      const below = a.bottom + MARGIN;
      const top =
        below + f.height > window.innerHeight
          ? Math.max(MARGIN, a.top - f.height - MARGIN)
          : below;
      floatingEl.style.top = `${top}px`;
      floatingEl.style.left = `${left}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, floating, align]);
}
