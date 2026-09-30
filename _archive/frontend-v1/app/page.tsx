import Link from "next/link";

const LAYERS = [
  {
    name: "Citizen",
    text: "Both people agree to record, then just talk. Karaar AI turns the talk into clear terms and flags anything unclear.",
  },
  {
    name: "Trust",
    text: "Every completed job adds to the worker's own verified work history, shared only when they choose.",
  },
  {
    name: "Governance",
    text: "Labour departments see anonymised wage and delay trends, never a name or a single agreement.",
  },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="pt-4">
        <h1 className="text-4xl font-bold leading-tight">
          Bolo. <span className="text-saffron">Pakka Karo.</span>
        </h1>
        <p className="mt-3 text-lg text-muted">
          India runs on &ldquo;bhai, pakka.&rdquo; Karaar AI makes
          &ldquo;pakka&rdquo; actually pakka: a confirmed record of your spoken
          agreement, in your own language.
        </p>
        <Link
          href="/record"
          className="mt-6 flex h-14 items-center justify-center rounded-2xl bg-saffron px-6 text-lg font-semibold text-white shadow-sm hover:opacity-90 sm:inline-flex"
        >
          Record an agreement
        </Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {LAYERS.map((layer) => (
          <div
            key={layer.name}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <p className="text-sm font-semibold text-leaf">{layer.name}</p>
            <p className="mt-1 text-sm text-muted">{layer.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
