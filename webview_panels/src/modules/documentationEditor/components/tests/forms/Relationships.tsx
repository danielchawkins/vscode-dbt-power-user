import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { panelLogger } from "@modules/logger";
import { Label, OptionType, Select } from "@uicore";
import { useEffect, useMemo, useState } from "react";
import { SetTestFormValue } from "../hooks/useTestFormValues";

interface Props {
  toValue?: string;
  fieldValue?: string;
  setValue: SetTestFormValue;
}

const option = (value?: string) => (value ? { label: value, value } : null);

const Relationships = ({
  toValue,
  fieldValue,
  setValue,
}: Props): JSX.Element => {
  const [toFieldOptions, setToFieldOptions] = useState<OptionType[]>([]);
  const [toModelOptions, setModels] = useState<OptionType[]>([]);
  const [toSourceOptions, setSources] = useState<OptionType[]>([]);

  const getColumnsOfModel = async (model: string) => {
    const matches = [...model.matchAll(/['"]([^'"]*)['"]/g)].map((m) => m[1]);
    if (!matches.length) {
      panelLogger.info("No model name parsed", matches);
      return;
    }
    const columnsResult = (
      matches.length === 1
        ? await executeRequestInSync("getColumnsOfModel", { model: matches[0] })
        : await executeRequestInSync("getColumnsOfSources", {
            source: matches[0],
            table: matches[1],
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
        setModels(
          (modelsResponse as { models: string[] }).models.map((m) => ({
            label: `ref('${m}')`,
            value: `ref('${m}')`,
          })),
        );
        setSources(
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
          inputId="relationship-to"
          name="to"
          required
          openMenuOnFocus
          options={toOptions}
          value={option(toValue)}
          onChange={(val: unknown) => setValue("to", (val as OptionType).value)}
        />
      </div>
      <div>
        <Label htmlFor="relationship-field">Field</Label>
        <Select
          inputId="relationship-field"
          name="field"
          required
          openMenuOnFocus
          options={toFieldOptions}
          value={option(fieldValue)}
          onChange={(val: unknown) =>
            setValue("field", (val as OptionType).value)
          }
        />
      </div>
    </div>
  );
};

export default Relationships;
