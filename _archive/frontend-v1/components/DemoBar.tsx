"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";

/** DEMO_MODE only: says so, and offers a one-tap reset between demo runs. */
export default function DemoBar() {
  const [demo, setDemo] = useState(false);
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "done">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    api
      .health()
      .then((h) => setDemo(Boolean(h.demo_mode)))
      .catch(() => {});
  }, []);

  if (!demo) return null;

  async function reset() {
    setState("busy");
    setError(null);
    try {
      await api.post("/api/demo/reset");
      setState("done");
      router.push("/record");
      router.refresh();
    } catch (e) {
      setError(errorText(e));
      setState("idle");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>Demo mode: all services are simulated and work offline.</span>
      {state === "confirm" ? (
        <span className="flex gap-2">
          <button
            onClick={reset}
            className="font-semibold text-danger underline"
          >
            Yes, clear demo agreements
          </button>
          <button onClick={() => setState("idle")} className="underline">
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setState("confirm")}
          disabled={state === "busy"}
          className="font-semibold text-saffron underline"
        >
          {state === "busy"
            ? "Resetting…"
            : state === "done"
              ? "Cleared ✓"
              : "Reset demo"}
        </button>
      )}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
