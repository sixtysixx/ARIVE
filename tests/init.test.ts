import { expect, test } from "bun:test";
import * as fs from "fs";

test("Project configurations exist", () => {
  expect(fs.existsSync("package.json")).toBe(true);
  expect(fs.existsSync("tsconfig.json")).toBe(true);
});
