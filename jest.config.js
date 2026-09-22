export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/src/test/integration/",
    "/src/test/smoke/",
  ],
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { useESM: true, tsconfig: "tsconfig.jest.json" },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  setupFiles: ["<rootDir>/src/test/jest-globals.ts"],
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  reporters: ["default", ["summary", { summaryThreshold: 1 }]],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/test/**",
    "!**/node_modules/**",
  ],
  coverageDirectory: "coverage",
  moduleNameMapper: {
    "^(\\.{1,2}/)+extensionRoot$": "<rootDir>/src/test/mock/extensionRoot.ts",
    "^vscode$": "<rootDir>/src/test/mock/vscode.ts",
    "^vscode-languageclient/node$":
      "<rootDir>/src/test/mock/vscode-languageclient-node.ts",
    "^node-fetch$": "<rootDir>/src/test/mock/node-fetch.ts",
    "^@altimateai/dbt-integration$": "@altimateai/dbt-integration",
    "^@extension$": "<rootDir>/src/modules.ts",
  },
};
