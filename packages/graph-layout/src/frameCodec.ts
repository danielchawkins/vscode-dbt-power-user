/**
 * The primitives of the columnar frame (ADR 0011, Decision 6): the error it throws, the UTF-8 codec, and the writer and
 * reader of its header, blob and columns. `frame.ts` composes them into `encodeGraph`, `decodeGraph`, `encodeLayout` and
 * `decodeLayout`; the layout of the bytes is described in `frame.ts`.
 */

const MAGIC = "GLFR";
const VERSION = 1;
export const KIND_GRAPH = 1;
export const KIND_LAYOUT = 2;
const TAG_U8 = 1;
const TAG_U32 = 2;
const TAG_F64 = 3;
const TAG_TEXT = 4;
const HEADER_BYTES = 12;
const MAX_U32 = 0xffff_ffff;

/** A frame that does not decode, or a value the frame cannot hold. */
export class FrameError extends Error {
  constructor(message: string) {
    super(`graph layout frame: ${message}`);
  }
}

/**
 * The UTF-8 bytes of `text`. The package's lib leaves out `TextEncoder`, so this uses `encodeURIComponent`, which writes
 * every byte that is not an unreserved ASCII character as `%XX`. A lone surrogate is not well-formed text, so it throws.
 */
function utf8Encode(text: string): Uint8Array {
  let escaped: string;
  try {
    escaped = encodeURIComponent(text);
  } catch {
    throw new FrameError(
      "a text holds a lone surrogate, which is not UTF-16 text",
    );
  }
  const bytes: number[] = [];
  for (let at = 0; at < escaped.length; at++) {
    if (escaped[at] === "%") {
      bytes.push(Number.parseInt(escaped.slice(at + 1, at + 3), 16));
      at += 2;
    } else {
      bytes.push(escaped.charCodeAt(at));
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * The text of UTF-8 `bytes`. Every byte is written as `%XX`, so `decodeURIComponent` reads it as UTF-8 and throws a
 * `URIError` on a sequence that is not UTF-8, which the caller reports as a `FrameError`.
 */
function utf8Decode(bytes: Uint8Array): string {
  let escaped = "";
  for (const byte of bytes) {
    escaped += `%${byte.toString(16).padStart(2, "0")}`;
  }
  return decodeURIComponent(escaped);
}

function checkedU32(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new FrameError(`${what} ${value} does not fit a u32`);
  }
  return value;
}

/** Builds one frame: the columns, and the blob their texts point into. */
export class Writer {
  readonly #columns: Uint8Array[] = [];
  readonly #blob: Uint8Array[] = [];
  #blobLength = 0;

  #column(tag: number, rows: number, payload: Uint8Array): void {
    const head = new Uint8Array(5);
    head[0] = tag;
    new DataView(head.buffer).setUint32(1, checkedU32(rows, "row count"), true);
    this.#columns.push(head, payload);
  }

  bytes(values: readonly number[]): void {
    this.#column(TAG_U8, values.length, Uint8Array.from(values));
  }

  bools(values: readonly boolean[]): void {
    this.bytes(values.map((value) => (value ? 1 : 0)));
  }

  u32s(values: readonly number[]): void {
    const payload = new Uint8Array(values.length * 4);
    const view = new DataView(payload.buffer);
    values.forEach((value, row) =>
      view.setUint32(row * 4, checkedU32(value, "value"), true),
    );
    this.#column(TAG_U32, values.length, payload);
  }

  f64s(values: readonly number[]): void {
    const payload = new Uint8Array(values.length * 8);
    const view = new DataView(payload.buffer);
    values.forEach((value, row) => view.setFloat64(row * 8, value, true));
    this.#column(TAG_F64, values.length, payload);
  }

  texts(values: readonly string[]): void {
    const payload = new Uint8Array((values.length + 1) * 4);
    const view = new DataView(payload.buffer);
    values.forEach((value, row) => {
      view.setUint32(
        row * 4,
        checkedU32(this.#blobLength, "blob offset"),
        true,
      );
      const encoded = utf8Encode(value);
      this.#blob.push(encoded);
      this.#blobLength += encoded.length;
    });
    view.setUint32(
      values.length * 4,
      checkedU32(this.#blobLength, "blob offset"),
      true,
    );
    this.#column(TAG_TEXT, values.length, payload);
  }

  optTexts(values: readonly (string | undefined)[]): void {
    this.bytes(values.map((value) => (value === undefined ? 0 : 1)));
    this.texts(values.map((value) => value ?? ""));
  }

  optF64s(values: readonly (number | undefined)[]): void {
    this.bytes(values.map((value) => (value === undefined ? 0 : 1)));
    this.f64s(values.map((value) => value ?? 0));
  }

  optBools(values: readonly (boolean | undefined)[]): void {
    this.bytes(
      values.map((value) => {
        if (value === undefined) {
          return 0;
        }
        return value ? 2 : 1;
      }),
    );
  }

  finish(kind: number): Uint8Array {
    const head = new Uint8Array(HEADER_BYTES + 4);
    const view = new DataView(head.buffer);
    head.set(utf8Encode(MAGIC), 0);
    view.setUint32(4, VERSION, true);
    view.setUint32(8, kind, true);
    view.setUint32(12, checkedU32(this.#blobLength, "blob length"), true);
    const parts = [head, ...this.#blob, ...this.#columns];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/** Reads one frame: the header and blob first, then the columns in order, each checked against what the caller expects. */
export class Reader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  readonly #blob: Uint8Array;
  #at = 0;

  constructor(bytes: Uint8Array, kind: number) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (String.fromCharCode(...this.#take(4)) !== MAGIC) {
      throw new FrameError("the magic is not GLFR");
    }
    const version = this.#u32("version");
    if (version !== VERSION) {
      throw new FrameError(`version ${version} is not ${VERSION}`);
    }
    const found = this.#u32("kind");
    if (found !== kind) {
      throw new FrameError(`kind ${found} is not ${kind}`);
    }
    this.#blob = this.#take(this.#u32("blob length"));
  }

  #take(count: number): Uint8Array {
    if (this.#at + count > this.#bytes.length) {
      throw new FrameError("the bytes end inside a field");
    }
    const out = this.#bytes.subarray(this.#at, this.#at + count);
    this.#at += count;
    return out;
  }

  #u32(what: string): number {
    if (this.#at + 4 > this.#bytes.length) {
      throw new FrameError(`the bytes end inside ${what}`);
    }
    const value = this.#view.getUint32(this.#at, true);
    this.#at += 4;
    return value;
  }

  #column(name: string, tag: number, rows: number | undefined): number {
    const [found] = this.#take(1);
    if (found !== tag) {
      throw new FrameError(`${name} is not a column of type ${tag}`);
    }
    const count = this.#u32(name);
    if (rows !== undefined && count !== rows) {
      throw new FrameError(`${name} has ${count} rows, not ${rows}`);
    }
    return count;
  }

  #u32s(count: number): number[] {
    const at = this.#at;
    this.#take(count * 4);
    return Array.from({ length: count }, (_, row) =>
      this.#view.getUint32(at + row * 4, true),
    );
  }

  #f64s(count: number): number[] {
    const at = this.#at;
    this.#take(count * 8);
    return Array.from({ length: count }, (_, row) =>
      this.#view.getFloat64(at + row * 8, true),
    );
  }

  bytes(name: string, rows?: number): number[] {
    const count = this.#column(name, TAG_U8, rows);
    return [...this.#take(count)];
  }

  bools(name: string, rows?: number): boolean[] {
    return this.bytes(name, rows).map((value) => {
      if (value > 1) {
        throw new FrameError(`${name} holds ${value}, not a boolean`);
      }
      return value === 1;
    });
  }

  u32s(name: string, rows?: number): number[] {
    return this.#u32s(this.#column(name, TAG_U32, rows));
  }

  f64s(name: string, rows?: number): number[] {
    return this.#f64s(this.#column(name, TAG_F64, rows));
  }

  texts(name: string, rows?: number): string[] {
    const count = this.#column(name, TAG_TEXT, rows);
    const offsets = this.#u32s(count + 1);
    return offsets.slice(0, count).map((start, row) => {
      const end = offsets[row + 1] ?? start;
      if (start > end || end > this.#blob.length) {
        throw new FrameError(`${name} has an offset outside the blob`);
      }
      try {
        return utf8Decode(this.#blob.subarray(start, end));
      } catch {
        throw new FrameError(`${name} holds text that is not UTF-8`);
      }
    });
  }

  optTexts(name: string, rows: number): (string | undefined)[] {
    const present = this.bools(name, rows);
    const texts = this.texts(name, rows);
    return present.map((here, row) => (here ? texts[row] : undefined));
  }

  optF64s(name: string, rows: number): (number | undefined)[] {
    const present = this.bools(name, rows);
    const values = this.f64s(name, rows);
    return present.map((here, row) => (here ? values[row] : undefined));
  }

  optBools(name: string, rows: number): (boolean | undefined)[] {
    return this.bytes(name, rows).map((value) => {
      if (value > 2) {
        throw new FrameError(`${name} holds ${value}, not an optional boolean`);
      }
      return value === 0 ? undefined : value === 2;
    });
  }

  end(): void {
    if (this.#at !== this.#bytes.length) {
      throw new FrameError("the bytes go on after the last column");
    }
  }
}
