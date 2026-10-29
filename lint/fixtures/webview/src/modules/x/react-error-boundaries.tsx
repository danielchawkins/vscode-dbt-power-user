// lint-expect: oxlint react/error-boundaries
import type { ReactElement } from "react";
export function B(): ReactElement | null {
  try {
    return <div />;
  } catch {
    return null;
  }
}
