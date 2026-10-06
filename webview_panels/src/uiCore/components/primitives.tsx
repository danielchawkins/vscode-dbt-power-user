import {
  ButtonHTMLAttributes,
  HTMLAttributes,
  LabelHTMLAttributes,
  LiHTMLAttributes,
} from "react";
import { cx } from "../classNames";

type DivProps = HTMLAttributes<HTMLDivElement>;

export const Alert = ({
  className,
  ...rest
}: DivProps & { color?: "warning" }): React.JSX.Element => (
  <div
    {...rest}
    role="alert"
    className={cx("alert alert-warning", className)}
  />
);

export const ButtonGroup = ({
  className,
  ...rest
}: DivProps): React.JSX.Element => (
  <div {...rest} role="group" className={cx("btn-group", className)} />
);

export const InputGroup = ({
  className,
  ...rest
}: DivProps): React.JSX.Element => (
  <div {...rest} className={cx("input-group", className)} />
);

export const Card = ({ className, ...rest }: DivProps): React.JSX.Element => (
  <div {...rest} className={cx("card", className)} />
);

export const CardTitle = ({
  className,
  ...rest
}: DivProps): React.JSX.Element => (
  <div {...rest} className={cx("card-title", className)} />
);

export const CardBody = ({
  className,
  ...rest
}: DivProps): React.JSX.Element => (
  <div {...rest} className={cx("card-body", className)} />
);

export const CardFooter = ({
  className,
  ...rest
}: DivProps): React.JSX.Element => (
  <div {...rest} className={cx("card-footer", className)} />
);

export const Label = ({
  className,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element => (
  // eslint-disable-next-line jsx-a11y-x/label-has-associated-control -- callers pass htmlFor or wrap the control
  <label {...rest} className={cx("form-label", className)} />
);

export const ListGroup = ({
  className,
  ...rest
}: HTMLAttributes<HTMLUListElement>): React.JSX.Element => (
  <ul {...rest} className={cx("list-group", className)} />
);

export const ListGroupItem = ({
  className,
  ...rest
}: LiHTMLAttributes<HTMLLIElement>): React.JSX.Element => (
  <li {...rest} className={cx("list-group-item", className)} />
);

/** A row of tabs; each `NavLink` is a tab button that carries `active` when selected. */
export const Nav = ({
  className,
  ...rest
}: HTMLAttributes<HTMLUListElement>): React.JSX.Element => (
  <ul {...rest} className={cx("nav", className)} />
);

export const NavItem = ({
  className,
  ...rest
}: LiHTMLAttributes<HTMLLIElement>): React.JSX.Element => (
  <li {...rest} className={cx("nav-item", className)} />
);

export const NavLink = ({
  active = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean | undefined;
}): React.JSX.Element => (
  <button
    {...rest}
    type="button"
    aria-pressed={active}
    className={cx("nav-link", active && "active", className)}
  />
);
