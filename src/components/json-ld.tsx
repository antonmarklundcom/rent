import type { JsonLdValue } from "@/lib/seo";

/**
 * Renders one `<script type="application/ld+json">` block (plan §6.S5 point
 * 6). `JSON.stringify` output never contains an unescaped `</script>` from
 * this codebase's data (titles/descriptions are plain text), but the replace
 * is a cheap belt-and-braces guard against a stray listing description ever
 * breaking out of the tag.
 */
export function JsonLd({ data }: { data: JsonLdValue | JsonLdValue[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
