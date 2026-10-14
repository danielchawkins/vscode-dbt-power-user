import { FileCodeIcon } from "@assets/icons";
import type { QueryHistory } from "@modules/queryPanel/context/types";
import { ListGroupItem } from "@uicore";
import ExecuteQueryButton from "./ExecuteQueryButton";

interface Props {
  queryHistory: QueryHistory;
  onSelect: (queryHistory: QueryHistory) => void;
}
const QueryHistoryRow = ({
  queryHistory,
  onSelect,
}: Props): React.JSX.Element => {
  const handleClick = () => {
    onSelect(queryHistory);
  };

  return (
    <ListGroupItem>
      <button type="button" className="btn-plain" onClick={handleClick}>
        <FileCodeIcon />
        {queryHistory.rawSql}
      </button>
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
