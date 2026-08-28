import "server-only";
/**
 * AI-drafted replies (plan §5.O9), written against the `claude-api` skill.
 *
 * Three properties this file exists to guarantee:
 *
 * 1. **It never sends.** It returns text for a human to read, edit and send.
 *    The plan is explicit (§5.O9: "Human approves; no auto-send") and the guest
 *    is a real person who will hold us to whatever the model wrote.
 * 2. **It degrades gracefully.** With no `ANTHROPIC_API_KEY` the action returns
 *    a notice, not an error, so the whole app builds and runs without one
 *    (plan §4.5).
 * 3. **It is grounded.** The model sees the listing's `info_items` and the
 *    booking's own facts — nothing else — and is told to say "lo consulto"
 *    rather than invent. An invented check-in time is worse than no draft.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  assertQuestion,
  buildDraftPrompt,
  DRAFT_SYSTEM_PROMPT,
  type DraftContext,
} from "@/lib/messaging";

/** Per the `claude-api` skill: current id, no date suffix. */
const DRAFT_MODEL = "claude-opus-5";

export type DraftOutcome =
  | { ok: true; draft: string; model: string }
  | { ok: false; reason: "no_key" | "api_error" | "empty" | "refused"; message: string };

export function isDraftingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const NO_KEY_MESSAGE =
  "El borrador automático no está configurado: falta ANTHROPIC_API_KEY. " +
  "Podés escribir la respuesta a mano igual.";

/**
 * Draft one reply.
 *
 * Never throws: every failure path returns an `ok: false` outcome the outbox
 * renders as a notice next to an empty textarea. A guest waiting on WhatsApp is
 * not helped by a 500.
 */
export async function draftReply(
  context: DraftContext,
  question: string,
): Promise<DraftOutcome> {
  if (!isDraftingConfigured()) {
    return { ok: false, reason: "no_key", message: NO_KEY_MESSAGE };
  }
  const prompt = buildDraftPrompt(context, assertQuestion(question));

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1024,
      // A short, grounded WhatsApp reply — the cheapest effort that still
      // reads the info base carefully (`claude-api` skill, effort guidance).
      output_config: { effort: "low" },
      system: DRAFT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      return {
        ok: false,
        reason: "refused",
        message: "El modelo no redactó esta respuesta. Escribila a mano.",
      };
    }

    const draft = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!draft) {
      return {
        ok: false,
        reason: "empty",
        message: "El borrador salió vacío. Probá de nuevo o escribilo a mano.",
      };
    }
    return { ok: true, draft, model: response.model };
  } catch (error) {
    // Logged server-side with the API's own error class, shown to the operator
    // as one line: they need to keep working, not to read a stack trace.
    console.error("[ai-draft]", error);
    const message =
      error instanceof Anthropic.AuthenticationError
        ? "La ANTHROPIC_API_KEY no es válida."
        : error instanceof Anthropic.RateLimitError
          ? "Demasiadas consultas seguidas. Esperá un momento."
          : "No se pudo generar el borrador. Escribí la respuesta a mano.";
    return { ok: false, reason: "api_error", message };
  }
}
