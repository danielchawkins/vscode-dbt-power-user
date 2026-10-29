// lint-expect: eslint @eslint-react/web-api-no-leaked-intersection-observer
import { useEffect } from "react";
export const useSeen = () => {
  useEffect(() => {
    new IntersectionObserver(() => undefined).observe(document.body);
  }, []);
};
