import { executeRequestInAsync } from "@modules/queryPanel/requests";
import { Button } from "@uicore";

const RunAdhocQueryButton = (): React.JSX.Element => {
  const handleClick = () => {
    executeRequestInAsync("runAdhocQuery");
  };
  return (
    <Button
      aria-label="open-adhoc-query"
      outline
      onClick={handleClick}
      title="New query"
    >
      +Q
    </Button>
  );
};

export default RunAdhocQueryButton;
