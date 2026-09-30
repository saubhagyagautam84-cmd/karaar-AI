export interface DistrictDelay {
  district: string;
  lat: number;
  lng: number;
  suppressed: boolean;
  n: number | null;
  delayed_pct: number | null;
}

/** Sequential bins for the late-payment map (orange ramp, light -> dark). */
export const DELAY_BINS = [
  { max: 5, token: "--heat-1", label: "under 5%" },
  { max: 10, token: "--heat-2", label: "5–10%" },
  { max: 15, token: "--heat-3", label: "10–15%" },
  { max: 20, token: "--heat-4", label: "15–20%" },
  { max: Infinity, token: "--heat-5", label: "20% or more" },
];

export function delayToken(pct: number): string {
  return (
    DELAY_BINS.find((b) => pct < b.max) ?? DELAY_BINS[DELAY_BINS.length - 1]
  ).token;
}
