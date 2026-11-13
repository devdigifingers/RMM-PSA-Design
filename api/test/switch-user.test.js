import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { powershellLine, signinScript, signoutScript, signoutTarget, switchOutcome, SWITCH_DONE } from "../src/switch-user.js";
import { activityFromAudit } from "../src/activity.js";

function decoded(line) {
  const match = line.match(/FromBase64String\('([^']+)'\)/);
  return Buffer.from(match[1], "base64").toString("utf16le");
}

describe("Switch user", () => {
  it("encodes the script as one PowerShell line", () => {
    const line = powershellLine(signinScript());
    assert.doesNotMatch(line, /[\r\n]/);
    assert.equal(decoded(line), signinScript());
  });

  it("disconnects the console session for the sign-in screen", () => {
    const script = signinScript();
    assert.match(script, /WTSGetActiveConsoleSessionId\(\)/);
    assert.match(script, /WTSDisconnectSession\(\[IntPtr\]::Zero, \$id, \$false\)/);
    assert.doesNotMatch(script, /WTSLogoffSession\(\[IntPtr\]::Zero/);
  });

  it("signs out only the picked session and checks who is in it", () => {
    const script = signoutScript(3, "POS-3316E-SETUP\\HNA");
    assert.match(script, /^\$id = 3$/m);
    assert.match(script, /WTSLogoffSession\(\[IntPtr\]::Zero, \$id, \$false\)/);
    const expected = script.match(/\$expected = .*FromBase64String\('([^']+)'\)/)[1];
    assert.equal(Buffer.from(expected, "base64").toString("utf8"), "POS-3316E-SETUP\\HNA");
  });

  it("keeps quotes in user names out of the script text", () => {
    const script = signoutScript(2, "O'Brien");
    assert.doesNotMatch(script, /O'Brien/);
  });

  it("validates the sign-out target", () => {
    assert.deepEqual(signoutTarget({ sessionId: 2, user: " HNA " }), { sessionId: 2, user: "HNA" });
    assert.equal(signoutTarget({ sessionId: 0, user: "HNA" }), null);
    assert.equal(signoutTarget({ sessionId: "2", user: "HNA" }), null);
    assert.equal(signoutTarget({ sessionId: 2.5, user: "HNA" }), null);
    assert.equal(signoutTarget({ sessionId: 2, user: "" }), null);
    assert.equal(signoutTarget({ sessionId: 2, user: "a\nb" }), null);
    assert.equal(signoutTarget({ sessionId: 2, user: "x".repeat(121) }), null);
  });

  it("reads the computer's answer", () => {
    assert.deepEqual(switchOutcome(`${SWITCH_DONE}\r\n`), { ok: true });
    assert.deepEqual(switchOutcome("OK"), { ok: false, error: "OK" });
    assert.deepEqual(switchOutcome("\r\nNobody is at the screen.\r\n"), { ok: false, error: "Nobody is at the screen." });
    assert.deepEqual(switchOutcome(""), { ok: false, error: "Windows did not answer." });
  });

  it("describes a sign-out on the device timeline", () => {
    const item = activityFromAudit({
      id: 1, action: "remote.signout_user", created_at: new Date(), detail: { user: "POS\\HNA" },
      target_type: "device", target_id: "16", actor_name: "Ann",
    });
    assert.match(item.summary || item.text || JSON.stringify(item), /signed POS\\+HNA out of Windows/);
  });
});
