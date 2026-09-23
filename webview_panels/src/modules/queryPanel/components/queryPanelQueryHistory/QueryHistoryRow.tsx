import { QueryHistory } from "@modules/queryPanel/context/types";
import { activateClickOnKeyDown, ListGroupItem } from "@uicore";
import ExecuteQueryButton from "./ExecuteQueryButton";
import { FileCodeIcon } from "@assets/icons";

interface Props {
  queryHistory: QueryHistory;
  onSelect: (queryHistory: QueryHistory) => void;
}
const QueryHistoryRow = ({ queryHistory, onSelect }: Props): JSX.Element => {
  const handleClick = () => {
    onSelect(queryHistory);
  };

  return (
    <ListGroupItem>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => activateClickOnKeyDown(e, handleClick)}
      >
        <FileCodeIcon />
        {queryHistory.rawSql}
      </div>
      <div>
        <span>
          {new Date(queryHistory.timestamp).toLocaleString("default", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          {new Date(queryHistory.timestamp).toLocaleString("default", {
            day: "numeric",
            month: "short",
            year: "2-digit",
          })}
        </span>
        <ExecuteQueryButton
          query={queryHistory.rawSql}
          projectName={queryHistory.projectName}
          editorName={queryHistory.modelName}
        />
      </div>
    </ListGroupItem>
  );
};

export default QueryHistoryRow;
