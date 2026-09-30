export type Role = "worker" | "hirer";

export interface Party {
  name: string;
  phone: string;
  lang: string; // language code, see lib/languages.ts
  role: Role;
  phoneHash?: string; // set by the backend, which keeps only the masked number
}

export interface Segment {
  speaker: Role;
  text: string;
  t: number; // seconds from start
  uncertain?: boolean; // speaker label was guessed (C4: "Who said this?")
}

/** A bilingual line item, e.g. a room included in scope. */
export interface Bilingual {
  en: string;
  hi: string;
}

/** A payment milestone. Part of the sealed terms (A1). */
export interface Milestone {
  id: string;
  title: string;
  titleHi?: string;
  amount: number;
}

export interface Terms {
  jobType: string;
  location: string;
  scope: Bilingual[];
  excluded: Bilingual[];
  price: number | null;
  advance: number | null;
  advanceAdjusted: boolean | null; // is the advance deducted from the total?
  durationDays: number | null;
  deadline: string | null; // ISO date
  materialsBy: Role | null; // who pays for material
  balanceWhen: string | null;
  paymentMode: "UPI" | "Cash" | null;
  /** Optional: when present, the balance is paid milestone by milestone. Sum = balance due. */
  milestones?: Milestone[];
  /** Optional: answers to rule-pack questions (warranty, cleanup, hours…), sealed with the terms. */
  notes?: Bilingual[];
}

export type Severity = "high" | "medium" | "low";

export interface FlagOption {
  id: string;
  label: string;
}

export interface Flag {
  id: string; // stable rule id, e.g. "ceiling", "materials"
  severity: Severity;
  title: string;
  titleHi: string;
  detail: string;
  evidence?: string; // quote from the transcript
  options?: FlagOption[];
  input?: "date";
  resolved: boolean;
  resolution?: string;
}

export type Status =
  | "review"
  | "awaiting_confirmation"
  | "sealed"
  | "advance_paid"
  | "completed"
  | "disputed";

export type Channel = "whatsapp" | "in_app" | "ivr";

export interface Confirmation {
  at: string;
  channel: Channel;
  reply: string;
  lang: string;
}

export interface Payment {
  id: string;
  kind: "advance" | "balance" | "milestone" | "settlement";
  amount: number;
  at: string;
  upiRef: string;
  milestoneId?: string;
}

export interface AgreementEvent {
  at: string;
  label: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Outside the sealed hash: what happens after both people said "Haan, pakka".
// ---------------------------------------------------------------------------

/** A proof-of-work photo (A2). The image itself lives in IndexedDB (demo) or on the server (live). */
export interface Photo {
  id: string;
  kind: "before" | "after";
  hash: string; // SHA-256 of the (compressed) image bytes
  takenAt: string;
  size: number;
  lat?: number;
  lng?: number;
  url?: string; // live mode: where the server keeps it
}

export type MilestoneStatus = "pending" | "submitted" | "approved" | "rejected" | "paid";

export interface MilestoneProgress {
  status: MilestoneStatus;
  photos: Photo[];
  submittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectReason?: string;
  paidAt?: string;
  upiRef?: string;
}

/** What a change order adds or removes (A3). */
export interface TermsDelta {
  addScope: Bilingual[];
  removeScope: Bilingual[];
  priceChange: number; // + or − rupees
  extraDays: number;
  note?: string;
  /** Extra milestone for the added price, when the agreement pays by milestones. */
  addMilestones?: Milestone[];
}

/** A change order or a settlement: separately sealed, chained to the one before it. */
export interface Amendment {
  id: string; // e.g. KR-6123-A1
  createdAt: string;
  source: "change" | "settlement";
  description: string;
  transcript: Segment[];
  delta: TermsDelta;
  parentHash: string; // the agreement's hash, or the previous amendment's
  confirmations: Partial<Record<Role, Confirmation>>;
  hash?: string;
  sealedAt?: string;
}

export type DisputeReason = "Scope not agreed" | "Advance not adjusted" | "Late payment" | "Quality of work" | "Deadline missed" | "Other";

export interface Statement {
  text: string;
  at: string;
  channel: "text" | "voice";
}

export interface CalcLine {
  label: string;
  amount: number;
}

/** The AI mediator's output (A4). A suggestion based on the record, never a legal judgment. */
export interface Mediation {
  at: string;
  engine: "rules" | "llm";
  facts: string[];
  agreed: string[];
  contested: string[];
  calculation: CalcLine[];
  payToWorker: number; // settlement: what the hirer still pays the worker (0 or more)
  refundToHirer: number; // settlement: what the worker returns (0 or more)
  suggestion: string;
  evidence: string[];
  disclaimer: string;
}

export interface Dispute {
  raisedBy: Role;
  raisedAt: string;
  reason: DisputeReason;
  statements: Partial<Record<Role, Statement>>;
  previousStatus: Status;
  mediation?: Mediation;
  accepted?: Partial<Record<Role, string>>; // accepted at
  outcome?: "settled" | "escalated";
}

export interface RatingSet {
  onTime: number;
  fair: number;
  respectful: number;
  at: string;
}

export interface Agreement {
  id: string;
  createdAt: string;
  status: Status;
  worker: Party;
  hirer: Party;
  consent: { worker: boolean; hirer: boolean; at: string };
  audioSeconds: number;
  transcript: Segment[];
  terms: Terms;
  flags: Flag[];
  confirmations: Partial<Record<Role, Confirmation>>;
  hash?: string;
  sealedAt?: string;
  payments: Payment[];
  events: AgreementEvent[];
  rating?: number; // hirer's rating of the worker after completion, 1-5
  // Outside the hash:
  progress?: Record<string, MilestoneProgress>; // keyed by milestone id ("work" when no milestones)
  amendments?: Amendment[];
  dispute?: Dispute;
  ratings?: { byHirer?: RatingSet; byWorker?: RatingSet }; // B4: two-way ratings
}
