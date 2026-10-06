export type ButtonColor =
  "primary" | "secondary" | "success" | "warning" | "danger" | "link";

/** Joins the class names that are set. */
export const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(" ");

/** The classes a button of `color` carries; `outline` draws a border in the color instead of a fill. */
export const buttonClassName = (
  color: ButtonColor | undefined,
  outline: boolean | undefined,
  className?: string,
): string =>
  cx(
    "btn",
    color && (outline ? `btn-outline-${color}` : `btn-${color}`),
    className,
  );
