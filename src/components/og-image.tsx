import { ImageResponse } from "next/og";

/**
 * Shared OG image renderer (plan §6.S5 point 2). There is no real
 * photography yet (KNOWN-ISSUES, phase S-1's imagery note), so this is a
 * deliberate branded text-on-color placeholder — the same posture `SafeImage`
 * takes for in-page slots — rather than a broken or missing share image.
 * Colors match the WARM CRAFT tokens from `src/app/globals.css`.
 */
export const ogImageSize = { width: 1200, height: 630 } as const;
export const ogImageContentType = "image/png" as const;

const INK = "#2A1D14";
const BASE = "#FBF7F1";
const ACCENT = "#B4762C";

export function renderOgImage({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "88px",
          backgroundColor: INK,
          color: BASE,
        }}
      >
        {eyebrow && (
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: ACCENT,
              letterSpacing: 3,
              textTransform: "uppercase",
              marginBottom: 24,
            }}
          >
            {eyebrow}
          </div>
        )}
        <div
          style={{
            display: "flex",
            fontSize: title.length > 40 ? 56 : 68,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", marginTop: 56, fontSize: 30, color: ACCENT }}>alquilar.com.py</div>
      </div>
    ),
    ogImageSize,
  );
}
