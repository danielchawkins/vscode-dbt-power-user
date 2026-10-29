// lint-expect: oxlint react/no-render-return-value
import ReactDOM from "react-dom";
export const r = (el: HTMLElement): unknown => ReactDOM.render(<div />, el);
