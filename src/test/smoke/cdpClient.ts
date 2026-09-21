interface CdpTarget {
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface ExecutionContext {
  id: number;
}

export interface WebviewPaintMetric {
  viewPath: string;
  timeOrigin: number;
  firstContentfulPaint: number;
  bodyText: string;
  stylesheets: string[];
  codiconFont: boolean;
}

export async function waitForWebviewPaint(
  port: string,
  viewPath: string,
  attempts = 100,
): Promise<WebviewPaintMetric> {
  let lastValue: WebviewPaintMetric | undefined;
  let lastTargets: CdpTarget[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastTargets = await listTargets(port);
      const frames = lastTargets.filter(
        (target) => target.type === "iframe" && target.webSocketDebuggerUrl,
      );
      for (const frame of frames) {
        let values: unknown[];
        try {
          values = await evaluateContexts(
            frame.webSocketDebuggerUrl!,
            `(async () => {
              await document.fonts.load("12px codicon");
              return {
                viewPath: globalThis.viewPath,
                timeOrigin: performance.timeOrigin,
                firstContentfulPaint: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
                bodyText: document.body?.innerText.trim().slice(0, 100),
                stylesheets: [...document.styleSheets].map(({ href }) => href).filter(Boolean),
                codiconFont: document.fonts.check("12px codicon")
              };
            })()`,
          );
        } catch {
          continue;
        }
        const value = values.find(
          (candidate): candidate is WebviewPaintMetric =>
            isWebviewPaintMetric(candidate) && candidate.viewPath === viewPath,
        );
        lastValue = value ?? lastValue;
        if (
          value &&
          value.bodyText &&
          value.stylesheets.some((href) => href.endsWith("/main.css")) &&
          value.stylesheets.some((href) => href.endsWith("/codicon.css")) &&
          value.codiconFont
        ) {
          return value;
        }
      }
    } catch {
      // The CDP endpoint can be briefly unavailable while a view is attaching.
    }
    await sleep(100);
  }
  throw new Error(
    `Webview did not render with required assets: ${viewPath} ${JSON.stringify({
      lastValue,
      targets: lastTargets.map(({ type, title, url }) => ({
        type,
        title,
        url,
      })),
    })}`,
  );
}

async function listTargets(port: string): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP target request failed: ${response.status}`);
  }
  return (await response.json()) as CdpTarget[];
}

function evaluateContexts(
  webSocketUrl: string,
  expression: string,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const contexts: ExecutionContext[] = [];
    const evaluations = new Map<number, unknown>();
    let expected = 0;
    const timeout = setTimeout(
      () =>
        reject(new Error(`CDP context evaluation timed out: ${webSocketUrl}`)),
      5_000,
    );
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.executionContextCreated") {
        contexts.push(message.params.context);
        return;
      }
      if (message.id === 1) {
        expected = contexts.length;
        if (expected === 0) {
          clearTimeout(timeout);
          socket.close();
          resolve([]);
          return;
        }
        contexts.forEach((context, index) => {
          socket.send(
            JSON.stringify({
              id: 100 + index,
              method: "Runtime.evaluate",
              params: {
                contextId: context.id,
                expression,
                awaitPromise: true,
                returnByValue: true,
              },
            }),
          );
        });
        return;
      }
      if (typeof message.id !== "number" || message.id < 100) {
        return;
      }
      evaluations.set(
        message.id,
        message.error || message.result.exceptionDetails
          ? undefined
          : message.result.result.value,
      );
      if (evaluations.size === expected) {
        clearTimeout(timeout);
        socket.close();
        resolve(contexts.map((_, index) => evaluations.get(100 + index)));
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`CDP socket failed: ${webSocketUrl}`));
    });
  });
}

function isWebviewPaintMetric(value: unknown): value is WebviewPaintMetric {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WebviewPaintMetric>;
  return (
    typeof candidate.viewPath === "string" &&
    typeof candidate.timeOrigin === "number" &&
    typeof candidate.firstContentfulPaint === "number" &&
    typeof candidate.bodyText === "string" &&
    Array.isArray(candidate.stylesheets) &&
    typeof candidate.codiconFont === "boolean"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
