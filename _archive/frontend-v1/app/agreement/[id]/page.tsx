import { notFound } from "next/navigation";
import AgreementWorkspace from "@/components/AgreementWorkspace";
import { fetchAgreement } from "@/lib/api";
import type { AgreementRecord } from "@/lib/types";

export default async function AgreementPage({
  params,
}: PageProps<"/agreement/[id]">) {
  const { id } = await params;

  let record: AgreementRecord | null;
  try {
    record = await fetchAgreement(id);
  } catch {
    return (
      <p
        role="alert"
        className="rounded-xl bg-danger-soft px-4 py-3 font-medium text-danger"
      >
        Could not reach the Karaar server. Start it with{" "}
        <code>npm run dev</code> and refresh.
      </p>
    );
  }
  if (!record) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Your agreement</h1>
      <AgreementWorkspace initial={record.agreement} />
      <p className="text-xs text-muted">
        Recorded {new Date(record.created_at).toLocaleString("en-IN")}. This
        becomes a confirmed record of your agreement once both people say
        &ldquo;Haan, pakka&rdquo;.
      </p>
    </div>
  );
}
