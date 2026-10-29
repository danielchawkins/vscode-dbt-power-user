// lint-expect: eslint @eslint-react/web-api-no-leaked-event-listener
import { useEffect } from "react";
export const useKeys = () => {
  useEffect(() => {
    window.addEventListener("keydown", () => undefined);
  }, []);
};
