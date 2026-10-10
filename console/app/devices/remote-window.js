"use client";

export function openRemoteSession({ deviceId, hostname, label = "", user = "" }) {
  const query = new URLSearchParams();
  if (hostname) query.set("host", hostname);
  if (label && label !== hostname) query.set("label", label);
  if (user) query.set("user", user);
  const popup = window.open(
    `/devices/${deviceId}/session?${query}`,
    `df-remote-${deviceId}`,
    "popup=yes,width=1280,height=800,resizable=yes",
  );
  if (popup) popup.focus();
  return Boolean(popup);
}
