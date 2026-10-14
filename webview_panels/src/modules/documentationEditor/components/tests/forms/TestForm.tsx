import { DbtGenericTests } from "@modules/documentationEditor/state/types";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardTitle,
  Stack,
  Tag,
} from "@uicore";
import type { SubmitEvent } from "react";
import { useEffect, useEffectEvent } from "react";
import useTestFormSave, { TestOperation } from "../hooks/useTestFormSave";
import useTestFormValues from "../hooks/useTestFormValues";
import AcceptedValues from "./AcceptedValues";
import { isTestFormComplete } from "./isTestFormComplete";
import Relationships from "./Relationships";

interface Props {
  formType: DbtGenericTests;
  onClose: () => void;
  column: string;
}

const TestForm = ({
  formType,
  onClose,
  column,
}: Props): React.JSX.Element | null => {
  const { isSaving, handleSave } = useTestFormSave();
  const { values, setValue, reset } = useTestFormValues();
  const complete = isTestFormComplete(formType, values);

  // NOT_NULL and UNIQUE take no arguments, so choosing one saves at once.
  const saveWithoutForm = useEffectEvent((test: DbtGenericTests) => {
    handleSave({ test }, column, TestOperation.CREATE);
    onClose();
  });
  const savesWithoutForm =
    formType === DbtGenericTests.NOT_NULL ||
    formType === DbtGenericTests.UNIQUE;

  useEffect(() => {
    if (savesWithoutForm && !isSaving) {
      saveWithoutForm(formType);
    }
  }, [formType, savesWithoutForm, isSaving]);

  const handleCancel = () => {
    reset();
    if (!isSaving) {
      onClose();
    }
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || !event.currentTarget.checkValidity()) {
      return;
    }
    handleSave({ ...values, test: formType }, column, TestOperation.CREATE);
    onClose();
  };

  if (
    formType !== DbtGenericTests.RELATIONSHIPS &&
    formType !== DbtGenericTests.ACCEPTED_VALUES
  ) {
    return null;
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardTitle>
          <div className="mb-1">Selected test</div>
          <Tag color="primary" style={{ cursor: "auto" }}>
            {formType}
          </Tag>
        </CardTitle>
        <CardBody>
          {formType === DbtGenericTests.RELATIONSHIPS ? (
            <Relationships
              toValue={values.to}
              fieldValue={values.field}
              setValue={setValue}
            />
          ) : (
            <AcceptedValues
              column={column}
              setValue={setValue}
              values={values.accepted_values}
            />
          )}
        </CardBody>
        <CardFooter>
          <Stack className="mt-3">
            <Button type="submit" color="primary" disabled={!complete}>
              Add
            </Button>
            <Button onClick={handleCancel} outline>
              Cancel
            </Button>
          </Stack>
        </CardFooter>
      </Card>
    </form>
  );
};

export default TestForm;
