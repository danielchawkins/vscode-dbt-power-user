import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mocked,
  vi,
} from "vitest";
import * as vscode from "vscode";
import { VSCodeDBTTerminal } from "../../dbt_client/vscodeTerminal";
import { DBTTerminal } from "../../dbt_integration";

// Set test environment
process.env.NODE_ENV = "test";

describe("DBTTerminal Test Suite", () => {
  let mockOutputChannel: Mocked<any>;
  let terminal: DBTTerminal;

  beforeEach(() => {
    mockOutputChannel = {
      appendLine: vi.fn(),
      show: vi.fn(),
      clear: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      dispose: vi.fn(),
    };

    terminal = new VSCodeDBTTerminal();
    // @ts-ignore - Manually set the output channel
    terminal.outputChannel = mockOutputChannel;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should log messages with proper formatting", () => {
    const message = "Test message";
    terminal.log(message);
    expect(mockOutputChannel.info).toHaveBeenCalledWith(message, []);
  });

  it("should handle errors with proper error message formatting", () => {
    const name = "test_error";
    const message = "Test error message";
    const error = new Error("Test error details");
    terminal.error(name, message, error);
    expect(mockOutputChannel.error).toHaveBeenCalledWith(
      `${name}:${message}:${error.message}`,
      [],
    );
  });

  it("should show and hide terminal based on status", async () => {
    const mockTerminal = {
      show: vi.fn(),
      dispose: vi.fn(),
    };

    // @ts-ignore - Mocking terminal
    terminal.terminal = mockTerminal;

    // Test showing terminal
    await terminal.show(true);
    expect(mockTerminal.show).toHaveBeenCalledWith(false);

    // Reset the mock for the next test
    vi.clearAllMocks();

    // Test not showing terminal
    await terminal.show(false);
    expect(mockTerminal.show).not.toHaveBeenCalled();
  });

  it("should properly handle trace messages", () => {
    const message = "Test trace message";
    terminal.trace(message);
    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(message);
  });

  it("should properly handle debug messages", () => {
    const name = "test_debug";
    const message = "Test debug message";
    terminal.debug(name, message);
    expect(mockOutputChannel.debug).toHaveBeenCalledWith(
      `${name}:${message}`,
      [],
    );
  });

  it("drops writes after dispose and disposes once", () => {
    terminal.dispose();
    terminal.dispose();
    terminal.log("late");
    terminal.trace("late");
    terminal.debug("n", "late");
    terminal.info("n", "late");
    terminal.warn("n", "late");
    terminal.error("n", "late", new Error("e"));
    expect(mockOutputChannel.dispose).toHaveBeenCalledTimes(1);
    expect(mockOutputChannel.info).not.toHaveBeenCalled();
    expect(mockOutputChannel.appendLine).not.toHaveBeenCalled();
    expect(mockOutputChannel.debug).not.toHaveBeenCalled();
    expect(mockOutputChannel.warn).not.toHaveBeenCalled();
    expect(mockOutputChannel.error).not.toHaveBeenCalled();
  });

  it("should properly dispose of all disposables", () => {
    const mockDisposable1 = { dispose: vi.fn() };
    const mockDisposable2 = { dispose: vi.fn() };
    // @ts-ignore - Set private disposables for testing
    terminal.disposables = [mockDisposable1, mockDisposable2];
    terminal.dispose();
    expect(mockDisposable1.dispose).toHaveBeenCalled();
    expect(mockDisposable2.dispose).toHaveBeenCalled();
    expect(mockOutputChannel.dispose).toHaveBeenCalled();
    // @ts-ignore - Check private disposables for testing
    expect(terminal.disposables.length).toBe(0);
  });

  it("should properly initialize and dispose terminal", async () => {
    // Mock vscode.window.createTerminal
    const mockTerminal = {
      dispose: vi.fn(),
      show: vi.fn(),
    };

    const createTerminalMock = vi
      .spyOn(vscode.window, "createTerminal")
      .mockReturnValue(mockTerminal as unknown as vscode.Terminal);

    // Create a new terminal instance
    const newTerminal = new VSCodeDBTTerminal();
    await newTerminal.show(true);

    // Verify terminal was created with correct parameters
    expect(createTerminalMock).toHaveBeenCalled();
    const createTerminalArgs = createTerminalMock.mock.calls[0][0];
    expect(createTerminalArgs.name).toBe("Tasks - dbt");
    expect(typeof createTerminalArgs.pty.onDidWrite).toBe("function");
    expect(typeof createTerminalArgs.pty.open).toBe("function");
    expect(typeof createTerminalArgs.pty.close).toBe("function");

    // Test terminal disposal
    newTerminal.dispose();
    expect(mockTerminal.dispose).toHaveBeenCalled();

    // Cleanup
    createTerminalMock.mockRestore();
  });
});
