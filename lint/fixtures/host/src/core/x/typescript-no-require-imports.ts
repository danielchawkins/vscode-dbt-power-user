// lint-expect: oxlint typescript/no-require-imports
const fs = require("fs");
export const exists = typeof fs;
