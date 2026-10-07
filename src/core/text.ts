export function stripANSI(src: string): string {
  return src.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}

export function getFormattedDateTime(): string {
  const now = new Date();

  const date = now.toLocaleDateString("en-GB").replace(/\//g, "-");
  const time = now
    .toLocaleTimeString("en-GB", { hour12: false })
    .replace(/:/g, "-");

  return `${date}-${time}`;
}

export const getStringSizeInMb = (str: string): number => {
  let sizeInBytes = 0;
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    if (charCode <= 0x7f) {
      sizeInBytes += 1;
    } else if (charCode <= 0x7ff) {
      sizeInBytes += 2;
    } else if (charCode <= 0xffff) {
      sizeInBytes += 3;
    } else {
      sizeInBytes += 4;
    }
  }
  const sizeInMB = sizeInBytes / (1024 * 1024);
  return sizeInMB;
};

export function removeProtocol(input: string): string {
  return input.replace(/^[^:]+:\/\//, "");
}

/**
 * Extract the dbt subcommand from a full command string.
 * "dbt build --select model" → "build"
 */
export function extractDbtSubcommand(command: string): string {
  return command.startsWith("dbt ") ? command.split(" ")[1] : command;
}
