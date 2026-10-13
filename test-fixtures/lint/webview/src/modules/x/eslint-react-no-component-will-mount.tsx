// lint-expect: eslint @eslint-react/no-component-will-mount
import { Component } from "react";
export class Old extends Component {
  componentWillMount() {}
  render() {
    return null;
  }
}
