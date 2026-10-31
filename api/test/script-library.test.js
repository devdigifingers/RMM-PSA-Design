import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  BUILTIN_SCRIPTS,
  FIX_TYPES,
  PARAMS_MAX,
  RISKS,
  SHELLS,
  builtinScript,
  parameterValues,
  parseScriptInput,
  scriptJob,
  scriptView,
} from "../src/script-library.js";

const windows = { os_name: "Microsoft Windows 11 Pro", agent_version: "1.6.1" };
const oldWindows = { os_name: "Microsoft Windows 10 Pro", agent_version: "1.5.0" };
const linux = { os_name: "Ubuntu 24.04 LTS", agent_version: "0.3.0" };

const base = { name: "Fix it", description: "", shell: "powershell", body: "Get-Date", risk: "safe" };

test("there are fifteen built-in scripts with valid settings", () => {
  assert.equal(BUILTIN_SCRIPTS.length, 15);
  assert.equal(new Set(BUILTIN_SCRIPTS.map((script) => script.ref)).size, 15);
  for (const script of BUILTIN_SCRIPTS) {
    assert.match(script.ref, /^[a-z][a-z0-9-]+$/, script.ref);
    assert.ok(SHELLS[script.shell], script.ref);
    assert.ok(RISKS[script.risk], script.ref);
    assert.ok(script.fixes.every((fix) => FIX_TYPES[fix]), script.ref);
    const parsed = parseScriptInput(script);
    assert.equal(parsed.error, undefined, `${script.ref}: ${parsed.error}`);
    assert.equal(builtinScript(script.ref), script);
  }
  assert.equal(builtinScript("restart-service").risk, "approval");
  assert.equal(builtinScript("nope"), null);
});

test("parseScriptInput checks the fields", () => {
  assert.deepEqual(parseScriptInput({ ...base, body: "Get-Date\r\nGet-Host\n" }).value, {
    name: "Fix it", description: "", shell: "powershell", body: "Get-Date\nGet-Host", parameters: [], risk: "safe", fixes: [],
  });
  assert.match(parseScriptInput({ ...base, name: "" }).error, /name/);
  assert.match(parseScriptInput({ ...base, name: "x".repeat(81) }).error, /name/);
  assert.match(parseScriptInput({ ...base, shell: "zsh" }).error, /PowerShell, CMD or Bash/);
  assert.match(parseScriptInput({ ...base, risk: "yolo" }).error, /risk/);
  assert.match(parseScriptInput({ ...base, body: "  " }).error, /empty/);
  assert.match(parseScriptInput({ ...base, body: "a\0b" }).error, /NUL/);
  assert.match(parseScriptInput({ ...base, shell: "cmd", body: "echo a\necho b" }).error, /one command line/);
  assert.match(parseScriptInput({ ...base, fixes: ["cpu", "weather"] }).error, /alert types/);
  assert.deepEqual(parseScriptInput({ ...base, fixes: ["cpu", "cpu", "disk"] }).value.fixes, ["cpu", "disk"]);
  assert.equal(parseScriptInput({ ...base, risk: undefined }).value.risk, "safe");
});

test("parameters are checked", () => {
  const param = (name, extra = {}) => ({ name, label: "", default: "", ...extra });
  const parsed = parseScriptInput({ ...base, parameters: [param("Service", { required: true }), param(""), { name: "", label: "", default: "" }] });
  assert.deepEqual(parsed.value.parameters, [{ name: "Service", label: "Service", default: "", required: true }]);
  assert.match(parseScriptInput({ ...base, parameters: [param("1bad")] }).error, /not a valid parameter name/);
  assert.match(parseScriptInput({ ...base, parameters: [param("a"), param("A")] }).error, /twice/);
  assert.match(parseScriptInput({ ...base, parameters: Array.from({ length: PARAMS_MAX + 1 }, (_, i) => param(`p${i}`)) }).error, /up to/);
  assert.match(parseScriptInput({ ...base, parameters: [param("a", { default: "x\ny" })] }).error, /one line/);
  assert.match(parseScriptInput({ ...base, shell: "cmd", body: "echo hi", parameters: [param("Name")] }).error, /does not use \{\{Name\}\}/);
  assert.match(parseScriptInput({ ...base, shell: "cmd", body: "echo {{Name}}", parameters: [param("Name", { default: "a&b" })] }).error, /only contain/);
});

test("parameterValues fills defaults and checks required values", () => {
  const script = { shell: "powershell", parameters: [{ name: "A", label: "Alpha", default: "one", required: true }, { name: "B", label: "B", default: "", required: false }] };
  assert.deepEqual(parameterValues(script, {}).value, { A: "one", B: "" });
  assert.deepEqual(parameterValues(script, { A: " two ", B: 3 }).value, { A: "two", B: "3" });
  const needed = { ...script, parameters: [{ name: "S", label: "Service name", default: "", required: true }] };
  assert.match(parameterValues(needed, {}).error, /Fill in Service name/);
  assert.match(parameterValues({ shell: "cmd", parameters: [{ name: "X", label: "X", default: "" }] }, { X: "a|b" }).error, /only contain/);
});

test("PowerShell scripts become script jobs with quoted variables", () => {
  const script = scriptView(builtinScript("restart-service"));
  const job = scriptJob(script, windows, { ServiceName: "Spool'er" });
  assert.equal(job.value.kind, "script");
  assert.ok(job.value.text.startsWith("$ServiceName = 'Spool''er'\n$service = Get-Service"));
  assert.match(scriptJob(script, oldWindows, { ServiceName: "x" }).error, /agent 1\.6\.1/);
  assert.match(scriptJob(script, linux, { ServiceName: "x" }).error, /Windows devices only/);
});

test("CMD scripts become one command line", () => {
  const script = { shell: "cmd", body: "sc query {{Name}} && echo {{Name}}", parameters: [{ name: "Name" }] };
  assert.deepEqual(scriptJob(script, windows, { Name: "Spooler" }).value, { kind: "command", text: "sc query Spooler && echo Spooler" });
  assert.deepEqual(scriptJob(script, oldWindows, { Name: "x" }).value.kind, "command");
  assert.match(scriptJob(script, linux, { Name: "x" }).error, /Windows devices only/);
});

test("Bash scripts run through a quoted heredoc", () => {
  const script = { shell: "bash", body: "echo \"$Who\" $HOME", parameters: [{ name: "Who" }] };
  const job = scriptJob(script, linux, { Who: "it's me; rm -rf /" });
  assert.equal(job.value.kind, "command");
  const [first, ...rest] = job.value.text.split("\n");
  const end = first.match(/<<'(DF_SCRIPT_END_[0-9a-f]{8})'$/)[1];
  assert.equal(rest.at(-1), end);
  assert.match(scriptJob(script, windows, {}).error, /Linux devices only/);
  const output = execFileSync("/bin/sh", ["-c", job.value.text], { env: { PATH: "/usr/bin:/bin", HOME: "/home/x" } }).toString();
  assert.equal(output, "it's me; rm -rf / /home/x\n");
});

test("built-in Bash scripts run under sh", () => {
  const job = scriptJob(scriptView(builtinScript("linux-top-processes")), linux, {});
  const output = execFileSync("/bin/sh", ["-c", job.value.text], { env: { PATH: "/usr/bin:/bin" } }).toString();
  assert.match(output, /PID/);
});
