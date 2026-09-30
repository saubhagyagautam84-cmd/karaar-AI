"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, Building2, HardHat, KeyRound, Lock, Phone, UserRound, Wrench } from "lucide-react";
import { PageHeader, Spinner, cn } from "@/components/ui";
import { sendOtp, verifyOtp } from "@/lib/account";
import { ROLE_LABEL, setSession, type AccountRole } from "@/lib/session";

const HOME: Record<AccountRole, string> = { worker: "/profile", hirer: "/new", contractor: "/deals", officer: "/dashboard" };
const ICON: Record<AccountRole, React.ReactNode> = {
  worker: <Wrench size={18} />,
  hirer: <UserRound size={18} />,
  contractor: <HardHat size={18} />,
  officer: <Building2 size={18} />,
};

export default function LoginPage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <Login />
    </Suspense>
  );
}

/** B7: sign in with a phone number and a one-time code. Aadhaar is never needed. */
function Login() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AccountRole>("worker");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<null | { to: string; demoCode: string | null }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader eyebrow="Sign in · लॉग इन" title="Your phone number is your key" sub="We send a one-time code. No password, no Aadhaar." />

      <section className="card space-y-5">
        <fieldset>
          <legend className="label">I am a · मैं हूँ</legend>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ROLE_LABEL) as AccountRole[]).map((r) => (
              <label key={r} className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl border-2 p-3 text-sm", role === r ? "border-saffron bg-saffron-soft/60" : "border-line bg-paper")}>
                <input type="radio" name="role" className="sr-only" checked={role === r} onChange={() => setRole(r)} />
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", role === r ? "bg-saffron text-white" : "bg-cream text-navy")}>{ICON[r]}</span>
                <span>
                  <b className="block">{ROLE_LABEL[r].en}</b>
                  <span className="text-navy-muted">{ROLE_LABEL[r].hi}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setSent(await sendOtp(phone));
              setCode("");
            });
          }}
        >
          <label className="label" htmlFor="login-phone">Mobile number · मोबाइल नंबर</label>
          <div className="flex gap-2">
            <div className="flex flex-1">
              <span className="flex items-center rounded-l-xl border border-r-0 border-line bg-cream px-3 text-navy-muted">+91</span>
              <input
                id="login-phone"
                className="input rounded-l-none"
                inputMode="tel"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, "").slice(0, 11))}
                placeholder="98100 12345"
              />
            </div>
            <button className="btn-primary shrink-0" disabled={busy || phone.replace(/\D/g, "").length < 10}>
              <Phone size={17} /> {sent ? "Resend" : "Send code"}
            </button>
          </div>
        </form>

        {sent && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const s = await verifyOtp(phone, code, role);
                setSession(s);
                router.push(next && next.startsWith("/") ? next : HOME[s.role]);
              });
            }}
            className="space-y-2"
          >
            <p className="text-sm text-navy-body">Code sent to +91 {sent.to}.</p>
            {sent.demoCode && (
              <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm font-semibold text-amber-ink">
                Demo: no SMS is sent. The code is <span className="font-mono">{sent.demoCode}</span>.
              </p>
            )}
            <label className="label" htmlFor="login-code">6-digit code · कोड</label>
            <div className="flex gap-2">
              <input
                id="login-code"
                className="input font-mono tracking-[0.4em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <button className="btn-success shrink-0" disabled={busy || code.length !== 6}>
                <KeyRound size={17} /> Sign in
              </button>
            </div>
          </form>
        )}
        {error && <p className="rounded-lg bg-alert-soft p-2.5 text-sm font-semibold text-alert">{error}</p>}

        <ul className="space-y-1.5 border-t border-line/70 pt-4 text-xs text-navy-muted">
          <li className="flex items-center gap-1.5"><Lock size={13} /> Only a masked number and a one-way hash are stored.</li>
          <li className="flex items-center gap-1.5"><BadgeCheck size={13} /> Codes last 5 minutes; 5 wrong tries lock the code.</li>
        </ul>
      </section>
    </div>
  );
}
