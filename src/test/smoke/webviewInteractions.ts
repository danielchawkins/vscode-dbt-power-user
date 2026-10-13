import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import {
  captureWorkbenchScreenshot,
  evaluatePanel,
  readWorkbenchNotificationTexts,
  revealWorkbench,
  sendCommand,
  SmokeHost,
  validateSmokeHost,
  waitForWebviewPaint,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import {
  checkpointCount,
  screenshotDirectory,
  VisualCheckpoint,
  writeCheckpoint,
} from "./visualEvidence";

/** A webview panel: the view container and command that show it, and the `body[data-entry]` its page sets. */
export interface PanelEntry {
  container: string;
  command: string;
  entry: string;
}

/** A DOM check. `role` and `name` pick the element; `absent` is a CSS selector that must match nothing. */
export type DomQuery =
  | {
      role: string;
      name?: string;
      expanded?: boolean;
      checked?: boolean;
      focused?: boolean;
    }
  | { absent: string };

const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;
const HTML_LIMIT = 4_000;

const KEYS = {
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
} as const;

/** Each frame runs the expression; only the frame whose `body[data-entry]` matches the panel answers. */
const FRAME_HELPERS = `
  const ROLE_SELECTORS = {
    button: "button, [role=button]",
    checkbox: "input[type=checkbox], [role=checkbox]",
    complementary: "aside, [role=complementary]",
    dialog: "[role=dialog]",
    spinbutton: "input[type=number], [role=spinbutton]",
  };
  const accessibleName = (node) =>
    [node.getAttribute("aria-label"), node.labels?.[0]?.textContent, node.textContent, node.title]
      .map((text) => (text ?? "").trim())
      .find((text) => text !== "") ?? "";
  const findByRole = (role, name) =>
    [...document.querySelectorAll(ROLE_SELECTORS[role] ?? \`[role=\${role}]\`)].find(
      (node) => name === undefined || accessibleName(node) === name,
    ) ?? null;
  const pointIn = (node, offset) => {
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = node.getBoundingClientRect();
    const x = rect.left + (offset ? offset[0] : rect.width / 2);
    const y = rect.top + (offset ? offset[1] : rect.height / 2);
    const inView =
      rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
    const rectText = [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(",");
    const detail = \`\${rectText} in \${innerWidth}x\${innerHeight}\`;
    return { found: inView, x, y, detail, html: node.outerHTML.slice(0, ${HTML_LIMIT}) };
  };
`;

function cdpPort(): string {
  const port = process.env.FPU_CDP_PORT;
  assert.ok(port, "smoke requires CDP port");
  return port;
}

function smokeHost(): SmokeHost {
  return validateSmokeHost(process.env[HARNESS_SWITCHES.smokeHost] ?? "");
}

/** Wraps `body` so it runs only in the frame showing `entry`, and returns `{ entry, ...result }` from it. */
function inFrame(entry: string, body: string): string {
  return `(() => {
    if (document.body.dataset.entry !== ${JSON.stringify(entry)}) return null;
    ${FRAME_HELPERS}
    return { entry: ${JSON.stringify(entry)}, ...(() => { ${body} })() };
  })()`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Raises the panel, then waits until its webview has painted. */
export async function showPanel(panel: PanelEntry): Promise<void> {
  await vscode.commands.executeCommand(panel.container);
  await vscode.commands.executeCommand(panel.command);
  await waitForWebviewPaint(cdpPort(), smokeHost(), panel.entry);
}

interface Located {
  found: boolean;
  x: number;
  y: number;
  detail: string;
  html: string;
}

/**
 * Polls until the element is laid out inside the webview's viewport, then returns the frame that holds it and a
 * point inside it. A point outside the viewport gets no click, so it is not accepted.
 */
async function locate(
  panel: PanelEntry,
  body: string,
  describe: string,
): Promise<{ frame: string; x: number; y: number }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last: Located | undefined;
  do {
    const match = await evaluatePanel<Located & { entry: string }>(
      cdpPort(),
      panel.entry,
      inFrame(panel.entry, body),
    );
    last = match?.value;
    if (match && last?.found) {
      return { frame: match.target, x: last.x, y: last.y };
    }
    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  throw new Error(
    `no clickable ${describe} in ${panel.entry}; rect and viewport: ${last?.detail ?? "no matching frame"}; ` +
      `element: ${last?.html ?? ""}`,
  );
}

/** Element by role and name, or by selector; `offset` is measured from its top-left corner, else its centre. */
const LOCATE_BY_ROLE = (role: string, name: string) => `
  const node = findByRole(${JSON.stringify(role)}, ${JSON.stringify(name)});
  return node ? pointIn(node) : { found: false, x: 0, y: 0, detail: "no element", html: "" };
`;

const LOCATE_BY_SELECTOR = (selector: string, offset?: [number, number]) => `
  const node = document.querySelector(${JSON.stringify(selector)});
  return node
    ? pointIn(node, ${offset ? JSON.stringify(offset) : "undefined"})
    : { found: false, x: 0, y: 0, detail: "no element", html: "" };
`;

/**
 * Mouse press and release on the frame's own target, with frame-local coordinates. Each command opens its own
 * socket, so the move goes first to put the pointer over the element before the press.
 */
async function dispatchClick(
  frame: string,
  x: number,
  y: number,
): Promise<void> {
  await sendCommand(frame, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
  await sendCommand(frame, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await sendCommand(frame, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

/** Clicks the element with `role` and accessible `name` inside the panel's webview, with real mouse input. */
export async function clickInWebview(
  panel: PanelEntry,
  target: { role: string; name: string },
): Promise<void> {
  const at = await locate(
    panel,
    LOCATE_BY_ROLE(target.role, target.name),
    `${target.role} "${target.name}"`,
  );
  await dispatchClick(at.frame, at.x, at.y);
}

/**
 * Clicks a point in the element matching `selector`: its centre, or `offset` from its top-left corner. For an empty
 * part of a canvas, pass an offset that misses the nodes.
 */
export async function clickWebviewPoint(
  panel: PanelEntry,
  at: { selector: string; offset?: [number, number] },
): Promise<void> {
  const point = await locate(
    panel,
    LOCATE_BY_SELECTOR(at.selector, at.offset),
    `element ${at.selector}`,
  );
  await dispatchClick(point.frame, point.x, point.y);
}

/**
 * Moves the pointer over the element matching `selector` without clicking. For a control whose label shows only on
 * hover, so its accessible name is absent until the pointer is over it.
 */
export async function hoverWebviewPoint(
  panel: PanelEntry,
  selector: string,
): Promise<void> {
  const point = await locate(
    panel,
    LOCATE_BY_SELECTOR(selector),
    `element ${selector}`,
  );
  await sendCommand(point.frame, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
}

/** Presses and releases `key` on the panel's webview, so the focused element receives it. */
export async function pressKeyInWebview(
  panel: PanelEntry,
  key: keyof typeof KEYS,
): Promise<void> {
  const point = await locate(
    panel,
    `return { found: true, x: 0, y: 0, html: "" };`,
    "webview frame",
  );
  await sendCommand(point.frame, "Input.dispatchKeyEvent", {
    type: "keyDown",
    ...KEYS[key],
  });
  await sendCommand(point.frame, "Input.dispatchKeyEvent", {
    type: "keyUp",
    ...KEYS[key],
  });
}

/** Whether the checkbox named `name` is checked when the call runs. */
export async function isWebviewChecked(
  panel: PanelEntry,
  name: string,
): Promise<boolean> {
  const match = await evaluatePanel<{ entry: string; checked: boolean | null }>(
    cdpPort(),
    panel.entry,
    inFrame(
      panel.entry,
      `const node = findByRole("checkbox", ${JSON.stringify(name)});
       return { checked: node ? node.checked : null };`,
    ),
  );
  const checked = match?.value.checked;
  assert.strictEqual(
    typeof checked,
    "boolean",
    `no checkbox "${name}" in ${panel.entry}`,
  );
  return checked as boolean;
}

/** Polls until the webview's DOM satisfies `query`, and fails with the matching element's outerHTML otherwise. */
export async function expectWebviewDom(
  panel: PanelEntry,
  query: DomQuery,
): Promise<void> {
  const check =
    "absent" in query
      ? `const node = document.querySelector(${JSON.stringify(query.absent)});
         return { ok: node === null, html: (node ?? document.body).outerHTML.slice(0, ${HTML_LIMIT}) };`
      : `const node = findByRole(${JSON.stringify(query.role)}, ${JSON.stringify(query.name)});
         const q = ${JSON.stringify(query)};
         const ok = node !== null &&
           (q.expanded === undefined || node.getAttribute("aria-expanded") === String(q.expanded)) &&
           (q.checked === undefined || node.checked === q.checked) &&
           (q.focused === undefined || (document.activeElement === node) === q.focused);
         return { ok, html: (node ?? document.body).outerHTML.slice(0, ${HTML_LIMIT}) };`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last: { ok: boolean; html: string } | undefined;
  do {
    const match = await evaluatePanel<{
      entry: string;
      ok: boolean;
      html: string;
    }>(cdpPort(), panel.entry, inFrame(panel.entry, check));
    last = match?.value;
    if (last?.ok) {
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  throw new Error(
    `expected ${JSON.stringify(query)} in ${panel.entry}; frame: ${last?.html ?? "no matching webview frame"}`,
  );
}

/** What the panel shows at capture time: each open dialog's text and the focused element's name. */
const readFrameState = (entry: string) =>
  inFrame(
    entry,
    `return {
      dialogs: [...document.querySelectorAll(ROLE_SELECTORS.dialog)].map((d) => d.innerText.trim().slice(0, 300)),
      focused: document.activeElement ? accessibleName(document.activeElement) : null,
    };`,
  );

const DOCS_ENTRY = "documentationEditor";

/** The model description, whether the editor marks it modified and offers Save, and the page's load time. */
const READ_DOCS = `(() => {
  if (document.body.dataset.entry !== "${DOCS_ENTRY}") return null;
  const input = document.querySelector("textarea");
  return {
    entry: "${DOCS_ENTRY}",
    description: input?.value ?? null,
    modified: document.body.innerText.includes("modified"),
    save: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Save"),
    timeOrigin: performance.timeOrigin,
  };
})()`;

/** The documentation editor's state as its frame reports it. */
export interface DocsState {
  entry: string;
  description: string | null;
  modified: boolean;
  save: boolean;
  timeOrigin: number;
}

/** Reads the documentation editor's state; undefined when its frame does not answer. */
export async function readDocsState(
  port: string,
): Promise<DocsState | undefined> {
  return (await evaluatePanel<DocsState>(port, DOCS_ENTRY, READ_DOCS))?.value;
}

/**
 * Polls until the documentation editor is clean: not marked modified and no Save offered. An empty description
 * matches at once, so a restore waits on the editor's state rather than on the text alone.
 */
export async function waitForDocsClean(port: string): Promise<DocsState> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last: DocsState | undefined;
  do {
    last = await readDocsState(port);
    if (last && !last.modified && !last.save) {
      return last;
    }
    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  throw new Error(
    `the editor never reported clean; last value: ${JSON.stringify(last)}`,
  );
}

/**
 * Checkpoints for interaction suites, in the same `<dir>/<host>/<fixture>/` sequence as the panel suites. Each one
 * records what the frame shows at capture time next to the checkpoint's own measurements. Undefined when
 * `FPU_SMOKE_SCREENSHOTS` is unset.
 */
export function interactionEvidence(host: SmokeHost) {
  const dir = screenshotDirectory();
  if (!dir) {
    return undefined;
  }
  const fixture = currentFixtureName() ?? "unknown-fixture";
  const fixtureDir = path.join(dir, host, fixture);
  let sequence = checkpointCount(fixtureDir);
  return {
    async capture(
      panel: PanelEntry,
      checkpoint: VisualCheckpoint,
    ): Promise<void> {
      await sleep(500);
      await revealWorkbench(cdpPort(), host);
      const shown = await evaluatePanel<{
        entry: string;
        dialogs: string[];
        focused: string | null;
      }>(cdpPort(), panel.entry, readFrameState(panel.entry));
      const png = await captureWorkbenchScreenshot(cdpPort(), host);
      const notifications = await readWorkbenchNotificationTexts(
        cdpPort(),
        host,
      );
      sequence += 1;
      const file = writeCheckpoint(
        fixtureDir,
        sequence,
        {
          ...checkpoint,
          measured: {
            ...checkpoint.measured,
            dialogs: shown?.value.dialogs ?? [],
            focused: shown?.value.focused ?? null,
            notifications,
          },
        },
        png,
        {
          host,
          fixture: currentFixtureName(),
          capturedAt: new Date().toISOString(),
        },
      );
      console.log(`FPU_SMOKE_SCREENSHOT=${file}`);
    },
  };
}
