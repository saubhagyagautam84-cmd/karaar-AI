import Link from "next/link";
import {
  ArrowRight, BadgeCheck, BarChart3, BookOpen, CheckCircle2, Fingerprint, Globe, IndianRupee, KeyRound,
  Languages, Lock, MessageCircle, Mic, Search, ShieldCheck, TriangleAlert, Users,
} from "lucide-react";
import { Logo } from "@/components/ui";

const STEPS = [
  { icon: Mic, title: "Record", body: "Both parties consent and talk, in any Indian language." },
  { icon: Search, title: "Extract", body: "AI pulls out price, scope, advance and deadline." },
  { icon: TriangleAlert, title: "Flag gaps", body: "“Ceiling painting not discussed.” Fixed before it's a fight." },
  { icon: CheckCircle2, title: "Confirm", body: "Each side gets a summary in their language: “Haan, pakka.”" },
  { icon: Lock, title: "Seal & pay", body: "SHA-256 sealed, advance paid over UPI, linked to the record." },
];

const DPI = [
  { icon: Languages, name: "Bhashini", role: "Language AI" },
  { icon: IndianRupee, name: "UPI", role: "Payments" },
  { icon: Lock, name: "DigiLocker", role: "Verifiable documents" },
  { icon: KeyRound, name: "Aadhaar e-KYC", role: "Identity" },
  { icon: Users, name: "e-Shram", role: "Worker linkage" },
  { icon: BookOpen, name: "e-Daakhil", role: "Dispute filing" },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo size={32} />
        <Link href="/new" className="btn-primary px-4 py-2 text-sm">
          Open app <ArrowRight size={16} />
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-8 md:grid-cols-[1.15fr_0.85fr] md:pt-16">
        <div className="animate-rise">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-navy px-3 py-1.5 text-xs font-bold text-cream">
            <Globe size={14} /> Built on India&apos;s Digital Public Infrastructure
          </p>
          <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-tight text-navy sm:text-6xl lg:text-7xl">
            Bolo.
            <br />
            <span className="text-saffron">Pakka Karo.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-navy-body sm:text-xl">
            India runs on <em>“bhai, pakka.”</em> Karaar AI turns that spoken deal into a verified, bilingual,
            tamper-evident agreement, without asking anyone to fill a form.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/new" className="btn-accent text-lg">
              <Mic size={20} /> Start a deal
            </Link>
            <Link href="/dashboard" className="btn-ghost text-lg">
              <BarChart3 size={20} /> Governance view
            </Link>
          </div>
          <p className="mt-6 flex items-center gap-2 text-sm font-semibold text-leaf">
            <ShieldCheck size={18} /> Consent-first · No Aadhaar storage · Aligned with DPDP Act 2023 principles
          </p>
        </div>

        {/* Phone mock: the WhatsApp confirmation */}
        <div className="relative mx-auto w-full max-w-sm">
          <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-cream" aria-hidden />
          <div className="rounded-[2.2rem] border-[10px] border-navy bg-[#EFE7DC] shadow-lift">
            <div className="flex items-center gap-3 rounded-t-[1.4rem] bg-leaf px-4 py-3 text-white">
              <Logo size={30} withText={false} />
              <div>
                <p className="text-sm font-bold leading-tight">Karaar AI</p>
                <p className="text-xs opacity-80">WhatsApp</p>
              </div>
            </div>
            <div className="space-y-3 p-4 text-[13px] leading-snug">
              <div className="max-w-[90%] rounded-xl rounded-tl-none bg-white p-3 text-navy shadow-sm">
                <p className="font-bold">🧾 करार KR-4821</p>
                <p className="mt-1">काम: पुताई — 2 बेडरूम, हॉल, किचन</p>
                <p>कुल रकम: ₹18,000 · एडवांस: ₹5,000</p>
                <p>समय: 6 दिन</p>
                <p className="mt-1 font-semibold text-alert">⚠ छत शामिल नहीं</p>
                <p className="mt-2 text-navy-muted">सही है तो जवाब दें: हाँ, पक्का ✅</p>
              </div>
              <div className="ml-auto w-fit rounded-xl rounded-tr-none bg-[#D9FDD3] px-3 py-2 font-semibold text-navy shadow-sm">
                Haan, pakka ✅
              </div>
              <div className="max-w-[85%] rounded-xl rounded-tl-none bg-white p-3 text-navy shadow-sm">
                <p className="flex items-center gap-1.5 font-bold text-leaf">
                  <Fingerprint size={14} /> Sealed
                </p>
                <p className="font-mono text-[11px] text-navy-muted">sha256 9f2c41ab…e07d13</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-line/70 bg-cream/60">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">A spoken deal becomes a verified agreement</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card relative bg-paper">
                <span className="absolute right-4 top-4 font-display text-4xl font-extrabold text-saffron/20">{i + 1}</span>
                <s.icon className="text-saffron-ink" size={28} />
                <h3 className="mt-4 font-display text-lg font-bold">{s.title}</h3>
                <p className="mt-1 text-navy-body">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 rounded-2xl bg-saffron p-6 font-display text-xl font-semibold text-navy sm:text-2xl">
            We don&apos;t change behaviour. People still just talk; the technology builds trust around it.
          </p>
        </div>
      </section>

      {/* Three layers */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <p className="eyebrow">Three layers</p>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">One record, three kinds of value</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { icon: MessageCircle, title: "Citizen layer", body: "Record, review and confirm deals in the app and on WhatsApp.", href: "/new", cta: "Start a deal", cls: "bg-saffron-soft" },
            { icon: BadgeCheck, title: "Trust layer", body: "Workers own a verified job history they can share with lenders.", href: "/profile", cta: "See a profile", cls: "bg-cream" },
            { icon: BarChart3, title: "Governance layer", body: "Anonymised wage, delay and dispute insight for labour departments.", href: "/dashboard", cta: "Open dashboard", cls: "bg-navy text-cream" },
          ].map((l) => (
            <Link key={l.title} href={l.href} className={`group rounded-2xl p-6 transition hover:-translate-y-0.5 hover:shadow-lift ${l.cls}`}>
              <l.icon size={30} />
              <h3 className="mt-4 font-display text-xl font-bold">{l.title}</h3>
              <p className="mt-1 opacity-85">{l.body}</p>
              <span className="mt-4 inline-flex items-center gap-1 font-semibold">
                {l.cta} <ArrowRight size={16} className="transition group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* DPI */}
      <section className="bg-navy text-cream">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-saffron">DPI integrations</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Plugs into rails India already built</h2>
          <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {DPI.map((d) => (
              <div key={d.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <d.icon className="text-saffron" size={24} />
                <p className="mt-3 font-bold">{d.name}</p>
                <p className="text-sm text-navy-line">{d.role}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm italic text-navy-line">
            Government APIs are adapters with simulated responses in the prototype; ready to plug in after approval.
          </p>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-10 text-sm text-navy-muted">
        <Logo size={26} />
        <p>Track 1 · AI for Digital Public Infrastructure &amp; Governance · Solo project by Saubhagya Gautam</p>
      </footer>
    </div>
  );
}
