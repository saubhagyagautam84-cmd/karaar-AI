"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";
import { canSpeak, speak, stopSpeaking } from "@/lib/speech";
import type { ConfirmView } from "@/lib/types";

const TEXT = {
  hi: {
    title: "आपका करार",
    listen: "🔊 सुनिए",
    stop: "■ रोकें",
    yes: "हाँ, पक्का",
    no: "कुछ ग़लत है",
    whatWrong: "क्या ग़लत है? (जैसे: एडवांस 3000 था)",
    sendNote: "भेजें",
    thanks: "धन्यवाद! आपने पक्का कर दिया।",
    waiting: "अब दूसरे व्यक्ति के पक्का करने का इंतज़ार है।",
    pakka: "पक्का हो गया ✅ दोनों ने पक्का कर दिया।",
    sentBack: "ठीक है। करार बदलने के लिए वापस भेज दिया गया है। नया लिंक आएगा।",
    record: "यह आपके समझौते का पक्का रिकॉर्ड है, कानूनी कॉन्ट्रैक्ट नहीं।",
    verify: "रिकॉर्ड जाँचें",
  },
  en: {
    title: "Your agreement",
    listen: "🔊 Listen",
    stop: "■ Stop",
    yes: "Haan, pakka",
    no: "Kuch galat hai",
    whatWrong: "What is wrong? (e.g. the advance was 3000)",
    sendNote: "Send",
    thanks: "Thank you! You have confirmed.",
    waiting: "Now waiting for the other person to confirm.",
    pakka: "Pakka ✅ Both of you have confirmed.",
    sentBack:
      "Okay. The agreement has been sent back to be changed. You will get a new link.",
    record:
      "This is a confirmed record of your agreement, not a legal contract.",
    verify: "Verify the record",
  },
};

export default function ConfirmPage({ params }: PageProps<"/confirm/[token]">) {
  const { token } = use(params);
  const [view, setView] = useState<ConfirmView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentBack, setSentBack] = useState(false);
  const [erase, setErase] = useState<"idle" | "confirm" | "done">("idle");

  useEffect(() => {
    api
      .confirmView(token)
      .then(setView)
      .catch((e) => setError(errorText(e)));
    return () => stopSpeaking();
  }, [token]);

  if (error && !view) {
    return (
      <p
        role="alert"
        className="rounded-xl bg-danger-soft px-4 py-3 font-medium text-danger"
      >
        {error}
      </p>
    );
  }
  if (!view) return <p className="text-muted">Loading…</p>;

  const t = TEXT[view.lang];
  const bothDone = Boolean(view.hash);

  function listen() {
    if (!view) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(view.summary.join("। "), view.lang, () => setSpeaking(false));
  }

  async function decide(decision: "yes" | "no") {
    setBusy(true);
    setError(null);
    try {
      const res = await api.decide(token, decision, note);
      if (decision === "no") setSentBack(true);
      else if (res.view) setView(res.view);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" lang={view.lang}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="font-mono text-xs text-muted">{view.agreement_id}</p>
        </div>
        {canSpeak() && (
          <button
            onClick={listen}
            className="h-12 shrink-0 rounded-xl border border-line bg-surface px-4 font-semibold hover:border-saffron"
          >
            {speaking ? t.stop : t.listen}
          </button>
        )}
      </div>

      <section className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-lg leading-relaxed">
        {view.summary.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>

      {view.summary_en && (
        <details
          className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm"
          lang="en"
        >
          <summary className="cursor-pointer font-semibold">In English</summary>
          <div className="mt-2 space-y-1 text-muted">
            {view.summary_en.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </details>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-danger-soft px-4 py-3 font-medium text-danger"
        >
          {error}
        </p>
      )}

      {sentBack ? (
        <p className="rounded-2xl bg-saffron-soft p-4 font-semibold text-saffron-ink">
          {t.sentBack}
        </p>
      ) : bothDone ? (
        <div className="space-y-3">
          <p className="rounded-2xl bg-leaf-soft p-4 text-lg font-semibold text-leaf">
            {t.pakka}
          </p>
          <Link
            href={`/verify/${view.agreement_id}`}
            className="flex h-12 items-center justify-center rounded-2xl border border-line font-semibold"
          >
            {t.verify}
          </Link>
          {view.worker_link && (
            <Link
              href={view.worker_link}
              className="flex h-12 items-center justify-center rounded-2xl border border-line font-semibold"
            >
              {view.lang === "hi" ? "मेरा काम का रिकॉर्ड" : "My work record"}
            </Link>
          )}
        </div>
      ) : view.confirmed_at ? (
        <p className="rounded-2xl bg-leaf-soft p-4 font-semibold text-leaf">
          {t.thanks} {t.waiting}
        </p>
      ) : wrong ? (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t.whatWrong}
            className="w-full rounded-xl border border-line bg-surface p-3 text-base"
          />
          <button
            onClick={() => decide("no")}
            disabled={busy}
            className="h-14 w-full rounded-2xl bg-danger text-lg font-semibold text-white disabled:opacity-60"
          >
            {t.sendNote}
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          <button
            onClick={() => decide("yes")}
            disabled={busy}
            className="h-16 rounded-2xl bg-leaf text-xl font-bold text-white shadow-sm disabled:opacity-60"
          >
            ✓ {t.yes}
          </button>
          <button
            onClick={() => setWrong(true)}
            disabled={busy}
            className="h-14 rounded-2xl border-2 border-danger/50 text-lg font-semibold text-danger"
          >
            ✗ {t.no}
          </button>
        </div>
      )}

      <p className="text-center text-xs text-muted">{t.record}</p>

      <div className="text-center text-xs">
        {erase === "done" ? (
          <p className="text-muted">
            {view.lang === "hi"
              ? "आपका डेटा और रिकॉर्डिंग हटा दिए गए।"
              : "Your personal data and the recording were deleted."}
          </p>
        ) : erase === "confirm" ? (
          <p className="space-x-3">
            <span>
              {view.lang === "hi" ? "पक्का हटाना है?" : "Delete for good?"}
            </span>
            <button
              className="font-semibold text-danger underline"
              onClick={() =>
                api
                  .post(`/api/confirm/${token}/erase`)
                  .then(() => setErase("done"))
                  .catch((e) => setError(errorText(e)))
              }
            >
              {view.lang === "hi" ? "हाँ, हटाइए" : "Yes, delete"}
            </button>
            <button className="underline" onClick={() => setErase("idle")}>
              {view.lang === "hi" ? "रहने दें" : "Cancel"}
            </button>
          </p>
        ) : (
          <button
            className="text-muted underline"
            onClick={() => setErase("confirm")}
          >
            {view.lang === "hi" ? "मेरा डेटा हटाएँ" : "Delete my data"}
          </button>
        )}
      </div>
    </div>
  );
}
