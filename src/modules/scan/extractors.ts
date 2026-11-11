import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { FIELD_KEYS, emptyFields, extractFromText, type Fields } from "./domain";

export type ExtractInput = { bytes: Uint8Array; mimeType: string; text: string | null };
export interface Extractor {
  provider: string;
  model?: string;
  extract(input: ExtractInput): Promise<Fields>;
}

/** PDF text layer (no OCR): text and page count. Images have no text layer. */
export async function readPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number } | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { text: String(text), pages: totalPages };
  } catch {
    return null; // damaged or encrypted PDF: the user reviews manually
  }
}

/** Always available: label heuristics on the PDF text layer. */
export const textLayerExtractor: Extractor = {
  provider: "text-layer",
  async extract({ text }) {
    return text ? extractFromText(text) : emptyFields();
  },
};

// ───────────── Optional AI provider (Claude) ─────────────

const field = z.object({ value: z.string().nullable(), confidence: z.number() });
const AiFieldsSchema = z.object(Object.fromEntries(FIELD_KEYS.map((k) => [k, field])) as Record<(typeof FIELD_KEYS)[number], typeof field>);

const PROMPT = `Extract the fields of this purchase invoice (usually from Suriname; Dutch or English).
Return for every field the value exactly as printed (normalised as below) and your confidence between 0 and 1. Use null with confidence 0 when a field is absent or unreadable; never guess.
- supplierName: the seller's company name; supplierTaxNumber: the seller's fiscal/BTW/KKF number.
- invoiceNumber; invoiceDate and dueDate as YYYY-MM-DD; currency as ISO code (SRD, USD, EUR).
- netAmount, taxAmount (BTW), grossAmount (total to pay) as plain decimals with a dot and two decimals, no thousands separators.
- description: a short summary of what was bought (max 120 characters).`;

export const AI_MODEL = "claude-opus-5-5";

/**
 * Claude extractor. Used only when ANTHROPIC_API_KEY is configured AND the organisation switched AI on (SECURITY.md:
 * only the document is sent, no ledger data). Uses server-side fallbacks on a policy decline.
 */
export function anthropicExtractor(): Extractor | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  return {
    provider: "anthropic",
    model: AI_MODEL,
    async extract({ bytes, mimeType }) {
      const data = Buffer.from(bytes).toString("base64");
      const source: Anthropic.Beta.BetaContentBlockParam =
        mimeType === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
          : { type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png", data } };
      const response = await client.beta.messages.parse({
        model: AI_MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(AiFieldsSchema) },
        messages: [{ role: "user", content: [source, { type: "text", text: PROMPT }] }],
      });
      if (response.stop_reason === "refusal") throw new Error("AI provider declined the document");
      const parsed = response.parsed_output;
      if (!parsed) throw new Error(`AI provider returned no usable result (${response.stop_reason ?? "unknown"})`);
      const out = emptyFields();
      for (const k of FIELD_KEYS) {
        const f = parsed[k];
        out[k] = { value: f.value?.trim() || null, confidence: f.value ? Math.max(0, Math.min(1, Number(f.confidence) || 0)) : 0 };
      }
      return out;
    },
  };
}
