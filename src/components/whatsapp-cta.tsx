import { ExternalButtonLink } from "@/components/ui/button";

/**
 * The one WhatsApp CTA shape used sitewide. `#25D366` lives only inside the
 * glyph — never as a section fill or a second brand colour (web-design-system
 * skill, WhatsApp-green rule).
 */
export function WhatsAppCta({
  href,
  label,
  evLoc,
  className = "",
}: {
  href: string;
  label: string;
  evLoc: string;
  className?: string;
}) {
  return (
    <ExternalButtonLink
      href={href}
      variant="wa"
      rel="noopener"
      target="_blank"
      data-ev="whatsapp_click"
      data-ev-loc={evLoc}
      className={className}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="#25D366"
          d="M12.02 2C6.5 2 2.02 6.48 2.02 12c0 1.9.52 3.68 1.44 5.2L2 22l4.94-1.42A9.9 9.9 0 0 0 12.02 22C17.55 22 22 17.52 22 12S17.55 2 12.02 2Zm0 18.1c-1.7 0-3.28-.5-4.6-1.36l-.33-.2-2.93.84.83-2.85-.22-.34a8.06 8.06 0 0 1-1.28-4.19c0-4.48 3.65-8.12 8.14-8.12 2.17 0 4.21.85 5.75 2.38a8.06 8.06 0 0 1 2.38 5.74c0 4.48-3.65 8.1-8.14 8.1Zm4.47-6.08c-.24-.12-1.44-.71-1.67-.79-.22-.08-.38-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.8-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28Z"
        />
      </svg>
      {label}
    </ExternalButtonLink>
  );
}
