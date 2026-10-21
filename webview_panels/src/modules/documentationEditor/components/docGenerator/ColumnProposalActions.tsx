import { Button, Stack } from "@uicore";
import { executeRequestInAsync } from "../../requests";

/** The two ways to fill in a model's columns: the types from the target, and the descriptions from upstream. */
const ColumnProposalActions = (): React.JSX.Element => (
  <Stack className="align-items-center">
    <Button
      color="link"
      className="pt-0 pb-0"
      onClick={() => executeRequestInAsync("proposeColumns", { kind: "types" })}
    >
      Record column types
    </Button>
    <Button
      color="link"
      className="pt-0 pb-0"
      onClick={() =>
        executeRequestInAsync("proposeColumns", { kind: "descriptions" })
      }
    >
      Pull upstream descriptions
    </Button>
  </Stack>
);

export default ColumnProposalActions;
