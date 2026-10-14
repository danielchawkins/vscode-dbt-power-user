// lint-expect: eslint @eslint-react/no-unsafe-component-will-receive-props
import { Component } from "react";
export class Old extends Component {
  UNSAFE_componentWillReceiveProps() {}
  render() {
    return null;
  }
}
