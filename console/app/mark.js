/* eslint-disable @next/next/no-img-element */
import { appById } from "./apps";

export const BRAND_V = "c1";

const RATIO = { horizontal: 517 / 120, stacked: 420 / 250, mark: 1 };
const MIN_HEIGHT = { horizontal: 28, stacked: 16, mark: 16 };

export function brandSrc(name) {
  return `/brand/${name}.svg?v=${BRAND_V}`;
}

function logoName(layout, variant, tagline) {
  if (layout === "mark") return `mark-${variant === "white" || variant === "black" ? variant : "gradient"}`;
  return `logo-${layout}-${variant}${layout === "horizontal" && !tagline ? "-notag" : ""}`;
}

export function Logo({ variant = "dark", layout = "horizontal", height, tagline = true, decorative = false, className }) {
  const h = height ? Math.max(height, MIN_HEIGHT[layout]) : 120;
  return (
    <img
      className={className}
      src={brandSrc(logoName(layout, variant, tagline))}
      alt={decorative ? "" : "Digital Fingers"}
      width={Math.round(h * RATIO[layout])}
      height={h}
      draggable={false}
      decoding="async"
    />
  );
}

export function Wordmark({ tagline = false, surface = "dark" }) {
  if (surface === "auto") {
    return (
      <>
        <Logo className="wordmark wordmark-on-light" variant="light" tagline={tagline} />
        <Logo className="wordmark wordmark-on-dark" variant="dark" tagline={tagline} />
      </>
    );
  }
  return <Logo className="wordmark" variant={surface} tagline={tagline} />;
}

export function BrandMark({ className, size = 28, decorative = false }) {
  return <Logo className={className} layout="mark" height={size} decorative={decorative} />;
}

export function AppIcon({ app, size = 48, labelled = false, muted = false, className }) {
  const entry = typeof app === "string" ? appById(app) : app;
  if (!entry) return null;
  return (
    <img
      className={[className, muted ? "app-icon-muted" : null].filter(Boolean).join(" ") || undefined}
      src={size <= 32 ? entry.smallIcon : entry.icon}
      alt={labelled ? entry.name : ""}
      width={size}
      height={size}
      draggable={false}
      decoding="async"
    />
  );
}

export function ProductLockup({ app, theme = "light", height = 40, className }) {
  const entry = typeof app === "string" ? appById(app) : app;
  if (!entry) return null;
  return (
    <img
      className={className}
      src={entry.lockup[theme]}
      alt={entry.name}
      height={height}
      width={Math.round(height * entry.lockupRatio)}
      draggable={false}
      decoding="async"
    />
  );
}

export function AppTitle({ app, children }) {
  return (
    <span className="app-title">
      <AppIcon app={app} size={28} />
      <span>{children}</span>
    </span>
  );
}
