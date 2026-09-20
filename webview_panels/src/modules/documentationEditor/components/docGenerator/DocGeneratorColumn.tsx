import { EntityType } from "@modules/documentationEditor/state/entityType";
import {
  DBTDocumentationColumn,
  DBTModelTest,
} from "@modules/documentationEditor/state/types";
import EntityWithTests from "../tests/EntityWithTests";
import DocGeneratorInput from "./DocGeneratorInput";

interface Props {
  column: DBTDocumentationColumn;
  tests: DBTModelTest[];
}
const DocGeneratorColumn = ({ column, tests }: Props): JSX.Element => {
  return (
    <div>
      <DocGeneratorInput
        placeholder={`Describe ${column.name}`}
        type={EntityType.COLUMN}
        entity={column}
        title={column.name}
        tests={tests}
      />
      <EntityWithTests
        title={column.name}
        tests={tests}
        type={EntityType.COLUMN}
      />
    </div>
  );
};

export default DocGeneratorColumn;
