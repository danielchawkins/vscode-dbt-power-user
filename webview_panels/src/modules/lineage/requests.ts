import { lineage } from "@fusion-power-user/webview-contract";
import { panelRequests, RequestCommand } from "@modules/app/requestExecutor";

type PanelMessage = lineage.PanelMessage;
type LineageRequest = RequestCommand<PanelMessage>;

export const { executeRequestInSync, executeRequestInAsync } =
  panelRequests<PanelMessage>();

const requestCommands: readonly string[] = lineage.requestCommands;

/** True for a lineage request command; the vendored component names its requests with plain strings. */
export const isLineageRequest = (url: string): url is LineageRequest =>
  requestCommands.includes(url);

/**
 * Sends a request the vendored component made, wrapping its `params` as every lineage request does. The
 * component's parameters are untyped, so the host's guard is what checks them.
 */
export const requestFromComponent = (
  command: LineageRequest,
  params: Record<string, unknown>,
): Promise<unknown> =>
  (
    executeRequestInSync as (
      command: LineageRequest,
      payload: { args: { params: Record<string, unknown> } },
    ) => Promise<unknown>
  )(command, { args: { params } });
