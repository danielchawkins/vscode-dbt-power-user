// lint-expect: eslint @eslint-react/no-component-will-update
import { Component } from "react";
export class Old extends Component {
  componentWillUpdate() {}
  render() {
    return null;
  }
}
