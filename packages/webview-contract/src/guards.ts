declare const checked: unique symbol;

/**
 * A type guard over a value that arrived through `postMessage`. `T` is invariant: a `Check<string>` is not a
 * `Check<string | undefined>`, so a check stricter or looser than its field's type is a compile error.
 */
export type Check<T> = ((value: unknown) => value is T) & {
  readonly [checked]?: (value: T) => T;
};

/**
 * One check per property of `T`, optional ones included. A missing or mistyped check is a compile error, as is an
 * extra key written in the object literal; keys arriving through a spread are not checked.
 */
export type Fields<T> = { readonly [K in keyof Required<T>]: Check<T[K]> };

/** What a message of command `C` carries besides `command`. */
type Payload<M extends { command: string }, C extends string> = M extends {
  command: infer K;
}
  ? C extends K
    ? Omit<M, "command">
    : never
  : never;

/** One field check map per command of `M`; a missing command, field or extra key is a compile error. */
export type CommandFields<M extends { command: string }> = {
  readonly [C in M["command"]]: Fields<Payload<M, C>>;
};

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const own = (value: object, key: string): unknown =>
  hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;

export const isRecord: Check<Record<string, unknown>> = (
  value,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isString: Check<string> = (value): value is string =>
  typeof value === "string";
export const isNumber: Check<number> = (value): value is number =>
  typeof value === "number";
export const isBoolean: Check<boolean> = (value): value is boolean =>
  typeof value === "boolean";
/** Accepts anything, including absence; only for fields typed `unknown`. */
export const isAnything: Check<unknown> = (_value): _value is unknown => true;

export const optional =
  <T>(check: Check<T>): Check<T | undefined> =>
  (value): value is T | undefined =>
    value === undefined || check(value);

export const nullable =
  <T>(check: Check<T>): Check<T | null> =>
  (value): value is T | null =>
    value === null || check(value);

/** Absent, `undefined` or `null`; for fields a sender copies from a manifest value or an optional chain. */
export const nullish = <T>(check: Check<T>): Check<T | null | undefined> =>
  optional(nullable(check));

export const arrayOf =
  <T>(check: Check<T>): Check<T[]> =>
  (value): value is T[] =>
    Array.isArray(value) && value.every((item) => check(item));

export const tuple =
  <T extends unknown[]>(...checks: { [K in keyof T]: Check<T[K]> }): Check<T> =>
  (value): value is T =>
    Array.isArray(value) &&
    value.length === checks.length &&
    checks.every((check, i) => check(value[i]));

export const oneOf =
  <const L extends readonly (string | number)[]>(
    ...literals: L
  ): Check<L[number]> =>
  (value): value is L[number] =>
    literals.includes(value as L[number]);

type Predicate = (value: unknown) => boolean;

const shapeOf =
  (fields: Readonly<Record<string, Predicate>>): Check<unknown> =>
  (value): value is unknown =>
    isRecord(value) &&
    Object.entries(fields).every(([key, check]) => check(own(value, key)));

/** An object whose own properties pass `fields`; other properties are allowed. */
export const shape = <T>(fields: Fields<NoInfer<T>>): Check<T> =>
  shapeOf(fields) as Check<T>;

/** The optional `syncRequestId` a panel request carries when it awaits a `response`. */
export const syncRequestId = optional(isString);

/** The commands whose fields declare `syncRequestId`, so the host answers them with a `response`. */
export const requestCommandsOf = <M extends { command: string }>(
  fields: CommandFields<M>,
): Extract<M, { syncRequestId?: string | undefined }>["command"][] =>
  Object.entries(fields)
    .filter(([, f]) => hasOwn(f as object, "syncRequestId"))
    .map(
      ([command]) =>
        command as Extract<
          M,
          { syncRequestId?: string | undefined }
        >["command"],
    );

/** A guard that dispatches on `command` and checks every field that command declares. */
export const messageGuard = <M extends { command: string }>(
  fields: CommandFields<M>,
): Check<M> => {
  const checks = new Map(
    Object.entries(fields).map(([command, f]) => [
      command,
      shapeOf(f as Record<string, Predicate>),
    ]),
  );
  return (value): value is M => {
    if (!isRecord(value)) {
      return false;
    }
    const check = checks.get(own(value, "command") as string);
    return check !== undefined && check(value);
  };
};
