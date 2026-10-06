import Prism from "prismjs/components/prism-core";

// The grammar modules read a global `Prism`, which a test DOM's `window` does not share with `globalThis`.
// `manual` stops Prism from highlighting the page itself.
(globalThis as { Prism?: unknown }).Prism = Prism;
Prism.manual = true;

export default Prism;
