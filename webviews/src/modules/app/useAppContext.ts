import { use } from "react";
import type { ContextProps } from "./context";
import { AppContext } from "./context";

const useAppContext = (): ContextProps => {
  return use(AppContext);
};

export default useAppContext;
