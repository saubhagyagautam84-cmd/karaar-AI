import { CheckCheck, Clock3 } from "lucide-react";
import { Logo } from "./ui";

/** Renders WhatsApp-style *bold* text. */
function WaText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i} className={line === "" ? "h-2" : undefined}>
          {line.split(/(\*[^*]+\*)/g).map((part, j) =>
            part.startsWith("*") && part.endsWith("*") ? <b key={j}>{part.slice(1, -1)}</b> : <span key={j}>{part}</span>,
          )}
        </p>
      ))}
    </>
  );
}

export function WhatsAppPreview({
  to, text, state, reply,
}: { to: string; text: string; state: "draft" | "sending" | "sent"; reply?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-[#EFE7DC]">
      <div className="flex items-center gap-2.5 bg-leaf px-3 py-2.5 text-white">
        <Logo size={26} withText={false} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight">Karaar AI → {to}</p>
          <p className="text-[11px] opacity-80">WhatsApp Business</p>
        </div>
      </div>
      <div className="space-y-2 p-3 text-[13.5px] leading-snug text-navy">
        <div className="max-w-[92%] rounded-xl rounded-tl-none bg-white p-3 shadow-sm">
          <WaText text={text} />
          <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-navy-muted">
            {state === "draft" ? "Preview" : state === "sending" ? <Clock3 size={12} /> : <CheckCheck size={14} className="text-[#34B7F1]" />}
          </p>
        </div>
        {reply && (
          <div className="ml-auto w-fit animate-rise rounded-xl rounded-tr-none bg-[#D9FDD3] px-3 py-2 font-semibold shadow-sm">{reply}</div>
        )}
      </div>
    </div>
  );
}
