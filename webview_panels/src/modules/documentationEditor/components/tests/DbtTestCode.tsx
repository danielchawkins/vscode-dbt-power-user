import type { documentationEditor } from "@fusion-power-user/webview-contract";
import useAppContext from "@modules/app/useAppContext";
import { executeRequestInSync } from "@modules/documentationEditor/requests";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { panelLogger } from "@modules/logger";
import { CodeBlock } from "@uicore";
import { useEffect, useEffectEvent, useState } from "react";

interface GetTestCodeResponse {
  sql?: string | undefined;
  config?: string | null | undefined;
}
const DbtTestCode = ({
  test,
}: {
  test: documentationEditor.ModelTest;
}): React.JSX.Element | null => {
  const {
    state: { currentDocsData },
  } = useDocumentationContext();
  const [testCode, setTestCode] = useState<
    (GetTestCodeResponse & { error?: string }) | null
  >(null);

  panelLogger.info(testCode);
  const requestTestCode = useEffectEvent(async (model: string) =>
    executeRequestInSync("getTestCode", {
      test: { ...test },
      model,
    }),
  );

  const model = currentDocsData?.name;
  const {
    state: { theme },
  } = useAppContext();
  useEffect(() => {
    if (!model) {
      return;
    }
    let current = true;
    requestTestCode(model).then(
      (result) => current && setTestCode(result),
      (err: unknown) => {
        panelLogger.info("error loading test code", err);
        if (current) {
          setTestCode({ error: (err as Error).message });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [model]);

  if (!testCode) {
    return null;
  }

  return (
    <>
      {testCode.config ? (
        <CodeBlock
          code={testCode.config}
          language="yaml"
          fileName="Config"
          theme={theme}
        />
      ) : null}
      {testCode.sql ? (
        <CodeBlock
          code={testCode.sql}
          language="sql"
          fileName="Source"
          theme={theme}
        />
      ) : null}
      {testCode.error ? (
        <CodeBlock
          code={testCode.error}
          language="yaml"
          fileName="Source"
          theme={theme}
        />
      ) : null}
    </>
  );
};

export default DbtTestCode;
