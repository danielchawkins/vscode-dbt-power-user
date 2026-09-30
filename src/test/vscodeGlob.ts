/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *  Minimal, restructured copy of `splitGlobAware`, `starsToRegExp` and `parseRegExp` from VS Code's
 *  `src/vs/base/common/glob.ts`, used as the test oracle for `files.associations` patterns.
 *--------------------------------------------------------------------------------------------*/

const GLOBSTAR = "**";
const GLOB_SPLIT = "/";
const PATH_REGEX = "[/\\\\]";
const NO_PATH_REGEX = "[^/\\\\]";

function escapeRegExpCharacters(value: string): string {
  return value.replace(/[\\{}*+?|^$.[\]()]/g, "\\$&");
}

function starsToRegExp(starCount: number, isLastPattern?: boolean): string {
  switch (starCount) {
    case 0:
      return "";
    case 1:
      return `${NO_PATH_REGEX}*?`;
    default:
      return `(?:${PATH_REGEX}|${NO_PATH_REGEX}+${PATH_REGEX}${isLastPattern ? `|${PATH_REGEX}${NO_PATH_REGEX}+` : ""})*?`;
  }
}

function splitGlobAware(pattern: string, splitChar: string): string[] {
  if (!pattern) {
    return [];
  }
  const segments: string[] = [];
  let inBraces = false;
  let inBrackets = false;
  let curVal = "";
  for (const char of pattern) {
    switch (char) {
      case splitChar:
        if (!inBraces && !inBrackets) {
          segments.push(curVal);
          curVal = "";
          continue;
        }
        break;
      case "{":
        inBraces = true;
        break;
      case "}":
        inBraces = false;
        break;
      case "[":
        inBrackets = true;
        break;
      case "]":
        inBrackets = false;
        break;
    }
    curVal += char;
  }
  if (curVal) {
    segments.push(curVal);
  }
  return segments;
}

function bracketChar(char: string, bracketVal: string): string {
  if (char === "-") {
    return char;
  }
  if ((char === "^" || char === "!") && !bracketVal) {
    return "^";
  }
  return char === GLOB_SPLIT ? "" : escapeRegExpCharacters(char);
}

function plainChar(char: string): string {
  if (char === "?") {
    return NO_PATH_REGEX;
  }
  return char === "*" ? starsToRegExp(1) : escapeRegExpCharacters(char);
}

function segmentToRegExp(segment: string): string {
  let regEx = "";
  let inBraces = false;
  let braceVal = "";
  let inBrackets = false;
  let bracketVal = "";
  for (const char of segment) {
    if (char !== "}" && inBraces) {
      braceVal += char;
    } else if (inBrackets && (char !== "]" || !bracketVal)) {
      bracketVal += bracketChar(char, bracketVal);
    } else if (char === "{") {
      inBraces = true;
    } else if (char === "[") {
      inBrackets = true;
    } else if (char === "}") {
      const choices = splitGlobAware(braceVal, ",");
      regEx += `(?:${choices.map((choice) => parseRegExp(choice)).join("|")})`;
      inBraces = false;
      braceVal = "";
    } else if (char === "]") {
      regEx += "[" + bracketVal + "]";
      inBrackets = false;
      bracketVal = "";
    } else {
      regEx += plainChar(char);
    }
  }
  return regEx;
}

function parseRegExp(pattern: string): string {
  if (!pattern) {
    return "";
  }
  let regEx = "";
  const segments = splitGlobAware(pattern, GLOB_SPLIT);
  if (segments.every((segment) => segment === GLOBSTAR)) {
    return ".*";
  }
  let previousSegmentWasGlobStar = false;
  segments.forEach((segment, index) => {
    if (segment === GLOBSTAR) {
      if (previousSegmentWasGlobStar) {
        return;
      }
      regEx += starsToRegExp(2, index === segments.length - 1);
    } else {
      regEx += segmentToRegExp(segment);
      if (
        index < segments.length - 1 &&
        (segments[index + 1] !== GLOBSTAR || index + 2 < segments.length)
      ) {
        regEx += PATH_REGEX;
      }
    }
    previousSegmentWasGlobStar = segment === GLOBSTAR;
  });
  return regEx;
}

/** Whether VS Code's glob `pattern` matches `path`; an invalid pattern matches nothing. */
export function match(
  pattern: string,
  path: string,
  ignoreCase = false,
): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }
  try {
    return new RegExp(
      `^${parseRegExp(trimmed)}$`,
      ignoreCase ? "i" : undefined,
    ).test(path);
  } catch {
    return false;
  }
}
