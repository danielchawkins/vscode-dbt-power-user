// lint-expect: eslint @eslint-react/web-api-no-leaked-interval
import { useEffect } from "react";
export const useTick = () => {
  useEffect(() => {
    setInterval(() => undefined, 10);
  }, []);
};
