import type { documentationEditor } from "@fusion-power-user/webview-contract";
import { EntityType } from "@modules/documentationEditor/state/entityType";
import type {
  EditorDocumentationColumn,
} from "@modules/documentationEditor/state/types";
import EntityWithTests from "../tests/EntityWithTests";
import ColumnProposal from "./ColumnProposal";
import DocGeneratorInput from "./DocGeneratorInput";

interface Props {
  column: EditorDocumentationColumn;
  tests: documentationEditor.ModelTest[];
}
const DocGeneratorColumn = ({ column, tests }: Props): React.JSX.Element => {
  return (
    <div>
      <DocGeneratorInput
        placeholder={`Describe ${column.name}`}
        type={EntityType.COLUMN}
        entity={column}
        title={column.name}
        tests={tests}
      />
      <ColumnProposal column={column} />
      <EntityWithTests
        title={column.name}
        tests={tests}
        type={EntityType.COLUMN}
      />
    </div>
  );
};

export default DocGeneratorColumn;
