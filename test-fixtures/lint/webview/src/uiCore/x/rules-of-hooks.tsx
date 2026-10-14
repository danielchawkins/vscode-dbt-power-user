// lint-expect: oxlint react/rules-of-hooks
import { useState } from "react";
export function useToggle(): boolean {
  if (Math.random() > 0.5) {
    useState(0);
  }
  return false;
}
