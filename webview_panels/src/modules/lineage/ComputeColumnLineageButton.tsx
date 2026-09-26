import { executeRequestInAsync } from "@modules/app/requestExecutor";
import { Button } from "@uicore";

/** Runs `fusionPowerUser.refreshColumnLineage`: a full strict info-schema compile of the current project. */
const ComputeColumnLineageButton = (): JSX.Element => (
  <Button
    color="link"
    className="p-0"
    title="Run dbt compile --static-analysis strict --generate-info-schema for this project"
    onClick={() => executeRequestInAsync("computeColumnLineage", {})}
  >
    Compute column lineage
  </Button>
);

export default ComputeColumnLineageButton;
