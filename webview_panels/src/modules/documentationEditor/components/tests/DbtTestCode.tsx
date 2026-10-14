import { executeRequestInSync } from "@modules/documentationEditor/requests";
import type { DBTModelTest } from "@modules/documentationEditor/state/types";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { panelLogger } from "@modules/logger";
import { CodeBlock } from "@uicore";
import { useEffect, useEffectEvent, useState } from "react";

interface GetTestCodeResponse {
  sql?: string | undefined;
  config?: string | undefined;
}
const DbtTestCode = ({
  test,
}: {
  test: DBTModelTest;
}): React.JSX.Element | null => {
  const {
    state: { currentDocsData },
  } = useDocumentationContext();
  const [testCode, setTestCode] = useState<
    (GetTestCodeResponse & { error?: string }) | null
  >(null);

  panelLogger.info(testCode);
  const requestTestCode = useEffectEvent(
    async (model: string) =>
      (await executeRequestInSync("getTestCode", {
        test: { ...test },
        model,
      })) as GetTestCodeResponse,
  );

  const model = currentDocsData?.name;
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
        <CodeBlock code={testCode.config} language="yaml" fileName="Config" />
      ) : null}
      {testCode.sql ? (
        <CodeBlock code={testCode.sql} language="sql" fileName="Source" />
      ) : null}
      {testCode.error ? (
        <CodeBlock code={testCode.error} language="yaml" fileName="Source" />
      ) : null}
    </>
  );
};

export default DbtTestCode;
