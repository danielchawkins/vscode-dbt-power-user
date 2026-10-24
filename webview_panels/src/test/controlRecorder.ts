import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import type { ControlId, InteractiveRole } from "./controlCoverage";
import { controlId } from "./controlCoverage";

type User = ReturnType<typeof userEvent.setup>;
type Scope = { getByRole: typeof screen.getByRole };

/**
 * The helpers a controls suite clicks and types with. Each call returns its own `clicked` set, which the suite
 * checks against its `TESTED_CONTROLS`, so every suite calls this once in its own file.
 */
export const controlRecorder = () => {
  /** Every control the suite clicked or typed into. */
  const clicked = new Set<ControlId>();

  /** Clicks `element`, a control with `role` and `name`, and records it as tested. */
  const pressElement = async (
    user: User,
    role: InteractiveRole,
    name: string,
    element: HTMLElement,
  ) => {
    clicked.add(controlId(role, name, element));
    await user.click(element);
    return element;
  };

  /** Clicks the control with `role` and `name`, and records it as tested. */
  const press = (
    user: User,
    role: InteractiveRole,
    name: string,
    scope: Scope = screen,
  ) => pressElement(user, role, name, scope.getByRole(role, { name }));

  /** Replaces the value of the input, a control with `role` and `name`, and records it as tested. */
  const typeInto = async (
    user: User,
    role: InteractiveRole,
    name: string,
    value: string,
  ) => {
    const element = screen.getByRole(role, { name });
    clicked.add(controlId(role, name, element));
    await user.clear(element);
    await user.type(element, value);
    return element;
  };

  return { clicked, press, pressElement, typeInto };
};
