import { RefreshIcon } from "@assets/icons";
import { executeRequestInAsync } from "@modules/queryPanel/requests";
import useQueryPanelState from "@modules/queryPanel/useQueryPanelState";
import { Button, Stack, Tag } from "@uicore";

/** Shows which preview of a model the result is, and asks the host for the other one. */
const PreviewModeToggle = (): React.JSX.Element | null => {
  const { preview } = useQueryPanelState();
  if (!preview) {
    return null;
  }
  const otherMode = preview.mode === "computed" ? "materialized" : "computed";
  const handleClick = () => {
    executeRequestInAsync("switchPreview", {
      mode: otherMode,
      model: preview.model,
    });
  };
  return (
    <Stack className="align-items-center gap-2 ms-2">
      <Tag color="primary">
        {preview.mode === "computed" ? "Computed" : "Materialized"}
      </Tag>
      <Button outline onClick={handleClick} icon={<RefreshIcon />}>
        {otherMode === "materialized" ? "Show materialized" : "Show computed"}
      </Button>
    </Stack>
  );
};

export default PreviewModeToggle;
