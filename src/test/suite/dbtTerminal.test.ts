import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mocked,
  vi,
} from "vitest";
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
});
