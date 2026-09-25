import { HTMLAttributes } from "react";
import LoadingSpinnerUrl from "./spinner.gif";
import "./styles.css";
export { default as CheckBlueIcon } from "./check-blue.svg?react";
export { default as DocsIcon } from "./docs.svg?react";
export { default as EditIcon } from "./edit.svg?react";
export { default as ErrorIcon } from "./error.svg?react";
export { default as HelpIcon } from "./help.svg?react";
export { default as LikeIcon } from "./like.svg?react";
export { default as LoaderIcon } from "./loader.svg?react";
export { default as NoHistoryIcon } from "./no-history.svg?react";
export { default as PreviewIcon } from "./preview.svg?react";
export { default as SelectCheckedIcon } from "./select-checked.svg?react";
export { default as SelectUncheckedIcon } from "./select-unchecked.svg?react";
export { default as ShinesIcon } from "./shines.svg?react";
export { default as TestsIcon } from "./tests.svg?react";
export { default as UncheckIcon } from "./uncheck.svg?react";

interface Props {
  icon: string;
}
const Icon = ({
  icon,
  className = "",
  ...rest
}: Props & HTMLAttributes<HTMLElement>) => (
  <i className={`${className} codicon codicon-${icon}`} {...rest} />
);

export const PlayIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <Icon icon="play" {...props} />
);

export const RemoveIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <Icon icon="remove" {...props} />
);

export const AddIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <Icon icon="add" {...props} />
);

export const DeleteIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <Icon icon="trash" {...props} />
);

export const FilesIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <Icon icon="files" {...props} />
);

export const ArrowUpIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="chevron-up" {...props} />;

export const ArrowDownIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="chevron-down" {...props} />;

export const CheckedIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="pass-filled" {...props} />;

export const RefreshIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="debug-restart" {...props} />;

export const SettingsIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="gear" {...props} />;

export const ChevronDownIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="chevron-down" {...props} />;

export const ChevronRightIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="chevron-right" {...props} />;

export const InfoCircleIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="info" {...props} />;

export const CloseIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <Icon icon="close" {...props} />
);

export const LoadingSpinner = (): JSX.Element => (
  <img
    // @ts-expect-error added in altimateWebViewProvider
    src={(window.spinnerUrl as string) ?? LoadingSpinnerUrl}
    alt="Altimate loader"
  />
);

export const PlayCircleIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="play-circle" {...props} />;

export const FilterIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <Icon icon="filter" {...props} />
);

export const SearchIcon = (props: HTMLAttributes<HTMLElement>): JSX.Element => (
  <Icon icon="search" {...props} />
);

export const FileCodeIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="file-code" {...props} />;

export const OpenNewIcon = (
  props: HTMLAttributes<HTMLElement>,
): JSX.Element => <Icon icon="link-external" {...props} />;
