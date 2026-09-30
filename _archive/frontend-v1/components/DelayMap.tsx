"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { delayToken, type DistrictDelay } from "@/lib/delay";

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Payment-delay hotspots: one circle per district, colour = share of delayed payments. */
export default function DelayMap({
  districts,
}: {
  districts: DistrictDelay[];
}) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, {
      scrollWheelZoom: false,
      zoomSnap: 0.25,
      attributionControl: true,
    });
    // Street tiles when online; offline the circles and labels still draw on a plain background.
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 14,
      opacity: 0.55,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    const markers = districts.map((d) => {
      const radius = d.n ? Math.max(8, Math.sqrt(d.n) * 1.8) : 8;
      const marker = L.circleMarker([d.lat, d.lng], {
        radius,
        weight: 2,
        color: css("--surface"),
        fillColor: d.suppressed
          ? css("--suppressed")
          : css(delayToken(d.delayed_pct ?? 0)),
        fillOpacity: d.suppressed ? 0.5 : 0.9,
        dashArray: d.suppressed ? "4 4" : undefined,
      });
      const label = d.suppressed
        ? `${d.district}: hidden (<10)`
        : `${d.district}: ${d.delayed_pct}%`;
      // West-side districts label to the left so neighbouring labels do not collide.
      const left = d.lng < 77.2;
      marker.bindTooltip(label, {
        permanent: true,
        direction: left ? "left" : "right",
        offset: [left ? -radius : radius, 0],
        className: "delay-label",
      });
      marker.bindPopup(
        d.suppressed
          ? `<b>${d.district}</b><br/>Fewer than 10 agreements, hidden for privacy.`
          : `<b>${d.district}</b><br/>${d.delayed_pct}% of payments late (over 7 days)<br/>${d.n} completed jobs`,
      );
      return marker.addTo(map);
    });
    map.fitBounds(L.featureGroup(markers).getBounds().pad(0.35));
    return () => {
      map.remove();
    };
  }, [districts]);

  return (
    <div
      ref={el}
      role="img"
      aria-label="Map of Delhi districts showing the share of late payments"
      className="h-96 w-full overflow-hidden rounded-xl border border-line"
    />
  );
}
