import { use } from "react";
import { AppContext, ContextProps } from "./context";

const useAppContext = (): ContextProps => {
  return use(AppContext);
};

export default useAppContext;
