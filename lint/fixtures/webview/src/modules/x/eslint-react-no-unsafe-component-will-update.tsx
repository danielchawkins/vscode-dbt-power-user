// lint-expect: eslint @eslint-react/no-unsafe-component-will-update
import { Component } from "react";
export class Old extends Component {
  UNSAFE_componentWillUpdate() {}
  render() {
    return null;
  }
}
