import PreTag from "@modules/markdown/PreTag";
import QueryPanelDefaultView from "@modules/queryPanel/QueryPanelDefaultView";
import useQueryPanelState from "@modules/queryPanel/useQueryPanelState";
import { CodeBlock } from "@uicore";
import PerspectiveErrorBoundary from "../perspective/PerspectiveErrorBoundary";
import PerspectiveViewer from "../perspective/PerspectiveViewer";
import QueryPanelBookmarks from "../queryPanelBookmarks/QueryPanelBookmarks";
import QueryPanelHistory from "../queryPanelQueryHistory/QueryPanelHistory";
import QueryPanelError from "./QueryPanelError";
import QueryPanelLoader from "./QueryPanelLoader";
import { QueryPanelTitleTabState } from "./types";

const QueryPanelContent = ({
  tabState,
}: {
  tabState: QueryPanelTitleTabState;
}): JSX.Element | null => {
  const { loading, hasError, queryResults, compiledCodeMarkup } =
    useQueryPanelState();

  if (QueryPanelTitleTabState.Bookmarks === tabState) {
    return <QueryPanelBookmarks />;
  }

  if (QueryPanelTitleTabState.QueryHistory === tabState) {
    return <QueryPanelHistory />;
  }

  if (QueryPanelTitleTabState.Sql === tabState && compiledCodeMarkup) {
    return (
      <div style={{ width: "fit-content" }}>
        <PreTag text={compiledCodeMarkup}>
          <CodeBlock
            code={compiledCodeMarkup}
            language="sql"
            showLineNumbers
          />
        </PreTag>
      </div>
    );
  }

  if (loading) {
    return <QueryPanelLoader />;
  }

  if (queryResults) {
    return (
      <PerspectiveErrorBoundary>
        <PerspectiveViewer
          data={queryResults.data}
          columnNames={queryResults.columnNames}
          columnTypes={queryResults.columnTypes}
        />
      </PerspectiveErrorBoundary>
    );
  }

  if (hasError) {
    return <QueryPanelError />;
  }

  return <QueryPanelDefaultView />;
};

export default QueryPanelContent;
