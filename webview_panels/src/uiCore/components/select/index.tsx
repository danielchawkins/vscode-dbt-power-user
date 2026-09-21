import Select, {
  StylesConfig,
  components,
  OptionProps,
  GroupBase,
} from "react-select";
import CreatableSelect from "react-select/creatable";
import { Label } from "../../index";
import {
  CheckBlueIcon,
  SelectCheckedIcon,
  SelectUncheckedIcon,
  UncheckIcon,
} from "@assets/icons";
import "./select.module.scss";

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
        <Label check={isMulti}>
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
        </Label>
      </div>
    </Option>
  );
};

type Props = Parameters<typeof Select>[0] & {
  isCreatable?: boolean;
  hideOptionIcon?: boolean;
};
const AltimateSelect = (props: Props): JSX.Element => {
  const colourStyles: StylesConfig<OptionType> = {
    menu: (styles) => ({
      ...styles,
      margin: 0,
      borderRadius: "0 0 4px 4px",
      backgroundColor: "var(--stroke--disable)",
    }),
    option: (styles, { isFocused, isSelected }) => ({
      ...styles,
      backgroundColor:
        isFocused || isSelected ? "var(--background--base)" : "transparent",
    }),
    indicatorSeparator: (styles) => ({ ...styles, display: "none" }),
    input: (styles) => ({
      ...styles,
      color: "var(--text-color--title)",
    }),
    singleValue: (styles) => ({
      ...styles,
      color: "var(--text-color--paragraph)",
    }),
    multiValue: (styles) => ({
      ...styles,
      color: "var(--text-color--title)",
      backgroundColor: "var(--background--04)",
      borderRadius: 26,
      padding: "0 6px",
    }),
    multiValueLabel: (styles) => ({
      ...styles,
      color: "inherit",
    }),
    control: (styles) => ({
      ...styles,
      backgroundColor: "var(--background--base)",
      borderColor: "var(--stroke--disable)",
      color: "var(--text-color--paragraph)",
    }),
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
