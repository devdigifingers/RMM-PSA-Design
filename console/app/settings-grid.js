import Link from "next/link";
import { SettingsIcon } from "./settings-icons";

export function SettingsGrid({ sections, tone, onPick }) {
  return (
    <div className={`settings-grid tone-${tone}`}>
      {sections.map((section) => (
        <section key={section.title}>
          <h2><SettingsIcon name={section.icon} />{section.title}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <Link href={item.href} onClick={onPick}>{item.label}</Link>
                ) : (
                  <span className="settings-soon" title="Coming soon">{item.label}<em>Soon</em></span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// An app area lists its own sections, then the shared Organisation sections.
export function SettingsBody({ areaKey, appSections, orgSections, query = "", onPick }) {
  const total = appSections.length + orgSections.length;
  return (
    <>
      {total === 0 ? <p className="settings-empty">{query.trim() ? `No settings match “${query.trim()}”.` : "No settings are available to you here."}</p> : null}
      {areaKey !== "org" && appSections.length ? <SettingsGrid sections={appSections} tone={areaKey} onPick={onPick} /> : null}
      {areaKey !== "org" && appSections.length && orgSections.length ? <h2 className="settings-group">Shared organisation settings</h2> : null}
      {orgSections.length ? <SettingsGrid sections={orgSections} tone="org" onPick={onPick} /> : null}
    </>
  );
}
