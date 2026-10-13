// lint-expect: eslint @eslint-react/dom-no-use-form-state
import { useFormState } from "react-dom";
export const useForm = () => useFormState(async () => undefined, null);
