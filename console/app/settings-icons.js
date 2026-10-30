const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };

const PATHS = {
  org: (
    <>
      <rect x="9" y="3.5" width="6" height="4.5" rx="1" {...line} />
      <rect x="3" y="16" width="6" height="4.5" rx="1" {...line} />
      <rect x="15" y="16" width="6" height="4.5" rx="1" {...line} />
      <path d="M12 8v4M6 16v-4h12v4" {...line} />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" {...line} />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 14.8c2 .7 3.5 2.6 3.5 5.2" {...line} />
    </>
  ),
  billing: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" {...line} />
      <path d="M3 10h18M7 15h4" {...line} />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6l7-2.5z" {...line} />
      <path d="M9 12l2 2 4-4" {...line} />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" {...line} />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" {...line} />
    </>
  ),
  plug: <path d="M9 3.5V8M15 3.5V8M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8zM12 16.5v4" {...line} />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" {...line} />
      <path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" {...line} />
    </>
  ),
  headset: (
    <>
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" {...line} />
      <rect x="3.5" y="13" width="4" height="6" rx="1.4" {...line} />
      <rect x="16.5" y="13" width="4" height="6" rx="1.4" {...line} />
    </>
  ),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.8" {...line} />
      <path d="M9 20h6M12 16v4" {...line} />
    </>
  ),
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9zM10.3 19.5a2 2 0 0 0 3.4 0" {...line} />,
  patch: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6l7-2.5z" {...line} />
      <path d="M12 8.5v6M9 11.5h6" {...line} />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" {...line} />
      <path d="M7 9.5l3 2.5-3 2.5M12.5 15H17" {...line} />
    </>
  ),
  chart: <path d="M4 4v15.5h16M8.5 16v-4M13 16V8M17.5 16v-6" {...line} />,
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" {...line} />
      <path d="M3.5 7l8.5 6 8.5-6" {...line} />
    </>
  ),
  ticket: <path d="M3 9a2.5 2.5 0 0 0 0 6v2.5A1.5 1.5 0 0 0 4.5 19h15a1.5 1.5 0 0 0 1.5-1.5V15a2.5 2.5 0 0 1 0-6V6.5A1.5 1.5 0 0 0 19.5 5h-15A1.5 1.5 0 0 0 3 6.5zM14 5v2M14 11v2M14 17v2" {...line} />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" {...line} />
      <path d="M12 7.5V12l3 2" {...line} />
    </>
  ),
  zap: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" {...line} />,
  message: <path d="M4 5.5h16v10.5H9l-5 4z" {...line} />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" {...line} />
      <path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" {...line} />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="7.5" {...line} />
      <path d="M12 13V9.5M9.5 2.5h5M18.5 6.5l1.5-1.5" {...line} />
    </>
  ),
  book: <path d="M4 5a1.5 1.5 0 0 1 1.5-1.5H20v15H5.5A1.5 1.5 0 0 0 4 20zM4 20a1.5 1.5 0 0 0 1.5 1.5H20M8 8h8" {...line} />,
};

export function SettingsIcon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{PATHS[name] || PATHS.org}</svg>;
}
