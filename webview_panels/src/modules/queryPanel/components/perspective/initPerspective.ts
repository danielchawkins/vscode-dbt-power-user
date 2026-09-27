import perspective from "@finos/perspective";
import perspectiveViewer from "@finos/perspective-viewer";
import { panelLogger } from "@modules/logger";

/**
 * Perspective 3 does not load its WebAssembly on import: the engine and the viewer each need their `.wasm`
 * before first use. `new URL(<relative path>, import.meta.url)` makes Vite emit both files and, with
 * `base: "./"`, resolve them next to the loaded bundle, which is the only origin a webview can fetch from.
 */
perspective.init_server(
  fetch(
    new URL(
      "../../../../../node_modules/@finos/perspective/dist/wasm/perspective-server.wasm",
      import.meta.url,
    ),
  ),
);
perspectiveViewer
  .init_client(
    fetch(
      new URL(
        "../../../../../node_modules/@finos/perspective-viewer/dist/wasm/perspective-viewer.wasm",
        import.meta.url,
      ),
    ),
  )
  .catch((error: unknown) =>
    panelLogger.error("perspective viewer wasm failed to load", error),
  );
