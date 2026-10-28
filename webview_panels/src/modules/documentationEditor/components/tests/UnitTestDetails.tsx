import type { documentationEditor } from "@fusion-power-user/webview-contract";
import useAppContext from "@modules/app/useAppContext";
import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { panelLogger } from "@modules/logger";
import { CodeBlock, Stack } from "@uicore";
import { useEffect, useState } from "react";

interface Props {
  test: documentationEditor.UnitTest;
  modelName: string;
}

interface GetUnitTestCodeResponse {
  yaml?: string | undefined;
  error?: string | undefined;
}

const UnitTestDetails = ({ test, modelName }: Props): React.JSX.Element => {
  const [content, setContent] = useState<GetUnitTestCodeResponse | null>(null);
  const {
    state: { theme },
  } = useAppContext();

  useEffect(() => {
    executeRequestInSync("getUnitTestCode", {
      path: test.path,
      model: modelName,
      name: test.name,
    })
      .then((result) => setContent(result))
      .catch((err) => {
        panelLogger.error("error loading unit test code", err);
        setContent({ error: (err as Error).message });
      });
  }, [test.path, modelName, test.name]);

  return (
    <Stack direction="column">
      <h3 className="mb-2">Unit Test: {test.name}</h3>
      {content?.yaml ? (
        <CodeBlock code={content.yaml} language="yaml" theme={theme} />
      ) : null}
      {content?.error ? (
        <CodeBlock
          code={content.error}
          language="yaml"
          fileName="Error"
          theme={theme}
        />
      ) : null}
    </Stack>
  );
};

export default UnitTestDetails;
