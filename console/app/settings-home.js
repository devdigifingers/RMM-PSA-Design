import { settingsAccess } from "./account-data";
import { AppIcon } from "./mark";
import { SettingsBody } from "./settings-grid";
import { SettingsIcon } from "./settings-icons";
import { SETTINGS_AREAS, areasFor, findSetting, searchSections, visibleSections } from "./settings-map";

export function SettingsHome({ areaKey, account, query = "" }) {
  const access = settingsAccess(account);
  const area = SETTINGS_AREAS[areaKey];
  const appSections = areaKey === "org" ? [] : searchSections(visibleSections(areaKey, access), query);
  const orgSections = searchSections(visibleSections("org", access), query);
  return (
    <div className={`settings-home tone-${areaKey}`}>
      <h1 className="settings-home-title">
        {area.app ? <AppIcon app={area.app} size={32} /> : <span className="settings-home-icon"><SettingsIcon name="org" /></span>}
        {area.title}
      </h1>
      <div className="settings-home-bar">
        <nav className="settings-tabs" aria-label="Settings areas">
          {areasFor(access).map((entry) => (
            <a key={entry.key} href={entry.root} className={`tone-${entry.key}${entry.key === areaKey ? " on" : ""}`} aria-current={entry.key === areaKey ? "page" : undefined}>
              {entry.label}
            </a>
          ))}
        </nav>
        <form className="settings-search" method="get" role="search">
          <input name="q" defaultValue={query} placeholder="What are you looking for?" aria-label="Search settings" />
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </form>
      </div>
      <SettingsBody areaKey={areaKey} appSections={appSections} orgSections={orgSections} query={query} />
    </div>
  );
}

export function SettingsCrumb({ href }) {
  const found = findSetting(href);
  if (!found) return null;
  return (
    <nav className="settings-crumb" aria-label="Breadcrumb">
      <a href={found.area.root}>← Settings</a>
      <span aria-hidden="true">›</span>
      {found.area.key === "org" ? null : <>{found.area.label}<span aria-hidden="true">›</span></>}
      {found.section.title}
      <span aria-hidden="true">›</span>
      <strong>{found.item.label}</strong>
    </nav>
  );
}
