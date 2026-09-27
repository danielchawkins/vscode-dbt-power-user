import { Button } from "@altimateai/ui-components/lineage";
import { executeRequestInAsync } from "@modules/app/requestExecutor";

/** Runs `fusionPowerUser.refreshColumnLineage`: a full strict info-schema compile of the current project. */
const ComputeColumnLineageButton = (): JSX.Element => (
  <div className="al-tw-scope">
    <Button
      variant="default"
      size="xs"
      title="Run dbt compile --static-analysis strict --generate-info-schema for this project"
      onClick={() => executeRequestInAsync("computeColumnLineage", {})}
    >
      Compute column lineage
    </Button>
  </div>
);

export default ComputeColumnLineageButton;
