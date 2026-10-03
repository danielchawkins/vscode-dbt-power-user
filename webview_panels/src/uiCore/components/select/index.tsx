import {
  CheckBlueIcon,
  SelectCheckedIcon,
  SelectUncheckedIcon,
  UncheckIcon,
} from "@assets/icons";
import Select, {
  components,
  GroupBase,
  OptionProps,
  StylesConfig,
} from "react-select";
import CreatableSelect from "react-select/creatable";
import "./select.module.css";

const { Option } = components;

export interface OptionType {
  label: string;
  value: string;
}

interface SelectExtraProps {
  hideOptionIcon?: boolean;
}

const IconOption = (
  props: OptionProps<OptionType, boolean, GroupBase<OptionType>>,
) => {
  const {
    data: { label },
    isMulti,
    isSelected,
    selectProps,
  } = props;
  const { hideOptionIcon } = selectProps as SelectExtraProps;

  return (
    <Option {...props}>
      <div className="flex items-center gap-2">
        <span style={{ marginRight: 10 }}>
          {hideOptionIcon ? null : isSelected ? (
            isMulti ? (
              <SelectCheckedIcon />
            ) : (
              <CheckBlueIcon />
            )
          ) : isMulti ? (
            <SelectUncheckedIcon />
          ) : (
            <UncheckIcon />
          )}
        </span>
        {label}
      </div>
    </Option>
  );
};

type Props = Parameters<typeof Select>[0] & {
  isCreatable?: boolean;
  hideOptionIcon?: boolean;
};
const themeStyles: StylesConfig<OptionType> = {
  menu: (styles) => ({
    ...styles,
    margin: 0,
    borderRadius: "0 0 4px 4px",
    backgroundColor: "var(--vscode-dropdown-background)",
    border: "1px solid var(--vscode-dropdown-border, transparent)",
    color: "var(--vscode-dropdown-foreground)",
  }),
  option: (styles, { isFocused, isSelected }) => ({
    ...styles,
    backgroundColor: isSelected
      ? "var(--vscode-list-activeSelectionBackground)"
      : isFocused
        ? "var(--vscode-list-hoverBackground)"
        : "transparent",
    color: isSelected
      ? "var(--vscode-list-activeSelectionForeground)"
      : "var(--vscode-dropdown-foreground)",
    outline: isFocused
      ? "1px dotted var(--vscode-contrastActiveBorder, transparent)"
      : undefined,
  }),
  indicatorSeparator: (styles) => ({ ...styles, display: "none" }),
  input: (styles) => ({
    ...styles,
    color: "var(--vscode-input-foreground)",
  }),
  singleValue: (styles) => ({
    ...styles,
    color: "var(--vscode-dropdown-foreground)",
  }),
  multiValue: (styles) => ({
    ...styles,
    color: "var(--vscode-badge-foreground)",
    backgroundColor: "var(--vscode-badge-background)",
    borderRadius: 26,
    padding: "0 6px",
  }),
  multiValueLabel: (styles) => ({
    ...styles,
    color: "inherit",
  }),
  control: (styles, { isFocused }) => ({
    ...styles,
    backgroundColor: "var(--vscode-dropdown-background)",
    borderColor: isFocused
      ? "var(--vscode-focusBorder)"
      : "var(--vscode-dropdown-border, var(--vscode-contrastBorder, transparent))",
    boxShadow: "none",
    color: "var(--vscode-dropdown-foreground)",
  }),
};

const AltimateSelect = (props: Props): JSX.Element => {
  const colourStyles: StylesConfig<OptionType> = {
    ...themeStyles,
    container: (styles, cprops) => ({
      ...styles,
      // @ts-expect-error TODO fix this type
      ...props.styles?.container?.(styles, cprops),
    }),
  };

  if (props.isCreatable) {
    return (
      <CreatableSelect<OptionType>
        {...props}
        styles={colourStyles}
        className={`${props.className} altimate-select`}
        hideOptionIcon={props.hideOptionIcon}
        // @ts-expect-error TODO fix this type
        components={{
          ...props.components,
          Option: IconOption,
        }}
      />
    );
  }
  return (
    <Select<OptionType>
      {...props}
      styles={colourStyles}
      className={`${props.className} altimate-select`}
      hideOptionIcon={props.hideOptionIcon}
      // @ts-expect-error TODO fix this type
      components={{
        ...props.components,
        Option: IconOption,
      }}
    />
  );
};

export default AltimateSelect;
