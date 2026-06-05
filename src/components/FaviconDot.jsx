// FaviconDot.jsx — deterministic colored monogram standing in for a favicon.
import { hostOf, hueOf } from "../lib/utils.js";

export default function FaviconDot({ url, size = 18 }) {
  const host = hostOf(url);
  const hue = hueOf(host);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.52,
        fontWeight: 800,
        color: "#fff",
        background: `linear-gradient(140deg, hsl(${hue} 70% 58%), hsl(${(hue + 38) % 360} 72% 46%))`,
      }}
    >
      {host.charAt(0).toUpperCase()}
    </span>
  );
}
