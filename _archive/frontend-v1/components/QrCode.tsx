import { encodeQr, qrSvgPath } from "@/lib/qr";

export default function QrCode({
  text,
  label,
  size = 208,
}: {
  text: string;
  label: string;
  size?: number;
}) {
  const { viewBox, d } = qrSvgPath(encodeQr(text, "M"));
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={viewBox}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-lg bg-white"
    >
      <path d={d} fill="#000" />
    </svg>
  );
}
