"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { OutboundMessage, Role } from "@/lib/types";

const LABEL: Record<Role, string> = {
  worker: "Worker's phone",
  client: "Client's phone",
};

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part.replace(/^https?:\/\/[^/]+/, "")}
            className="break-all text-leaf underline"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Demo "phone preview": what each party receives on WhatsApp (mock outbox). */
export default function PhonePreview({
  agreementId,
  refreshKey,
}: {
  agreementId: string;
  refreshKey: number;
}) {
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [tab, setTab] = useState<Role>("worker");

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .messages(agreementId)
        .then((m) => alive && setMessages(m))
        .catch(() => {});
    load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [agreementId, refreshKey]);

  if (messages.length === 0) return null;
  const byRole = (role: Role) =>
    messages.filter((m) => m.party_role === role).reverse();

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Phone preview</h2>
        <div className="flex rounded-lg bg-background p-1 text-sm sm:hidden">
          {(["worker", "client"] as Role[]).map((r) => (
            <button
              key={r}
              onClick={() => setTab(r)}
              className={`rounded-md px-3 py-1.5 font-medium ${tab === r ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {r === "worker" ? "Worker" : "Client"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(["worker", "client"] as Role[]).map((role) => (
          <div
            key={role}
            className={`${tab === role ? "block" : "hidden"} sm:block`}
          >
            <div className="rounded-[1.5rem] border-4 border-foreground/80 bg-[#e7ddd3] p-2 dark:bg-[#0b141a]">
              <div className="flex items-center justify-between rounded-t-xl bg-[#075e54] px-3 py-2 text-xs text-white">
                <span className="font-semibold">Karaar AI</span>
                <span>{byRole(role)[0]?.to_masked ?? LABEL[role]}</span>
              </div>
              <div className="max-h-96 space-y-2 overflow-y-auto p-2">
                {byRole(role).map((m) => (
                  <div
                    key={m.message_id + m.sent_at}
                    className="fill-in rounded-lg rounded-tl-none bg-white p-2.5 text-[13px] leading-snug whitespace-pre-wrap text-[#111] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]"
                  >
                    <Linkified text={m.body} />
                    <p className="mt-1 text-right text-[10px] opacity-60">
                      {new Date(m.sent_at).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      ✓✓
                    </p>
                  </div>
                ))}
                {byRole(role).length === 0 && (
                  <p className="p-4 text-center text-xs opacity-60">
                    No messages yet
                  </p>
                )}
              </div>
            </div>
            <p className="mt-1 text-center text-xs text-muted">{LABEL[role]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
