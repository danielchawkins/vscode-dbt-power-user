import { executeRequestInAsync } from "@modules/app/requestExecutor";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { Alert, Button, Stack } from "@uicore";

const DocumentationHelpContent = ({
  showMissingDocumentationMessage,
}: {
  showMissingDocumentationMessage?: boolean;
}): JSX.Element => {
  const {
    state: { missingDocumentationMessage },
  } = useDocumentationContext();

  const openProblemsTab = () => {
    executeRequestInAsync("openProblemsTab", {});
  };
  return (
    <Stack direction="column">
      {missingDocumentationMessage && showMissingDocumentationMessage ? (
        <Alert color="warning" className="mt-2 mb-1">
          {missingDocumentationMessage.message}
          {missingDocumentationMessage.type === "error" ? (
            <>
              <Button
                color="link"
                style={{ marginTop: -5 }}
                onClick={openProblemsTab}
              >
                Click here
              </Button>{" "}
              to view Problems tab
            </>
          ) : (
            ""
          )}
        </Alert>
      ) : null}
      <p>
        You can write, update, and generate descriptions for your dbt models and
        columns, and save them in YAML files with a click of a button.{" "}
      </p>
      <p>
        <b>Save Documentation:</b> Once you&apos;ve added or edited the
        documentation for your model and columns, hit the
        <b> &quot;Save Documentation&quot;</b> button at the bottom to save in
        schema.yml
      </p>
      <p>
        <b>Sync Columns with Database:</b> Use the sync action to synchronize
        the model with your database and fetch the accurate columns and their
        types.
      </p>
      <p>
        Need more help? Check out the&nbsp;
        <a href="https://docs.myaltimate.com/document/generatedoc/">
          documentation
        </a>
        .
      </p>
    </Stack>
  );
};

export default DocumentationHelpContent;
