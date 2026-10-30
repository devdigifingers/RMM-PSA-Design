import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PLATFORM_RELEASED, PLATFORM_VERSION } from "../app/version.js";

test("the newest change log section matches the platform version", async () => {
  const log = await readFile(new URL("../../docs/CHANGELOG.md", import.meta.url), "utf8");
  const newest = log.split("\n").find((line) => /^## \d{4}-\d{2}-\d{2}/.test(line));
  assert.equal(newest, `## ${PLATFORM_RELEASED} · Platform ${PLATFORM_VERSION}`);
});

test("the platform version is MAJOR.MINOR.PATCH", () => {
  assert.match(PLATFORM_VERSION, /^\d+\.\d+\.\d+$/);
});
