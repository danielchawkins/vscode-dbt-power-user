// lint-expect: eslint @eslint-react/no-context-provider
import { createContext } from "react";
const ThemeContext = createContext(0);
export const P = () => <ThemeContext.Provider value={1} />;
