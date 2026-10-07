import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { setIncomingDocsData } from "@modules/documentationEditor/state/documentationReducer";
import {
  DBTDocumentation,
  DBTModelTest,
} from "@modules/documentationEditor/state/types";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { isStateDirty } from "@modules/documentationEditor/utils";
import {
  Button,
  DropdownButton,
  PopoverWithButton,
  PopoverWithButtonRef,
  Stack,
} from "@uicore";
import { MouseEvent, useRef } from "react";
import classes from "../../styles.module.css";

/**
 * Handles save documentation functionality
 * Conditions:
 *  - save brand new model and no schema.yml
 *  - save brand new model but schema.yml exists, user wants to save in different yml file
 *  - save existing model but no schema.yml entry
 *  - update existing model
 */
const SaveDocumentation = (): React.JSX.Element | null => {
  const popoverRef = useRef<PopoverWithButtonRef | null>(null);
  const { state, dispatch } = useDocumentationContext();
  const { currentDocsData, currentDocsTests } = state;
  const patchPath = currentDocsData?.patchPath ?? "";

  const saveDocumentation = async (
    dialogType?: "New file" | "Existing file",
  ) => {
    if (!currentDocsData) {
      return;
    }
    const result = (await executeRequestInSync("saveDocumentation", {
      ...currentDocsData,
      updatedTests: currentDocsTests,
      patchPath,
      dialogType,
    })) as {
      saved: boolean;
      documentation: DBTDocumentation;
      tests: DBTModelTest[];
    };
    if (result.saved) {
      dispatch(
        setIncomingDocsData({
          docs: currentDocsData,
          tests: currentDocsTests,
        }),
      );
    }
  };

  const onSaveBtnClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!currentDocsData?.patchPath) {
      popoverRef.current?.open();
      return;
    }
    await saveDocumentation();
  };

  const options = [
    { label: "Existing file", value: "Existing file" },
    { label: "New file", value: "New file" },
  ];

  if (!isStateDirty(state)) {
    return null;
  }

  return (
    <PopoverWithButton
      width="auto"
      ref={popoverRef}
      button={
        <DropdownButton
          onToggleClick={() => popoverRef.current?.toggle()}
          color="primary"
          onClick={onSaveBtnClick}
        >
          Save
        </DropdownButton>
      }
    >
      {() => (
        <Stack direction="column" className={classes.saveDocumentation}>
          {currentDocsData?.patchPath ? (
            <>
              <h4 className="mb-0">Current path:</h4>
              <p id="file_path">{currentDocsData.patchPath}</p>

              <Stack className="justify-content-end">
                <Button color="primary" onClick={() => saveDocumentation()}>
                  Save
                </Button>
              </Stack>
            </>
          ) : (
            <Stack className="align-items-center">
              <p className="m-0">Save to: </p>
              {options.map((option) => (
                <Button
                  key={option.label}
                  color="primary"
                  onClick={() =>
                    saveDocumentation(
                      option.value as "New file" | "Existing file",
                    )
                  }
                >
                  {option.label}
                </Button>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </PopoverWithButton>
  );
};

export default SaveDocumentation;
