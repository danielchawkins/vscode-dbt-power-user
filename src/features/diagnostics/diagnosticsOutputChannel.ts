import { OutputChannel } from "vscode";
import { stripANSI } from "../../core/text";

/** Writes the diagnostics report to `outputChannel`, which it disposes. */
export class DiagnosticsOutputChannel {
  constructor(private readonly outputChannel: OutputChannel) {}

  show(): void {
    this.outputChannel.show(true);
  }

  log(message: string): void {
    this.outputChannel.appendLine(stripANSI(message));
  }

  logNewLine(): void {
    this.outputChannel.appendLine("");
  }

  logLine(line: string): void {
    this.outputChannel.appendLine(stripANSI(line));
  }

  logHorizontalRule(): void {
    this.outputChannel.appendLine(
      "--------------------------------------------------------------------------",
    );
  }

  logBlock(block: string[]): void {
    this.logHorizontalRule();
    for (const line of block) {
      if (line) {
        this.logLine(line);
      }
    }
    this.logHorizontalRule();
  }

  logBlockWithHeader(header: string[], block: string[]): void {
    this.logHorizontalRule();
    for (const line of header) {
      this.logLine(line);
    }
    this.logHorizontalRule();
    for (const line of block) {
      this.logLine(line);
    }
    this.logHorizontalRule();
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}
