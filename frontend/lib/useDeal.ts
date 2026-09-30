"use client";

import { useParams } from "next/navigation";
import { useAgreements } from "./store";

export function useDeal() {
  const params = useParams<{ id: string }>();
  const { ready, get, save, source, flush } = useAgreements();
  const id = decodeURIComponent(params.id);
  return { ready, deal: get(id), save, id, live: source === "server", flush: () => flush(id) };
}
