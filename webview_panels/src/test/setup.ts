import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const vscodeApiMock = {
  postMessage: vi.fn(),
  getState: vi.fn(() => undefined),
  setState: vi.fn(),
};

export function getVsCodeApiMock(): typeof vscodeApiMock {
  return vscodeApiMock;
}

Object.defineProperty(globalThis, "acquireVsCodeApi", {
  value: () => vscodeApiMock,
  writable: true,
  configurable: true,
});

window.viewPath = "/";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vscodeApiMock.postMessage.mockClear();
  vscodeApiMock.getState.mockClear();
  vscodeApiMock.setState.mockClear();
  document.body.className = "vscode-dark";
});
