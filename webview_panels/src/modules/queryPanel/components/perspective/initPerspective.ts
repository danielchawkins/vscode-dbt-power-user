import { panelLogger } from "@modules/logger";
import perspective from "@perspective-dev/client";
import serverWasm from "@perspective-dev/server/dist/wasm/perspective-server.wasm?url";
import perspectiveViewer from "@perspective-dev/viewer";
import viewerWasm from "@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm?url";

/**
 * Perspective does not load its WebAssembly on import: the engine and the viewer each need their `.wasm` before
 * first use. The `?url` imports make Vite emit both files and, with `base: "./"`, resolve them next to the loaded
 * bundle, which is the only origin a webview can fetch from. Only the wasm32 engine is registered.
 */
perspective.init_server(fetch(serverWasm));
perspectiveViewer
  .init_client(fetch(viewerWasm))
  .catch((error: unknown) =>
    panelLogger.error("perspective viewer wasm failed to load", error),
  );
