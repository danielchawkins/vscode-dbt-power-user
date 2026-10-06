import { executeRequestInSync } from "@modules/documentationEditor/requests";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { panelLogger } from "@modules/logger";
import { LoadingButton, OptionType, Select, Stack } from "@uicore";
import { useState } from "react";
import { SetTestFormValue } from "../hooks/useTestFormValues";

interface Props {
  column: string;
  values?: string[] | undefined;
  setValue: SetTestFormValue;
}
const AcceptedValues = ({ column, setValue, values }: Props): JSX.Element => {
  const {
    state: { currentDocsData },
  } = useDocumentationContext();
  const [isLoading, setIsLoading] = useState(false);
  const getDistinctColumnValues = async () => {
    setIsLoading(true);
    try {
      const result = (await executeRequestInSync("getDistinctColumnValues", {
        model: currentDocsData?.name,
        column,
      })) as string[] | undefined;

      if (result?.length && values?.length) {
        const items = ["Yes, overwrite", "Cancel"];
        const response = await executeRequestInSync("showInformationMessage", {
          infoMessage: "Overwrite the existing values?",
          items,
        });
        if (response !== items[0]) {
          return;
        }
      }
      setValue("accepted_values", result);
    } catch (e) {
      panelLogger.error("Unable to get distinct values", e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Select
        components={{
          DropdownIndicator: null,
          Menu: () => null,
        }}
        inputId="accepted_values"
        name="accepted_values"
        required
        hideOptionIcon
        isCreatable
        isClearable
        value={values?.map((v) => ({ label: v, value: v })) ?? []}
        isMulti
        onChange={(updates: unknown) =>
          setValue(
            "accepted_values",
            ((updates ?? []) as OptionType[]).map((val) => val.value),
          )
        }
        placeholder="Type a value and press enter to add"
      />
      <Stack className="mt-2 justify-content-between align-items-baseline">
        <p className="p4">Hit enter to add value</p>

        <LoadingButton onClick={getDistinctColumnValues} loading={isLoading}>
          Get distinct column values
        </LoadingButton>
      </Stack>
    </div>
  );
};

export default AcceptedValues;
