import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { panelLogger } from "@modules/logger";
import type { OptionType } from "@uicore";
import { Label, Select } from "@uicore";
import { useEffect, useMemo, useState } from "react";
import type { SetTestFormValue } from "../hooks/useTestFormValues";

interface Props {
  toValue?: string | undefined;
  fieldValue?: string | undefined;
  setValue: SetTestFormValue;
}

/** The column options of a `ref('m')` or `source('s', 't')` target; undefined when no name parses. */
async function fetchColumnOptions(
  model: string,
): Promise<OptionType[] | undefined> {
  const matches = Array.from(
    model.matchAll(/['"]([^'"]*)['"]/g),
    (m) => m[1] ?? "",
  );
  const [first = "", second = ""] = matches;
  if (!matches.length) {
    panelLogger.info("No model name parsed", matches);
    return undefined;
  }
  const columnsResult =
    matches.length === 1
      ? await executeRequestInSync("getColumnsOfModel", { model: first })
      : await executeRequestInSync("getColumnsOfSources", {
          source: first,
          table: second,
        });
  return columnsResult.columns.map((m) => ({ label: m, value: m }));
}

/**
 * The `ref` and `source` target options. With no manifest the host sends no lists; this throws then, and the caller
 * logs it, as it always has.
 */
function targetOptions(
  models: string[] | undefined,
  sources: { name: string; tables: string[] }[] | undefined,
): { models: OptionType[]; sources: OptionType[] } {
  return {
    models: models!.map((m) => ({
      label: `ref('${m}')`,
      value: `ref('${m}')`,
    })),
    sources: sources!.flatMap(({ name, tables }) =>
      tables.map((t) => ({
        label: `source('${name}', '${t}')`,
        value: `source('${name}', '${t}')`,
      })),
    ),
  };
}

const Relationships = ({
  toValue,
  fieldValue,
  setValue,
}: Props): React.JSX.Element => {
  const [toFieldOptions, setToFieldOptions] = useState<OptionType[]>([]);
  const [toModelOptions, setToModelOptions] = useState<OptionType[]>([]);
  const [toSourceOptions, setToSourceOptions] = useState<OptionType[]>([]);

  useEffect(() => {
    Promise.all([
      executeRequestInSync("getModelsInProject"),
      executeRequestInSync("getSourcesInProject"),
    ])
      .then(([modelsResponse, sourcesResponse]) => {
        const options = targetOptions(
          modelsResponse.models,
          sourcesResponse.sources,
        );
        setToModelOptions(options.models);
        setToSourceOptions(options.sources);
      })
      .catch((err) => panelLogger.error("error while getting models", err));
  }, []);

  useEffect(() => {
    if (!toValue) {
      return;
    }
    let current = true;
    fetchColumnOptions(toValue).then(
      (options) => {
        if (current && options) {
          setToFieldOptions(options);
        }
      },
      (err: unknown) =>
        panelLogger.error(`error while fetching columns of ${toValue}`, err),
    );
    return () => {
      current = false;
    };
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
