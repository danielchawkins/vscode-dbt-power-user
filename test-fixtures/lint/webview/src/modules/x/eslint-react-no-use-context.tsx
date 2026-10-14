// lint-expect: eslint @eslint-react/no-use-context
import { createContext, useContext } from "react";
const ThemeContext = createContext(0);
export const useTheme = () => useContext(ThemeContext);
