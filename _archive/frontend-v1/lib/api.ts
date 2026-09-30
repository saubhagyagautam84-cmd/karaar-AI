import type {
  AgreementRecord,
  ConfirmView,
  DraftResponse,
  Health,
  Milestone,
  OutboundMessage,
  Sample,
  SendResult,
  Verification,
  WorkerProfile,
} from "./types";

/** Server components call FastAPI directly; the browser goes through the /api rewrite. */
const serverBase = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function readError(res: Response): Promise<ApiError> {
  let message = "Something went wrong. Please try again.";
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") message = body.detail;
    else if (Array.isArray(body?.detail))
      message =
        "Some details are missing or not valid. Please check and try again.";
  } catch {
    // keep the plain-language default
  }
  return new ApiError(message, res.status);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // Reads are retried once: a dropped proxy connection should never show up on stage.
  const attempts = !init?.method || init.method === "GET" ? 2 : 1;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(path, { cache: "no-store", ...init });
    } catch {
      if (attempt < attempts) continue;
      throw new ApiError(
        "Could not reach the Karaar server. Is it running?",
        0,
      );
    }
    if (res.status >= 500 && attempt < attempts) continue;
    if (!res.ok) throw await readError(res);
    return res.json();
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => call<Health>("/api/health"),
  samples: () => call<Sample[]>("/api/agreements/samples"),
  draft: (form: FormData) =>
    call<DraftResponse>("/api/agreements/draft", {
      method: "POST",
      body: form,
    }),
  agreement: (id: string) =>
    call<AgreementRecord>(`/api/agreements/${encodeURIComponent(id)}`),
  answer: (
    id: string,
    body: { field: string; question_en: string; answer: string; by?: string },
  ) =>
    call<AgreementRecord>(
      `/api/agreements/${encodeURIComponent(id)}/answers`,
      json(body),
    ),
  send: (id: string) =>
    call<SendResult>(
      `/api/agreements/${encodeURIComponent(id)}/send`,
      json({ by: "client" }),
    ),
  messages: (id: string) =>
    call<OutboundMessage[]>(
      `/api/agreements/${encodeURIComponent(id)}/messages`,
    ),
  verify: (id: string) =>
    call<Verification>(`/api/agreements/${encodeURIComponent(id)}/verify`),
  confirmView: (token: string) =>
    call<ConfirmView>(`/api/confirm/${encodeURIComponent(token)}`),
  decide: (token: string, decision: "yes" | "no", note?: string) =>
    call<{ status: string; view: ConfirmView | null }>(
      `/api/confirm/${encodeURIComponent(token)}`,
      json({ decision, note }),
    ),
  milestones: (id: string) =>
    call<Milestone[]>(`/api/agreements/${encodeURIComponent(id)}/milestones`),
  markDone: (id: string, form: FormData) =>
    call<{ status: string }>(`/api/agreements/${encodeURIComponent(id)}/done`, {
      method: "POST",
      body: form,
    }),
  worker: (id: string, q: { key?: string; share?: string }) =>
    call<WorkerProfile>(
      `/api/workers/${encodeURIComponent(id)}?${new URLSearchParams(q as Record<string, string>)}`,
    ),
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body: unknown = {}) => call<T>(path, json(body)),
};

/** For server components. Returns null when the agreement does not exist. */
export async function fetchAgreement(
  id: string,
): Promise<AgreementRecord | null> {
  const res = await fetch(
    `${serverBase}/api/agreements/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await readError(res);
  return res.json();
}

export function errorText(e: unknown): string {
  return e instanceof ApiError
    ? e.message
    : "Something went wrong. Please try again.";
}
