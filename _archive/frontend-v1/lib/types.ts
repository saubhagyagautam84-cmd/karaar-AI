// Mirrors backend/app/schemas/agreement.py

export type Status =
  | "DRAFT"
  | "SENT"
  | "CONFIRMED_BY_ONE"
  | "CONFIRMED_BY_BOTH"
  | "ADVANCE_PAID"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "DISPUTED"
  | "RESOLVED"
  | "ESCALATED";

export type Role = "client" | "worker";
export type Lang = "hi" | "en";

export interface Party {
  name: string | null;
  phone: string | null; // always masked
  preferred_lang: string | null;
}

export interface WorkerParty extends Party {
  trade: string | null;
  eshram_linked: boolean;
}

export interface Ambiguity {
  field: string;
  question_en: string;
  question_local: string;
}

export interface Evidence {
  field: string;
  quote: string;
  source: "transcript" | "answer";
}

export interface AgreementTerms {
  agreement_id: string;
  language_detected: string[];
  parties: { client: Party; worker: WorkerParty };
  scope: string | null;
  scope_local: string | null;
  price_inr: number | null;
  advance_inr: number | null;
  materials_provided_by: "client" | "worker" | "shared" | null;
  start_date: string | null;
  deadline: string | null;
  conditions: string[];
  conditions_local: string[];
  ambiguities: Ambiguity[];
  evidence: Evidence[];
  status: Status;
  hash: string | null;
  audio_ref: string | null;
}

export interface DraftResponse {
  agreement: AgreementTerms;
  transcript: string;
  providers: Record<string, string>;
}

export interface AgreementRecord {
  agreement: AgreementTerms;
  created_at: string;
  updated_at: string;
}

export interface Sample {
  id: number;
  title: string;
  text: string;
}

export interface OutboundMessage {
  message_id: string;
  agreement_id: string | null;
  party_role: Role | null;
  to_masked: string;
  body: string;
  channel: string;
  sent_at: string;
}

export interface SendResult {
  status: Status;
  links: { role: Role; token: string; url: string }[];
  messages: OutboundMessage[];
}

export interface ConfirmView {
  agreement_id: string;
  role: Role;
  lang: Lang;
  name: string | null;
  status: Status;
  summary: string[];
  summary_en: string[] | null;
  agreement: AgreementTerms;
  confirmed_at: string | null;
  other_confirmed: boolean;
  hash: string | null;
  worker_link?: string | null;
}

export interface Verification {
  agreement_id: string;
  status: Status;
  hashed: boolean;
  stored_hash: string | null;
  payload: {
    terms: AgreementTerms;
    audio_sha256: string;
    confirmations: Record<string, string>;
  } | null;
  recomputed_hash: string | null;
  valid: boolean | null;
  erased_at: string | null;
}

export interface Health {
  status: string;
  mode: string;
  demo_mode?: boolean;
  providers: Record<string, string>;
}

export interface Milestone {
  type: string;
  amount_inr: number | null;
  proof_ref: string | null;
  at: string;
}

export interface WorkerProfile {
  worker_id: number;
  access: "owner" | "viewer";
  name: string | null;
  trades: string[];
  jobs_completed: number;
  on_time_rate: number | null;
  total_earned_inr: number;
  eshram_linked: boolean;
  eshram_uan_masked: string | null;
  jobs: {
    agreement_id?: string;
    trade: string | null;
    district: string | null;
    price_inr: number | null;
    completed_on: string;
    on_time: boolean | null;
  }[];
  share_links?: { token: string; created_at: string; expires_at: string }[];
}
