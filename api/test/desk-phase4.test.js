import assert from "node:assert/strict";
import test from "node:test";
import { applyAutomations, conditionMatches, parseAutomation } from "../src/desk-automation.js";
import { csatLinks, csatSignature, csatValid, happiness } from "../src/csat.js";
import { resolvedNotice } from "../src/mail-thread.js";
import {
  brandedReply,
  companyDomain,
  inboundSubject,
  isAutomatic,
  messageIds,
  replySubject,
  replyText,
  ticketIdFromSubject,
  websiteDomain,
} from "../src/mail-thread.js";

test("subject tokens thread replies", () => {
  assert.equal(ticketIdFromSubject("Re: [#123] Printer down"), 123);
  assert.equal(ticketIdFromSubject("Printer down"), null);
  assert.equal(replySubject(123, "RE: [#123] Printer down"), "Re: [#123] Printer down");
  assert.equal(inboundSubject("Fwd: RE: [#9]  Printer   down"), "Printer down");
  assert.equal(inboundSubject(""), "(no subject)");
});

test("automatic mail is never turned into tickets", () => {
  assert.equal(isAutomatic(new Map([["auto-submitted", "auto-replied"]])), true);
  assert.equal(isAutomatic(new Map([["auto-submitted", "no"]])), false);
  assert.equal(isAutomatic({ precedence: "bulk" }), true);
  assert.equal(isAutomatic({ "x-autoreply": "yes" }), true);
  assert.equal(isAutomatic({ "x-df-ticket": "12" }), true);
  assert.equal(isAutomatic({ "list-id": "<news.example.com>" }), true);
  assert.equal(isAutomatic({}), false);
});

test("message ids are collected from threading headers", () => {
  assert.deepEqual(messageIds("<a@x.com>", ["<b@x.com>", "<a@x.com>"]), ["<a@x.com>", "<b@x.com>"]);
  assert.deepEqual(messageIds("<a@x.com> <c@y.com>"), ["<a@x.com>", "<c@y.com>"]);
  assert.deepEqual(messageIds(undefined, null), []);
});

test("quoted thread text is dropped from replies", () => {
  const text = "Still broken after restart.\n\nThanks\n\nOn Tue, 3 Nov 2026 at 10:00, Support <help@df.co.za> wrote:\n> We restarted it.";
  assert.equal(replyText(text), "Still broken after restart.\n\nThanks");
  assert.equal(replyText("> only quoted\nNew line"), "New line");
  assert.equal(replyText("Hi\n-----Original Message-----\nFrom: x"), "Hi");
});

test("free mail domains do not identify a customer", () => {
  assert.equal(companyDomain("jane@gmail.com"), "");
  assert.equal(companyDomain("jane@acme.co.za"), "acme.co.za");
  assert.equal(websiteDomain("https://www.acme.co.za/contact"), "acme.co.za");
});

test("branded replies escape the body", () => {
  const out = brandedReply({ orgName: "DF", agentName: "Sam", body: "<b>hi</b>", ticketId: 5, subject: "Help", color: "red" });
  assert.match(out.html, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.match(out.html, /#8B5CF6/);
  assert.match(out.text, /\[#5\]/);
});

test("automations validate their rules", () => {
  assert.match(parseAutomation({ name: "", trigger: "created" }).error, /Name/);
  assert.match(parseAutomation({ name: "A", trigger: "created", actions: [] }).error, /action/);
  const ok = parseAutomation({
    name: "Urgent VIP",
    trigger: "created",
    conditions: [{ field: "customer", op: "is", value: "4" }],
    actions: [{ type: "set_priority", value: "urgent" }],
  });
  assert.equal(ok.value.name, "Urgent VIP");
  assert.match(parseAutomation({ name: "A", trigger: "created", actions: [{ type: "set_priority", value: "huge" }] }).error, /priority/);
});

test("automations apply in order and report what changed", () => {
  const ticket = { subject: "Server down", status: "open", priority: "normal", channel: "email", category: null, tags: [], customer_id: 4, plan_id: 2, assignee_user_id: null };
  const rules = [
    { id: 1, name: "Down is urgent", conditions: [{ field: "subject", op: "contains", value: "down" }], actions: [{ type: "set_priority", value: "urgent" }] },
    { id: 2, name: "Urgent to Sam", conditions: [{ field: "priority", op: "is", value: "urgent" }], actions: [{ type: "assign", value: "7" }, { type: "add_tag", value: "outage" }] },
    { id: 3, name: "Disabled", enabled: false, conditions: [], actions: [{ type: "set_status", value: "resolved" }] },
  ];
  const { ticket: after, fired } = applyAutomations(ticket, rules);
  assert.equal(after.priority, "urgent");
  assert.equal(after.assignee_user_id, "7");
  assert.deepEqual(after.tags, ["outage"]);
  assert.equal(after.status, "open");
  assert.deepEqual(fired.map((rule) => rule.name), ["Down is urgent", "Urgent to Sam"]);
  assert.deepEqual(ticket.tags, []);
  assert.equal(conditionMatches(ticket, { field: "plan", op: "is", value: "2" }), true);
  assert.equal(conditionMatches(ticket, { field: "tag", op: "has_not", value: "outage" }), true);
});

test("CSAT links are signed per ticket and org", () => {
  const key = Buffer.from("k".repeat(32));
  const sig = csatSignature(key, 3, 41);
  assert.equal(csatValid(key, 3, 41, sig), true);
  assert.equal(csatValid(key, 3, 42, sig), false);
  assert.equal(csatValid(key, 4, 41, sig), false);
  assert.equal(csatValid(key, 3, 41, ""), false);
  const links = csatLinks("https://rmm.example", key, 3, 41);
  assert.equal(links.good, `https://rmm.example/rate/41?r=good&s=${sig}`);
  assert.deepEqual(Object.keys(links), ["good", "ok", "bad"]);
});

test("happiness counts OK as half", () => {
  assert.deepEqual(happiness({ good: 3, ok: 2, bad: 1 }), { good: 3, ok: 2, bad: 1, total: 6, score: 67 });
  assert.equal(happiness({}).score, null);
});

test("the resolved email only carries rating buttons when asked", () => {
  const plain = resolvedNotice({ orgName: "DF", ticketId: 8, subject: "Printer" });
  assert.doesNotMatch(plain.html, /How did we do/);
  const rated = resolvedNotice({ orgName: "DF", ticketId: 8, subject: "Printer", links: { good: "https://x/g", ok: "https://x/o", bad: "https://x/b" } });
  assert.match(rated.html, /How did we do\?/);
  assert.match(rated.html, /href="https:\/\/x\/g"/);
  assert.match(rated.text, /Bad: https:\/\/x\/b/);
});
