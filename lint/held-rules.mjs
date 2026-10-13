// Typed rules with no Oxlint home (D11). Configured nowhere, so none of them is enforced.
// Neither engine's config imports this file; only lintRules.test.ts reads it.
// A rule moves to oxlint.config.ts with its recorded severity and options once Oxlint ships a native port.

export const HELD_RULES = Object.freeze({
  host: Object.freeze({}),
  webview: Object.freeze({
    "@eslint-react/no-unused-props": Object.freeze({
      severity: "error",
      options: Object.freeze([]),
      needs: "type information (getParserServices)",
      watchFor: Object.freeze(["react/no-unused-props"]),
      unblock: "https://github.com/oxc-project/oxc/issues/26723",
    }),
  }),
});
