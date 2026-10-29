// lint-expect: eslint no-restricted-syntax
import * as fs from "node:fs";
export const write = () => fs.writeFileSync("a.txt", "b");
