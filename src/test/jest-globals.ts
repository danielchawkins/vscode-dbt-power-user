import { jest } from "@jest/globals";

// ESM tests need the jest global; module mocks need jest.unstable_mockModule.
(globalThis as typeof globalThis & { jest: typeof jest }).jest = jest;
