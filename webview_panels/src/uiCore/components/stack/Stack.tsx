import { HTMLAttributes, ReactNode, Ref } from "react";
import classes from "./stack.module.css";

const Stack = ({
  children,
  direction = "row",
  ref,
  ...rest
}: {
  children: ReactNode;
  direction?: "row" | "column" | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
} & HTMLAttributes<HTMLDivElement>): React.JSX.Element => {
  return (
    <div
      {...rest}
      className={`${rest.className ?? ""} ${classes.stack} stack-${direction}`}
      ref={ref}
    >
      {children}
    </div>
  );
};

export default Stack;
