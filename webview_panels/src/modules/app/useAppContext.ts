import { useContext } from "react";
import { AppContext, ContextProps } from "./context";

const useAppContext = (): ContextProps => {
  return useContext(AppContext);
};

export default useAppContext;
