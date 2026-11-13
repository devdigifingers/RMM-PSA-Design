import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEnquiry, returnPath, websiteOrigins } from "../src/public-enquiry.js";

const NOW = 1_800_000_000_000;
const good = { kind: "quote", name: " Ann  Smith ", email: "Ann@Example.co.za", business: "Ann's Shop", message: "A stock system for two shops.", return: "/custom-software/" };

describe("Website enquiry", () => {
  it("accepts a quote request and tidies it", () => {
    const { value, error, bot } = parseEnquiry(good, NOW);
    assert.equal(error, undefined);
    assert.equal(bot, undefined);
    assert.equal(value.kind, "quote");
    assert.equal(value.topic, "custom");
    assert.equal(value.name, "Ann Smith");
    assert.equal(value.email, "ann@example.co.za");
    assert.equal(value.source, "/custom-software/");
  });

  it("keeps a contact topic only from the list", () => {
    assert.equal(parseEnquiry({ ...good, kind: "contact", topic: "support" }, NOW).value.topic, "support");
    assert.equal(parseEnquiry({ ...good, kind: "contact", topic: "hack" }, NOW).value.topic, "other");
    assert.equal(parseEnquiry({ ...good, kind: "nope" }, NOW).value.kind, "contact");
  });

  it("turns a sign-up page request into a sales message", () => {
    const { value, error } = parseEnquiry({ kind: "contact", package: "suite", name: "Ann", email: "ann@example.co.za", message: "" }, NOW);
    assert.equal(error, undefined);
    assert.equal(value.topic, "sales");
    assert.equal(value.message, "Sign-up request: Full Suite package.");
    assert.equal(parseEnquiry({ ...good, kind: "contact", package: "gold", message: "" }, NOW).field, "message");
  });

  it("explains what is missing", () => {
    assert.equal(parseEnquiry({ ...good, name: "" }, NOW).field, "name");
    assert.equal(parseEnquiry({ ...good, email: "not-an-email" }, NOW).field, "email");
    assert.equal(parseEnquiry({ ...good, phone: "call me" }, NOW).field, "phone");
    assert.equal(parseEnquiry({ ...good, message: "hi" }, NOW).field, "message");
    assert.equal(parseEnquiry({ ...good, phone: "+27 (21) 555-0100" }, NOW).error, undefined);
  });

  it("flags bots without telling them", () => {
    assert.equal(parseEnquiry({ ...good, website: "http://spam" }, NOW).bot, true);
    assert.equal(parseEnquiry({ ...good, started: String(NOW - 1000) }, NOW).bot, true);
    assert.equal(parseEnquiry({ ...good, started: String(NOW - 20000) }, NOW).bot, undefined);
    assert.equal(parseEnquiry({ ...good, started: "" }, NOW).bot, undefined);
  });

  it("strips control characters and header tricks", () => {
    const { value } = parseEnquiry({ ...good, name: "Ann\r\nBcc: x@y.z", message: "Line one\r\nLine two\u0000" }, NOW);
    assert.equal(value.name, "Ann Bcc: x@y.z");
    assert.equal(value.message, "Line one\nLine two");
  });

  it("only returns to a path on the website", () => {
    assert.equal(returnPath("/contact/"), "/contact/");
    assert.equal(returnPath("//evil.example/"), "/contact/");
    assert.equal(returnPath("https://evil.example/"), "/contact/");
    assert.equal(returnPath("/a?b=c"), "/contact/");
    assert.equal(returnPath(undefined), "/contact/");
  });

  it("allows the apex website by default", () => {
    const saved = process.env.WEBSITE_ORIGINS;
    delete process.env.WEBSITE_ORIGINS;
    assert.deepEqual(websiteOrigins(), ["https://digitalfingers.co.za"]);
    process.env.WEBSITE_ORIGINS = "https://digitalfingers.co.za/, https://www.digitalfingers.co.za";
    assert.deepEqual(websiteOrigins(), ["https://digitalfingers.co.za", "https://www.digitalfingers.co.za"]);
    if (saved === undefined) delete process.env.WEBSITE_ORIGINS;
    else process.env.WEBSITE_ORIGINS = saved;
  });
});
