export function OsMark({ osName }) {
  const kind = osKind(osName);
  if (kind === "windows") return <WindowsMark />;
  if (kind === "ubuntu") return <UbuntuMark />;
  if (kind === "fedora") return <FedoraMark />;
  if (kind === "redhat") return <RedHatMark />;
  if (kind === "pi") return <PiMark />;
  if (kind === "linux") return <LinuxMark />;
  return null;
}

function osKind(osName) {
  const text = osName || "";
  if (/windows/i.test(text)) return "windows";
  if (/ubuntu/i.test(text)) return "ubuntu";
  if (/fedora/i.test(text)) return "fedora";
  if (/red\s*hat|\brhel\b/i.test(text)) return "redhat";
  if (/raspberry|raspbian/i.test(text)) return "pi";
  if (/linux|debian|centos|rocky|alma|suse/i.test(text)) return "linux";
  return "";
}

function WindowsMark() {
  return (
    <svg className="os-mark" viewBox="0 0 16 16" role="img" aria-label="Windows">
      <path fill="#00adef" d="M0 2.3 6.5 1.4v6.1H0z" />
      <path fill="#00adef" d="M7.3 1.2 16 0v7.5H7.3z" />
      <path fill="#00adef" d="M0 8.5h6.5v6.2L0 13.7z" />
      <path fill="#00adef" d="M7.3 8.6H16V16l-8.7-1.2z" />
    </svg>
  );
}

function UbuntuMark() {
  return (
    <svg className="os-mark" viewBox="0 0 16 16" role="img" aria-label="Ubuntu">
      <circle cx="8" cy="8" r="8" fill="#E95420" />
      <circle cx="8" cy="8" r="3.15" fill="none" stroke="#fff" strokeWidth="1.55" />
      <circle cx="8" cy="3.05" r="1.35" fill="#fff" />
      <circle cx="12.25" cy="10.45" r="1.35" fill="#fff" />
      <circle cx="3.75" cy="10.45" r="1.35" fill="#fff" />
    </svg>
  );
}

function FedoraMark() {
  return (
    <svg className="os-mark" viewBox="0 0 64 64" role="img" aria-label="Fedora">
      <path fill="#294172" d="M29 24C29 14 40 12 48 18c4 3 1 8-4 7-4-1-7-3-8 0v5h14v8H36v16h-8V38H14v-8h14v-6z" />
    </svg>
  );
}

function RedHatMark() {
  return (
    <svg className="os-mark" viewBox="0 0 16 16" role="img" aria-label="Red Hat">
      <path fill="#EE0000" d="M.6 6.2c2.2-.4 4.6-.7 7-.2 1.6-2.6 4.2-3 5.6-1.4.6 1-.4 2-2.2 2.1H1.2c-.6 0-.8-.3-.6-.5z" />
      <path fill="#EE0000" d="M5 7.4h6.2l1.2 7.2H3.6z" />
    </svg>
  );
}

function PiMark() {
  return (
    <svg className="os-mark" viewBox="0 0 48 48" role="img" aria-label="Raspberry Pi">
      <path fill="#3FA34D" d="M24 14c1-6 6-9 9-10-1 3-2 5-3 6 3 0 6 1 7 3-3 0-6 1-8 3-2-1-4-2-5-2z" />
      <g fill="#C51A4A">
        <circle cx="24" cy="18.5" r="4.5" />
        <circle cx="17.6" cy="22.8" r="4.5" />
        <circle cx="30.4" cy="22.8" r="4.5" />
        <circle cx="20" cy="28.4" r="4.5" />
        <circle cx="28" cy="28.4" r="4.5" />
        <circle cx="24" cy="33.6" r="4.3" />
      </g>
    </svg>
  );
}

function LinuxMark() {
  return (
    <svg className="os-mark" viewBox="0 0 24 24" role="img" aria-label="Linux">
      <ellipse cx="8" cy="21.2" rx="3.4" ry="1.5" fill="#f5a623" />
      <ellipse cx="16" cy="21.2" rx="3.4" ry="1.5" fill="#f5a623" />
      <ellipse cx="12" cy="12.2" rx="7.2" ry="8.4" fill="#111" />
      <ellipse cx="12" cy="15" rx="4.3" ry="4.8" fill="#fff" />
      <ellipse cx="9.4" cy="9.6" rx="1.8" ry="2.1" fill="#fff" />
      <ellipse cx="14.6" cy="9.6" rx="1.8" ry="2.1" fill="#fff" />
      <circle cx="10" cy="10.1" r="0.85" fill="#111" />
      <circle cx="15.2" cy="10.1" r="0.85" fill="#111" />
      <path fill="#f5a623" d="M10 12.4h4L12 15.4z" />
    </svg>
  );
}
