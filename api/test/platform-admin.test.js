import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvCell, dayBound, noticeState } from "../src/admin-format.js";

describe("csvCell", () => {
  it("quotes commas, quotes and line breaks", () => {
    assert.equal(csvCell('a,"b"'), '"a,""b"""');
    assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
    assert.equal(csvCell(null), "");
  });

  it("neutralises spreadsheet formulas", () => {
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell("+1"), "'+1");
    assert.equal(csvCell("-1"), "'-1");
    assert.equal(csvCell("@x"), "'@x");
  });
});

describe("dayBound", () => {
  it("covers the whole South African day", () => {
    assert.equal(dayBound("2026-10-28", false), "2026-10-27T22:00:00.000Z");
    assert.equal(dayBound("2026-10-28", true), "2026-10-28T21:59:59.999Z");
    assert.equal(dayBound("", false), null);
  });

  it("rejects other formats", () => {
    assert.throws(() => dayBound("28/10/2026", false));
  });
});

describe("noticeState", () => {
  const now = Date.parse("2026-10-28T10:00:00Z");
  it("reports scheduled, live, ended and unpublished notices", () => {
    assert.equal(noticeState({ active: false }, now), "unpublished");
    assert.equal(noticeState({ active: true, starts_at: "2026-10-29T00:00:00Z" }, now), "scheduled");
    assert.equal(noticeState({ active: true, ends_at: "2026-10-28T09:00:00Z" }, now), "ended");
    assert.equal(noticeState({ active: true, starts_at: null, ends_at: null }, now), "live");
  });
});
