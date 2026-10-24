/* eslint-disable @next/next/no-img-element */
export function Wordmark({ tagline = false }) {
  return (
    <img
      className="wordmark"
      src={tagline ? "/brand/logo-horizontal-dark.svg" : "/brand/logo-horizontal-dark-notag.svg"}
      alt="Digital Fingers"
    />
  );
}
