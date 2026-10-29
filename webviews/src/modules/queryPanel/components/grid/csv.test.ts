import { describe, expect, it } from "vitest";
import { dataToCsv } from "./csv";

describe("dataToCsv", () => {
  it("quotes text, doubles quotes, empties null and keeps numbers bare", () => {
    expect(
      dataToCsv(
        ["n", "label", "obj"],
        [
          { n: 1, label: 'say "hi"', obj: { a: 1 } },
          { n: null, label: "x", obj: null },
        ],
      ),
    ).toBe('n,label,obj\r\n1,"say ""hi""",{"a":1}\r\n,"x",');
  });
});
