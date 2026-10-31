// Platform version shown on the sign-in page and in the side rail. Bump it with every deploy and add a matching
// "## <date> · Platform <version>" section to docs/CHANGELOG.md (test/version.test.mjs checks they agree).
export const PLATFORM_VERSION = "1.4.1";
export const PLATFORM_RELEASED = "2026-10-31";

export function versionLabel() {
  const date = new Date(`${PLATFORM_RELEASED}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `Version ${PLATFORM_VERSION} · ${date}`;
}
