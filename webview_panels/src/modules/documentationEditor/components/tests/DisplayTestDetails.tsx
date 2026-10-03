import { DeleteIcon, EditIcon } from "@assets/icons";
import { EntityType } from "@modules/documentationEditor/state/entityType";
import {
  DbtGenericTests,
  DBTModelTest,
  DbtTestTypes,
  TestMetadataAcceptedValuesKwArgs,
  TestMetadataRelationshipsKwArgs,
} from "@modules/documentationEditor/state/types";
import { panelLogger } from "@modules/logger";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardTitle,
  IconButton,
  Stack,
  Tag,
} from "@uicore";
import { FormEvent, useState } from "react";
import classes from "../../styles.module.css";
import AcceptedValues from "./forms/AcceptedValues";
import Relationships from "./forms/Relationships";
import { isTestFormComplete } from "./forms/isTestFormComplete";
import useTestFormSave, { TestOperation } from "./hooks/useTestFormSave";
import useTestFormValues from "./hooks/useTestFormValues";
import TestDetails from "./TestDetails";
import { findDbtTestType } from "./utils";

interface Props {
  onClose: () => void;
  test: DBTModelTest;
  column: string;
  type: EntityType;
}

const DisplayTestDetails = ({
  onClose,
  test,
  column,
  type,
}: Props): JSX.Element => {
  const { values, setValue } = useTestFormValues();
  const complete = isTestFormComplete(test.test_metadata?.name, values);

  const { isSaving, handleSave } = useTestFormSave();

  const [isInEditMode, setIsInEditMode] = useState(false);

  const isEditableTest =
    test.test_metadata?.name === DbtGenericTests.ACCEPTED_VALUES ||
    test.test_metadata?.name === DbtGenericTests.RELATIONSHIPS;
  const testType = findDbtTestType(test);
  const canDeleteTest =
    testType !== DbtTestTypes.SINGULAR &&
    testType !== DbtTestTypes.UNKNOWN &&
    type !== EntityType.MODEL;

  const handleDelete = () => {
    panelLogger.info("delete test", test);
    handleSave(
      { test: test.test_metadata?.name as DbtGenericTests },
      column,
      TestOperation.DELETE,
    );
    onClose();
  };

  const handleEdit = () => {
    setIsInEditMode(true);
    if (test.test_metadata?.name === DbtGenericTests.ACCEPTED_VALUES) {
      setValue(
        "accepted_values",
        (test.test_metadata.kwargs as TestMetadataAcceptedValuesKwArgs).values,
      );
      return;
    }

    if (test.test_metadata?.name === DbtGenericTests.RELATIONSHIPS) {
      setValue(
        "to",
        (test.test_metadata.kwargs as TestMetadataRelationshipsKwArgs).to,
      );
      setValue(
        "field",
        (test.test_metadata.kwargs as TestMetadataRelationshipsKwArgs).field,
      );
      return;
    }
  };

  const handleCancel = () => {
    setIsInEditMode(false);
  };

  const getFooter = () => {
    return (
      <CardFooter>
        <Stack className="mt-3">
          <Button type="submit" disabled={isSaving || !complete}>
            Update
          </Button>
          <Button outline onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
        </Stack>
      </CardFooter>
    );
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const testName = test.test_metadata?.name;
    // Dont submit for non generic test
    if (
      !testName ||
      !isInEditMode ||
      !complete ||
      !event.currentTarget.checkValidity()
    ) {
      return;
    }
    handleSave(
      { ...values, test: testName as DbtGenericTests },
      column,
      TestOperation.UPDATE,
    );
    onClose();
  };

  const getEditableContent = () => {
    switch (test.test_metadata?.name) {
      case DbtGenericTests.UNIQUE:
      case DbtGenericTests.NOT_NULL:
        return null;
      case DbtGenericTests.ACCEPTED_VALUES:
        return (
          <Card>
            <CardBody>
              <div>
                <AcceptedValues
                  values={values.accepted_values}
                  column={column}
                  setValue={setValue}
                />
                {getFooter()}
              </div>
            </CardBody>
          </Card>
        );
      case DbtGenericTests.RELATIONSHIPS:
        return (
          <Card>
            <CardBody>
              <div>
                <Relationships
                  setValue={setValue}
                  toValue={values.to}
                  fieldValue={values.field}
                />
                {getFooter()}
              </div>
            </CardBody>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <Stack direction="column" className={classes.addTest}>
      <Card>
        <CardTitle>Column: {test.column_name}</CardTitle>
        <CardBody>
          <Stack className={classes.title}>
            <span>
              Test:{" "}
              <Tag color="primary" style={{ cursor: "auto" }}>
                {test.test_metadata?.name ?? test.key}
              </Tag>
            </span>
            <span>
              {isEditableTest ? (
                <IconButton title="Edit test" onClick={handleEdit}>
                  <EditIcon />
                </IconButton>
              ) : null}
              {canDeleteTest ? (
                <IconButton
                  style={{ color: "var(--vscode-errorForeground)" }}
                  title="Delete test"
                  onClick={handleDelete}
                >
                  <DeleteIcon />
                </IconButton>
              ) : null}
            </span>
          </Stack>
        </CardBody>
      </Card>

      <form onSubmit={onSubmit}>
        {isInEditMode ? (
          getEditableContent()
        ) : (
          <TestDetails test={test} testType={testType} />
        )}
      </form>
    </Stack>
  );
};

export default DisplayTestDetails;
