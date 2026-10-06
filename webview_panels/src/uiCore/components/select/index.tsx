import { ChangeEvent, SelectHTMLAttributes } from "react";
import classes from "./select.module.css";

export interface OptionType {
  label: string;
  value: string;
}

type NativeProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "value" | "multiple"
>;

interface SingleProps extends NativeProps {
  options: OptionType[];
  value: string | undefined;
  onChange: (value: string) => void;
  /** The disabled first entry shown while nothing is chosen. */
  placeholder?: string | undefined;
}

/** A native single-choice dropdown. */
export const Select = ({
  options,
  value,
  onChange,
  placeholder = "Select...",
  className,
  ...rest
}: SingleProps): React.JSX.Element => (
  <select
    {...rest}
    className={`${classes.select} ${className ?? ""}`}
    value={value ?? ""}
    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
      onChange(event.target.value)
    }
  >
    <option value="" disabled>
      {placeholder}
    </option>
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

interface MultiProps extends NativeProps {
  options: OptionType[];
  value: string[];
  onChange: (value: string[]) => void;
}

/** A native multiple-choice list. */
export const MultiSelect = ({
  options,
  value,
  onChange,
  className,
  ...rest
}: MultiProps): React.JSX.Element => (
  <select
    {...rest}
    multiple
    className={`${classes.select} ${classes.multi} ${className ?? ""}`}
    value={value}
    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
      onChange(Array.from(event.target.selectedOptions, (o) => o.value))
    }
  >
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);
