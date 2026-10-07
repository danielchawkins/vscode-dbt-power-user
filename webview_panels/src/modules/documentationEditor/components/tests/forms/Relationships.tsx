import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { panelLogger } from "@modules/logger";
import { Label, OptionType, Select } from "@uicore";
import { useEffect, useMemo, useState } from "react";
import { SetTestFormValue } from "../hooks/useTestFormValues";

interface Props {
  toValue?: string | undefined;
  fieldValue?: string | undefined;
  setValue: SetTestFormValue;
}

const Relationships = ({
  toValue,
  fieldValue,
  setValue,
}: Props): JSX.Element => {
  const [toFieldOptions, setToFieldOptions] = useState<OptionType[]>([]);
  const [toModelOptions, setToModelOptions] = useState<OptionType[]>([]);
  const [toSourceOptions, setToSourceOptions] = useState<OptionType[]>([]);

  const getColumnsOfModel = async (model: string) => {
    const matches = [...model.matchAll(/['"]([^'"]*)['"]/g)].map(
      (m) => m[1] ?? "",
    );
    const [first = "", second = ""] = matches;
    if (!matches.length) {
      panelLogger.info("No model name parsed", matches);
      return;
    }
    const columnsResult = (
      matches.length === 1
        ? await executeRequestInSync("getColumnsOfModel", { model: first })
        : await executeRequestInSync("getColumnsOfSources", {
            source: first,
            table: second,
          })
    ) as { columns: string[] };
    setToFieldOptions(
      columnsResult.columns.map((m) => ({ label: m, value: m })),
    );
  };

  useEffect(() => {
    Promise.all([
      executeRequestInSync("getModelsInProject"),
      executeRequestInSync("getSourcesInProject"),
    ])
      .then(([modelsResponse, sourcesResponse]) => {
        setToModelOptions(
          (modelsResponse as { models: string[] }).models.map((m) => ({
            label: `ref('${m}')`,
            value: `ref('${m}')`,
          })),
        );
        setToSourceOptions(
          (
            sourcesResponse as {
              sources: { name: string; tables: string[] }[];
            }
          ).sources.flatMap(({ name, tables }) =>
            tables.map((t) => ({
              label: `source('${name}', '${t}')`,
              value: `source('${name}', '${t}')`,
            })),
          ),
        );
      })
      .catch((err) => panelLogger.error("error while getting models", err));
  }, []);

  useEffect(() => {
    if (toValue) {
      getColumnsOfModel(toValue).catch((err) =>
        panelLogger.error(`error while fetching columns of ${toValue}`, err),
      );
    }
  }, [toValue]);

  const toOptions = useMemo(
    () => [...toModelOptions, ...toSourceOptions],
    [toModelOptions, toSourceOptions],
  );
  return (
    <div>
      <div style={{ marginBottom: "var(--spacing-xl)" }}>
        <Label htmlFor="relationship-to">To</Label>
        <Select
          id="relationship-to"
          name="to"
          required
          options={toOptions}
          value={toValue}
          onChange={(val) => setValue("to", val)}
        />
      </div>
      <div>
        <Label htmlFor="relationship-field">Field</Label>
        <Select
          id="relationship-field"
          name="field"
          required
          options={toFieldOptions}
          value={fieldValue}
          onChange={(val) => setValue("field", val)}
        />
      </div>
    </div>
  );
};

export default Relationships;
