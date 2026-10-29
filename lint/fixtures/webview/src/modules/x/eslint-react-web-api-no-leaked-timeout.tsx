// lint-expect: eslint @eslint-react/web-api-no-leaked-timeout
import { useEffect } from "react";
export const useLater = () => {
  useEffect(() => {
    setTimeout(() => undefined, 10);
  }, []);
};
