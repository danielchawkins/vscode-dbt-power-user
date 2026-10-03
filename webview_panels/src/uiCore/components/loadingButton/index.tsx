import { Button, ButtonProps } from "../button/Button";

interface Props extends ButtonProps {
  loading: boolean;
}

const LoadingButton = ({ loading, children, ...rest }: Props): JSX.Element => (
  <Button {...rest} disabled={loading || rest.disabled} aria-busy={loading}>
    {loading ? (
      <i className="codicon codicon-loading codicon-modifier-spin" />
    ) : (
      children
    )}
  </Button>
);

export default LoadingButton;
