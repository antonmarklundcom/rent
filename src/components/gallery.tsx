"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SafeImage } from "@/components/safe-image";

type Image = { id: number; url: string; alt: string | null };

/** Listing photo grid with a simple click-to-expand lightbox. No dependencies. */
export function Gallery({ images, title }: { images: Image[]; title: string }) {
  const t = useTranslations("listing");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (images.length === 0) return null;
  const [cover, ...rest] = images;

  return (
    <>
      <div className="grid grid-cols-4 gap-2 overflow-hidden rounded-lg sm:h-[420px]">
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          className="col-span-4 aspect-[4/3] overflow-hidden bg-ink/5 sm:col-span-2 sm:row-span-2 sm:aspect-auto"
        >
          <SafeImage
            src={cover.url}
            alt={cover.alt ?? title}
            className="h-full w-full object-cover"
            width={800}
            height={600}
            fetchPriority="high"
          />
        </button>
        {rest.slice(0, 4).map((image, i) => (
          <button
            key={image.id}
            type="button"
            onClick={() => setOpenIndex(i + 1)}
            className="col-span-2 aspect-square overflow-hidden bg-ink/5 sm:col-span-1 sm:aspect-auto"
          >
            <SafeImage
              src={image.url}
              alt={image.alt ?? title}
              loading="lazy"
              width={400}
              height={400}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpenIndex(null)}
        >
          <button
            type="button"
            aria-label={t("close")}
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-base/10 text-base"
            onClick={() => setOpenIndex(null)}
          >
            ✕
          </button>
          <SafeImage
            src={images[openIndex].url}
            alt={images[openIndex].alt ?? title}
            className="max-h-[85vh] max-w-full rounded-md object-contain"
            fallbackClassName="h-64 w-64 rounded-md"
          />
        </div>
      )}
    </>
  );
}
