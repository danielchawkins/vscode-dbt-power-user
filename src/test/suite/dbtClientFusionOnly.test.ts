import { DBTDetection } from "@altimateai/dbt-integration";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Memento, window } from "vscode";
import { DBTClient } from "../../dbt_client";
import { PythonEnvironment } from "../../dbt_client/pythonEnvironment";

afterEach(() => {
  jest.clearAllMocks();
});

describe("DBTClient Fusion-only prompts", () => {
  it("shows a missing Fusion installation error once", async () => {
    const client = new DBTClient(
      {} as PythonEnvironment,
      jest.fn() as (globalState: Memento | undefined) => DBTDetection,
    );
    jest.mocked(window.showErrorMessage).mockResolvedValue(undefined as never);

    await client.showErrorIfDbtIsNotInstalled();
    await client.showErrorIfDbtIsNotInstalled();

    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "Please ensure dbt Fusion CLI is installed.",
    );
  });
});
