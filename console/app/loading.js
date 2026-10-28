import { BrandMark } from "./mark";

export default function Loading() {
  return (
    <main className="df-loading" aria-busy="true" aria-live="polite">
      <BrandMark className="df-loading-mark" size={48} decorative />
      <span className="df-loading-text">Loading…</span>
    </main>
  );
}
