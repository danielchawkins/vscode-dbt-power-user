import {
  arrayOf,
  Fields,
  isAnything,
  isBoolean,
  isString,
  oneOf,
  optional,
  shape,
  syncRequestId,
} from "./guards.js";

/** The `args` of a host reply to a request that carried `syncRequestId`. */
export interface ResponseArgs<B = unknown> {
  syncRequestId?: string | undefined;
  body?: B | undefined;
  status: boolean;
  error?: string | undefined;
}

/** The host's reply to a panel request. */
export interface Response {
  command: "response";
  args: ResponseArgs;
}

/** Sent once by every panel when its listeners are attached. */
export interface WebviewReady {
  command: "webview:ready";
}

export interface OpenProblemsTab {
  command: "openProblemsTab";
}

/** Shows a notification; with `syncRequestId`, the reply body is the chosen item. */
export interface ShowNotification {
  command: "showInformationMessage" | "showWarningMessage";
  infoMessage: string;
  items?: string[] | undefined;
  syncRequestId?: string | undefined;
}

/** A warning or error shown in place of a panel's content. */
export interface PanelNotice {
  message: string;
  type: "warning" | "error";
}

export const responseFields: Fields<Omit<Response, "command">> = {
  args: shape<ResponseArgs>({
    syncRequestId,
    body: isAnything,
    status: isBoolean,
    error: optional(isString),
  }),
};

export const showNotificationFields: Fields<Omit<ShowNotification, "command">> =
  {
    infoMessage: isString,
    items: optional(arrayOf(isString)),
    syncRequestId,
  };

export const isPanelNotice = shape<PanelNotice>({
  message: isString,
  type: oneOf("warning", "error"),
});
