import { CloseIcon } from "@assets/icons";
import { useQueryPanelDispatch } from "@modules/queryPanel/context/queryPanelContext";
import { resetData } from "@modules/queryPanel/context/queryPanelReducer";
import useQueryPanelState from "@modules/queryPanel/useQueryPanelState";
import { Button } from "@uicore";

const ClearResultsButton = (): JSX.Element | null => {
  const { queryResults } = useQueryPanelState();
  const dispatch = useQueryPanelDispatch();
  const handleClear = () => {
    dispatch(resetData());
  };
  if (!queryResults) {
    return null;
  }
  return (
    <Button outline onClick={handleClear} icon={<CloseIcon />}>
      Clear results
    </Button>
  );
};

export default ClearResultsButton;
