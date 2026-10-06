import { KeyboardEvent, useState } from "react";
import classes from "./chipInput.module.css";

interface Props {
  id?: string | undefined;
  name?: string | undefined;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string | undefined;
  required?: boolean | undefined;
}

/** A text input that turns each entered value into a removable chip. */
const ChipInput = ({
  id,
  name,
  values,
  onChange,
  placeholder,
  required,
}: Props): JSX.Element => {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const value = draft.trim();
    if (value && !values.includes(value)) {
      onChange([...values, value]);
    }
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // Enter adds a chip; it never submits the enclosing form.
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className={classes.chips}>
      {values.map((value) => (
        <span key={value} className={classes.chip}>
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            className={classes.remove}
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        name={name}
        className={classes.input}
        value={draft}
        placeholder={placeholder}
        required={required && values.length === 0}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  );
};

export default ChipInput;
