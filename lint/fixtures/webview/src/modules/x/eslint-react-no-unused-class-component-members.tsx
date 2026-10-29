// lint-expect: eslint @eslint-react/no-unused-class-component-members
import { Component } from "react";
export class Unused extends Component {
  private unused = 1;
  render() {
    return null;
  }
}
