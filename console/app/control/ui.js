import { AppIcon } from "../mark";
import { APP_ICON, APP_TITLE, STATUS_LABEL } from "./catalog";

export function UsageMeter({ meter, label }) {
  return (
    <div className={`usage-meter is-${meter.level}`} title={`${meter.percent}% used`}>
      <span>{label ? `${label}: ` : ""}{meter.used} / {meter.total}</span>
      <div className="sub-bar"><i className={meter.percent > 0 ? "has-value" : undefined} style={{ width: `${meter.percent}%` }} /></div>
    </div>
  );
}

export function StatusChip({ status }) {
  const level = status === "active" ? "" : " is-full";
  return <span className={`usage-state${level}`}>{STATUS_LABEL[status] || status}</span>;
}

export function AppIcons({ apps }) {
  if (!apps?.length) return <span className="org-name">—</span>;
  return (
    <span className="admin-apps">
      {apps.map((app) => (
        <span key={app} title={APP_TITLE[app]}>
          <AppIcon app={APP_ICON[app]} size={20} />
        </span>
      ))}
    </span>
  );
}

export function Tabs({ base, tab, tabs }) {
  return (
    <nav className="cust-tabs" aria-label="Sections">
      {tabs.map(([key, label]) => (
        <a key={key} href={`${base}?tab=${key}`} className={tab === key ? "is-active" : undefined} aria-current={tab === key ? "page" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}
