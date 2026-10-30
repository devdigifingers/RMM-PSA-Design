import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import nextConfig from "../next.config.mjs";
import { SETTINGS_SECTIONS, areaForApp, areasFor, findSetting, searchSections, visibleSections } from "../app/settings-map.js";

const appDir = new URL("../app/", import.meta.url);
const everything = { manage: true, remote: true, service: true, support: true, alerts: true, patches: true, reports: true };
const remoteOnly = { ...everything, service: false };
const technician = { ...everything, manage: false };
const titles = (sections) => sections.map((section) => section.title);
const labels = (sections) => sections.flatMap((section) => section.items.map((item) => item.label));
const pageExists = (route) => existsSync(new URL(`.${route.split("#")[0]}/page.js`, appDir));

test("Remote Desk settings never show Service Desk sections, and the reverse", () => {
  const remote = titles(visibleSections("remote", everything));
  const desk = titles(visibleSections("desk", everything));
  assert.ok(remote.length && desk.length);
  assert.deepEqual(remote.filter((title) => desk.includes(title)), []);
  assert.ok(!remote.includes("Service levels"));
  assert.ok(!desk.includes("Unattended access"));
});

test("Organisation sections are the same whichever app opens them", () => {
  assert.deepEqual(visibleSections("org", everything), visibleSections("org", { ...everything }));
  assert.ok(!titles(visibleSections("org", everything)).some((title) => titles(SETTINGS_SECTIONS.remote).includes(title) || titles(SETTINGS_SECTIONS.desk).includes(title)));
});

test("a tenant without Service Desk gets no Service Desk area or cross-app items", () => {
  assert.deepEqual(areasFor(remoteOnly).map((area) => area.key), ["remote", "org"]);
  assert.deepEqual(visibleSections("desk", remoteOnly), []);
  assert.ok(!labels(visibleSections("remote", remoteOnly)).includes("Alert-to-ticket mapping"));
  assert.equal(areaForApp("service", remoteOnly), "remote");
});

test("technicians see My account and read-only items, not owner/admin settings", () => {
  const org = labels(visibleSections("org", technician));
  assert.ok(org.includes("Profile and password"));
  assert.ok(!org.includes("Manage technicians"));
  assert.ok(!org.includes("Subscription and package"));
  assert.ok(!labels(visibleSections("remote", technician)).includes("Deployment and agent installers"));
});

test("search only finds items in the sections it is given", () => {
  const found = searchSections([...visibleSections("remote", everything), ...visibleSections("org", everything)], "sla");
  assert.deepEqual(labels(found), []);
  assert.deepEqual(labels(searchSections(visibleSections("desk", everything), "sla")), ["SLA targets and plans"]);
  assert.ok(labels(searchSections(visibleSections("org", everything), "mfa")).length === 1);
});

test("Contacts is no longer a setting", () => {
  for (const sections of Object.values(SETTINGS_SECTIONS)) assert.ok(!labels(sections).some((label) => /contacts/i.test(label)));
});

test("every live settings link has a page, and settings pages sit under their area", () => {
  for (const sections of Object.values(SETTINGS_SECTIONS)) {
    for (const item of sections.flatMap((section) => section.items).filter((entry) => entry.href)) {
      assert.ok(pageExists(item.href), `${item.href} has no page`);
    }
  }
  assert.equal(findSetting("/desk/settings/service-levels").area.key, "desk");
  assert.equal(findSetting("/remote/settings/deployment").area.key, "remote");
  assert.equal(findSetting("/settings/org/mfa").area.key, "org");
});

test("old settings routes redirect to pages that exist", async () => {
  const redirects = await nextConfig.redirects();
  const moved = Object.fromEntries(redirects.filter((entry) => !entry.has).map((entry) => [entry.source, entry.destination]));
  assert.equal(moved["/tickets/setup"], "/desk/settings/service-levels");
  for (const [source, destination] of Object.entries(moved)) {
    assert.ok(pageExists(destination), `${source} redirects to missing ${destination}`);
    assert.ok(!pageExists(source), `${source} still has its own page`);
  }
});
