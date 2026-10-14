// lint-expect: eslint @eslint-react/no-unsafe-component-will-mount
import { Component } from "react";
export class Old extends Component {
  UNSAFE_componentWillMount() {}
  render() {
    return null;
  }
}
