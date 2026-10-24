"use client";

import { useEffect, useState } from "react";
import { remoteSessions } from "../actions";

let latest = {};
let timer = null;
let busy = false;
const listeners = new Set();

async function poll() {
  if (busy || document.visibilityState === "hidden") return;
  busy = true;
  try {
    const result = await remoteSessions();
    if (result.ok) {
      latest = result.sessions;
      listeners.forEach((listener) => listener(latest));
    }
  } catch {
    // keep the last known state
  } finally {
    busy = false;
  }
}

export function refreshSessions() {
  return poll();
}

export function useDeviceSessions(deviceId) {
  return useAllSessions()[String(deviceId)] || null;
}

export function useAllSessions() {
  const [all, setAll] = useState(latest);
  useEffect(() => {
    listeners.add(setAll);
    if (listeners.size === 1) {
      poll();
      timer = setInterval(poll, 15000);
      window.addEventListener("focus", poll);
    }
    return () => {
      listeners.delete(setAll);
      if (listeners.size === 0) {
        clearInterval(timer);
        timer = null;
        window.removeEventListener("focus", poll);
      }
    };
  }, []);
  return all;
}
