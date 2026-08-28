"use client";

import { useEffect, useRef, useState } from "react";

/**
 * An `<img>` that falls back to a plain tinted box instead of the browser's
 * broken-image glyph. Every public photo slot is currently unfilled — S4's
 * Higgsfield pipeline could not fetch its results in this session's sandbox
 * (plan §9 build log) — so every image on the site is a 404 today. This keeps
 * that state looking deliberate instead of broken, with no behaviour change
 * once real files land at these paths.
 *
 * A same-origin 404 in dev often resolves before hydration attaches React's
 * listener, and `error` does not bubble for React to replay — so this also
 * checks `complete && naturalWidth === 0` once on mount, which is true
 * synchronously even for a failure that happened pre-hydration.
 */
export function SafeImage({
  src,
  alt,
  className = "",
  fallbackClassName = "",
  ...rest
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackClassName?: string;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "className">) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (failed) {
    return <div className={`bg-ink/5 ${fallbackClassName || className}`} aria-hidden="true" />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}
