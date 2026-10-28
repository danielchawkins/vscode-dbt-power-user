import type { documentationEditor } from "@fusion-power-user/webview-contract";
import { Tag, Tooltip } from "@uicore";

interface Props {
  test: documentationEditor.ModelTest;
  onSelect: (test: documentationEditor.ModelTest) => void;
  selectedTest: documentationEditor.ModelTest | null;
  className?: string | undefined;
}

const Test = ({
  test,
  onSelect,
  selectedTest,
  className,
}: Props): React.JSX.Element => {
  const handleClick = () => {
    onSelect(test);
  };

  return (
    <Tooltip title={"Click to view details"}>
      <Tag
        color={selectedTest?.key === test.key ? "primary" : "default"}
        key={test.key}
        onClick={handleClick}
        className={className}
      >
        {test.test_metadata?.name ?? test.key}
      </Tag>
    </Tooltip>
  );
};

export default Test;
