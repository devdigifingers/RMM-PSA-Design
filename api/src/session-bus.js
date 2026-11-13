// In-process wake-ups for Session Panel long-polls (chat and files). The database stays the source of truth, so a
// missed wake-up only delays an update until the next poll.
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function wakeSession(sessionId) {
  bus.emit(String(sessionId));
}

// Resolves when the session changes, after ms, or when the request closes, whichever is first.
export function waitForSession(sessionId, ms, req = null) {
  return new Promise((resolve) => {
    const key = String(sessionId);
    const done = () => {
      clearTimeout(timer);
      bus.off(key, done);
      req?.off?.("close", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    bus.on(key, done);
    req?.on?.("close", done);
  });
}
