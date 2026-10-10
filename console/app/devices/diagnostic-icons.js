// Outline icons from Lucide (https://lucide.dev), ISC license.
// Copyright (c) Cole Bemis 2013-2022 as part of Feather, and Lucide Contributors 2022.

const pen = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function DiagnosticIcon({ name }) {
  return <Icon className="diag-icon">{tool(name)}</Icon>;
}

export function TileIcon({ name }) {
  return <Icon className="tile-icon">{tile(name)}</Icon>;
}

function Icon({ className, children }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...pen}>
      {children}
    </svg>
  );
}

function tile(name) {
  if (name === "Storage") return hardDrive();
  if (name === "Graphics Card") return graphicsCard();
  if (name === "Installed Memory") return memoryStick();
  if (name === "Processor") return cpu();
  if (name === "device") return monitor();
  if (name === "windows") return windowGrid();
  return null;
}

function tool(name) {
  if (name === "overview") return monitor();
  if (name === "command") return terminal();
  if (name === "tasks") return columns();
  if (name === "services") return gear();
  if (name === "files") return folder();
  if (name === "registry") return tree();
  if (name === "events") return scroll();
  if (name === "devmgr") return board();
  if (name === "scheduler") return calendar();
  if (name === "software") return pack();
  if (name === "hardware") return chip();
  if (name === "accounts") return person();
  if (name === "printers") return printer();
  if (name === "groups") return people();
  if (name === "shares") return share();
  return folder();
}

function hardDrive() {
  return (
    <>
      <path d="M10 16h.01" />
      <path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <path d="M21.946 12.013H2.054" />
      <path d="M6 16h.01" />
    </>
  );
}

function graphicsCard() {
  return (
    <>
      <rect x="2" y="7" width="20" height="9" rx="2" />
      <circle cx="8.5" cy="11.5" r="2.25" />
      <path d="M14 9.5v4M17.5 9.5v4" />
      <path d="M6 16v2.5M10 16v2.5M14 16v2.5M18 16v2.5" />
    </>
  );
}

function memoryStick() {
  return (
    <>
      <path d="M12 12v-2" />
      <path d="M12 18v-2" />
      <path d="M16 12v-2" />
      <path d="M16 18v-2" />
      <path d="M2 11h1.5" />
      <path d="M20 18v-2" />
      <path d="M20.5 11H22" />
      <path d="M4 18v-2" />
      <path d="M8 12v-2" />
      <path d="M8 18v-2" />
      <rect x="2" y="6" width="20" height="10" rx="2" />
    </>
  );
}

function cpu() {
  return (
    <>
      <path d="M12 20v2M12 2v2M17 20v2M17 2v2M2 12h2M2 17h2M2 7h2M20 12h2M20 17h2M20 7h2M7 20v2M7 2v2" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </>
  );
}

function monitor() {
  return (
    <>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  );
}

function windowGrid() {
  return (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  );
}

function terminal() {
  return (
    <>
      <path d="M12 19h8" />
      <path d="m4 17 6-6-6-6" />
    </>
  );
}

function columns() {
  return (
    <>
      <path d="M5 21v-6" />
      <path d="M12 21V3" />
      <path d="M19 21V9" />
    </>
  );
}

function gear() {
  return (
    <>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </>
  );
}

function folder() {
  return <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />;
}

function tree() {
  return (
    <>
      <path d="M8 5h13" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="M3 10a2 2 0 0 0 2 2h3" />
      <path d="M3 5v12a2 2 0 0 0 2 2h3" />
    </>
  );
}

function scroll() {
  return (
    <>
      <path d="M15 12h-5" />
      <path d="M15 8h-5" />
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
    </>
  );
}

function board() {
  return (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M11 9h4a2 2 0 0 0 2-2V3" />
      <circle cx="9" cy="9" r="2" />
      <path d="M7 21v-4a2 2 0 0 1 2-2h4" />
      <circle cx="15" cy="15" r="2" />
    </>
  );
}

function calendar() {
  return (
    <>
      <path d="M16 14v2.2l1.6 1" />
      <path d="M16 2v3" />
      <path d="M21 7.338V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.338" />
      <path d="M3 9h5.859" />
      <path d="M8 2v3" />
      <circle cx="16" cy="16" r="6" />
    </>
  );
}

function pack() {
  return (
    <>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <path d="m3.29 7 8.71 5 8.71-5" />
      <path d="m7.5 4.27 9 5.15" />
    </>
  );
}

function chip() {
  return (
    <>
      <path d="M10 12h4M10 17h4M10 7h4M18 12h2M18 18h2M18 6h2M4 12h2M4 18h2M4 6h2" />
      <rect x="6" y="2" width="12" height="20" rx="2" />
    </>
  );
}

function person() {
  return (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  );
}

function printer() {
  return (
    <>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>
  );
}

function people() {
  return (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <path d="M16 3.128a4 4 0 0 1 0 7.744" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <circle cx="9" cy="7" r="4" />
    </>
  );
}

function share() {
  return (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
    </>
  );
}
