import CommonActionButtons from "@modules/commonActionButtons/CommonActionButtons";
import { EntityType } from "@modules/documentationEditor/state/entityType";
import { Stack } from "@uicore";
import { useMemo } from "react";
import DocGeneratorColumnsList from "./components/docGenerator/DocGeneratorColumnsList";
import DocGeneratorInput from "./components/docGenerator/DocGeneratorInput";
import { BulkDocumentationPropagationPanel } from "./components/documentationPropagation/DocumentationPropagation";
import DocumentationHelpContent from "./components/help/DocumentationHelpContent";
import SaveDocumentation from "./components/saveDocumentation/SaveDocumentation";
import EntityWithTests from "./components/tests/EntityWithTests";
import EntityWithUnitTests from "./components/tests/EntityWithUnitTests";
import useDocumentationContext from "./state/useDocumentationContext";
import classes from "./styles.module.scss";

const DocumentationEditor = (): JSX.Element => {
  const {
    state: { currentDocsData, currentDocsTests, currentUnitTests },
  } = useDocumentationContext();

  const modelTests = useMemo(() => {
    return currentDocsTests?.filter((test) => !test.column_name);
  }, [currentDocsTests]);

  if (!currentDocsData) {
    return (
      <div className={classes.docGenerator}>
        <h2>Documentation Help</h2>
        <DocumentationHelpContent showMissingDocumentationMessage />
      </div>
    );
  }

  return (
    <div className={`${classes.documentationWrapper} ${classes.limitWidth}`}>
      <Stack className="mb-2 justify-content-between">
        <h2>Documentation Editor</h2>
        <Stack className="align-items-center">
          <SaveDocumentation />
          <CommonActionButtons />
        </Stack>
      </Stack>
      <div className={classes.docGenerator}>
        <Stack className={classes.bodyWrap}>
          <Stack direction="column" className={classes.body}>
            <Stack direction="column">
              <Stack direction="column" style={{ margin: "1rem 0 10px 0" }}>
                <DocGeneratorInput
                  entity={currentDocsData}
                  type={EntityType.MODEL}
                  placeholder="Describe your model"
                  title={`Model: ${currentDocsData.name}`}
                  tests={modelTests}
                />
                <EntityWithTests
                  title={currentDocsData.name}
                  tests={modelTests}
                  type={EntityType.MODEL}
                />
                <EntityWithUnitTests
                  title={currentDocsData.name}
                  unitTests={currentUnitTests}
                />
              </Stack>
              <DocGeneratorColumnsList />
            </Stack>
          </Stack>
        </Stack>
      </div>
      <BulkDocumentationPropagationPanel />
    </div>
  );
};

export default DocumentationEditor;
