// lint-expect: eslint @eslint-react/web-api-no-leaked-resize-observer
import { useEffect } from "react";
export const useSize = () => {
  useEffect(() => {
    new ResizeObserver(() => undefined).observe(document.body);
  }, []);
};
