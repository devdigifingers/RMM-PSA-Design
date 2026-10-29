"use client";

import { useState } from "react";
import { ZA_PROVINCES, ZA_VIEWBOX } from "./za-provinces";

function shade(count, max) {
  if (!count) return null;
  const t = max > 1 ? (count - 1) / (max - 1) : 1;
  const from = [34, 211, 238];
  const to = [37, 99, 235];
  const mix = from.map((value, i) => Math.round(value + (to[i] - value) * t));
  return `rgb(${mix.join(",")})`;
}

// provinces: [{ name, count, pct }]; hrefFor(name) gives the filtered device list.
export function ZaMap({ provinces, hrefFor }) {
  const [hover, setHover] = useState(null);
  const counts = new Map(provinces.map((item) => [item.name, item]));
  const max = Math.max(0, ...provinces.map((item) => item.count));
  const current = hover ? counts.get(hover) : null;
  return (
    <div className="dx-map">
      <svg viewBox={ZA_VIEWBOX} role="img" aria-label="Devices by South African province">
        {ZA_PROVINCES.map((province) => {
          const item = counts.get(province.name) || { count: 0, pct: 0 };
          const fill = shade(item.count, max);
          return (
            <a key={province.name} href={hrefFor(province.name)} aria-label={`${province.name}: ${item.count} ${item.count === 1 ? "device" : "devices"}`}>
              <path
                d={province.d}
                className={`dx-province ${fill ? "" : "is-empty"} ${hover === province.name ? "is-hover" : ""}`}
                style={fill ? { fill } : undefined}
                onMouseEnter={() => setHover(province.name)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(province.name)}
                onBlur={() => setHover(null)}
              >
                <title>{`${province.name}: ${item.count} (${item.pct}%)`}</title>
              </path>
            </a>
          );
        })}
      </svg>
      <p className="dx-map-tip" aria-live="polite">
        {current ? <><strong>{hover}</strong>{` · ${current.count} ${current.count === 1 ? "device" : "devices"} · ${current.pct}%`}</> : "Hover a province for its device count."}
      </p>
      <p className="dx-credit">Boundaries: geoBoundaries (CC BY 4.0). Locations: GeoLite2 data created by <a href="https://www.maxmind.com" target="_blank" rel="noreferrer">MaxMind</a>.</p>
    </div>
  );
}
