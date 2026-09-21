import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Run a click action when Enter or Space is pressed on a focusable control. */
export function activateClickOnKeyDown(
  event: ReactKeyboardEvent,
  action: () => void,
): void {
  if (event.target !== event.currentTarget) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}
