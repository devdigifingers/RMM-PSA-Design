import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_MAX, SCRIPT_MAX, parseJobInput, scriptProblem } from "../src/job-input.js";

test("a command is one line of up to 8000 characters", () => {
  assert.deepEqual(parseJobInput({ command: " ipconfig /all " }).value, { kind: "command", text: "ipconfig /all" });
  assert.equal(parseJobInput({ command: "x".repeat(COMMAND_MAX) }).value.kind, "command");
  assert.ok(parseJobInput({ command: "x".repeat(COMMAND_MAX + 1) }).error);
  assert.ok(parseJobInput({ command: "a\nb" }).error);
  assert.ok(parseJobInput({ command: "a\rb" }).error);
  assert.ok(parseJobInput({ command: "" }).error);
  assert.ok(parseJobInput({}).error);
});

test("a script may span lines, up to 64 KB, and keeps its text", () => {
  const script = "$a = 1\r\nif ($a) {\r\n  'yes'\r\n}\r\n";
  assert.deepEqual(parseJobInput({ script }).value, { kind: "script", text: "$a = 1\nif ($a) {\n  'yes'\n}\n" });
  assert.equal(parseJobInput({ script: "x".repeat(SCRIPT_MAX) }).value.kind, "script");
  assert.ok(parseJobInput({ script: "x".repeat(SCRIPT_MAX + 1) }).error);
  assert.ok(parseJobInput({ script: "a\0b" }).error);
  assert.match(parseJobInput({ script: "x", command: "y" }).error, /not both/);
});

test("scripts go only to Windows agents 1.6.1 or newer", () => {
  const windows = "Microsoft Windows 10 IoT Enterprise";
  assert.equal(scriptProblem({ os_name: windows, agent_version: "1.6.1" }), null);
  assert.equal(scriptProblem({ os_name: windows, agent_version: "1.10.0" }), null);
  assert.equal(scriptProblem({ os_name: windows, agent_version: "2.0.0" }), null);
  assert.match(scriptProblem({ os_name: windows, agent_version: "1.6.0" }), /1\.6\.1/);
  assert.match(scriptProblem({ os_name: windows, agent_version: "1.5.9" }), /1\.6\.1/);
  assert.match(scriptProblem({ os_name: windows, agent_version: null }), /1\.6\.1/);
  assert.match(scriptProblem({ os_name: "Ubuntu 24.04", agent_version: "1.6.1" }), /Windows/);
});
