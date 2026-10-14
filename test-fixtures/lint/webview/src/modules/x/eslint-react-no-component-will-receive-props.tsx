// lint-expect: eslint @eslint-react/no-component-will-receive-props
import { Component } from "react";
export class Old extends Component {
  componentWillReceiveProps() {}
  render() {
    return null;
  }
}
