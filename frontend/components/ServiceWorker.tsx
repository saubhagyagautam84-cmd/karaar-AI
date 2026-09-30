"use client";

import { useEffect } from "react";

/** B2: offline support in production builds. In development any worker is removed so pages never go stale. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    } else {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => undefined);
    }
  }, []);
  return null;
}
