/**
 * LLM extractor — adapter slot.
 *
 * Deliberately inert until FOLLOWUP_LLM_PROVIDER and an API key are set. The
 * rule-based extractor is the product; this is the upgrade path for messy
 * real-world prose that regexes handle poorly.
 *
 * WHY IT IS SHAPED THIS WAY
 *  • The LLM never invents the schema. It fills a fixed contract, and every
 *    field is re-validated here before it can reach the database.
 *  • Anything the model returns that cannot be verified against the source
 *    text is dropped. A hallucinated "repeat CT in 3 months" is strictly
 *    worse than no extraction, because a patient would act on it.
 *  • Confidence returned by the model is capped, never trusted outright.
 *    Self-reported certainty from a language model is not a calibrated
 *    probability and should not be treated as one.
 *  • Report text is PHI. Sending it to a third party is a disclosure, so it
 *    is opt-in by configuration and logged, never a silent default.
 */
const logger = require('../../utils/logger');
const { LIMITS, CONFIDENCE, FOLLOWUP_CATEGORIES, FOLLOWUP_SEVERITY } = require('../../constants/followUp');

const isEnabled = () =>
  Boolean(process.env.FOLLOWUP_LLM_PROVIDER && process.env.FOLLOWUP_LLM_API_KEY);

/** The contract the model must fill. Kept in one place for prompt + validation. */
const RESPONSE_CONTRACT = `Return ONLY a JSON array. Each element:
{
  "finding":     string,  // what was found, quoted or closely paraphrased from the report
  "action":      string,  // the future action owed, e.g. "Repeat CT scan"
  "category":    "imaging"|"lab"|"consult"|"procedure"|"medication"|"other",
  "severity":    "routine"|"urgent"|"critical",
  "dueInDays":   number,  // integer days from the report date
  "sourceText":  string,  // the VERBATIM sentence from the report, copied exactly
  "confidence":  number   // 0..1
}
Rules:
- Only extract actions that are RECOMMENDED FOR THE FUTURE.
- Do NOT extract anything already performed, negated, or hypothetical.
- "sourceText" MUST appear verbatim in the input. Never paraphrase it.
- If the report recommends nothing, return [].`;

const buildPrompt = (text) =>
  `You extract follow-up recommendations from medical report text.\n\n${RESPONSE_CONTRACT}\n\n--- REPORT ---\n${text.slice(0, LIMITS.MAX_TEXT_CHARS)}\n--- END ---`;

/**
 * Normalize whitespace and case so the grounding check tolerates the model
 * reformatting a sentence without letting it invent one.
 */
const canonical = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Reject anything whose claimed source sentence is not actually in the
 * report. This is the single most important guard in the file — it is what
 * makes an LLM safe to use for this at all.
 */
const isGrounded = (sourceText, haystack) => {
  const needle = canonical(sourceText);
  if (needle.length < 15) return false;
  return canonical(haystack).includes(needle);
};

const validateAndMap = (rawItems, { anchorDate, sourceText: fullText, model }) => {
  if (!Array.isArray(rawItems)) return [];

  const out = [];
  for (const item of rawItems.slice(0, LIMITS.MAX_PER_RECORD)) {
    if (!item || typeof item !== 'object') continue;

    const finding = String(item.finding || '').trim().slice(0, 500);
    const action = String(item.action || '').trim().slice(0, 300);
    const src = String(item.sourceText || '').trim();
    const days = Number(item.dueInDays);

    if (!finding || !action) continue;
    if (!Number.isFinite(days) || days < LIMITS.MIN_DUE_DAYS || days > LIMITS.MAX_DUE_DAYS) continue;
    if (!isGrounded(src, fullText)) {
      logger.warn('Follow-up LLM extraction dropped: sourceText not grounded in report', {
        action,
      });
      continue;
    }

    const category = FOLLOWUP_CATEGORIES.includes(item.category) ? item.category : 'other';
    const severity = FOLLOWUP_SEVERITY.includes(item.severity) ? item.severity : 'routine';

    // Cap self-reported confidence: a model asserting 0.99 has not earned
    // the right to skip the patient-confirmation gate on its own say-so.
    const claimed = Number(item.confidence);
    const confidence = Math.max(
      CONFIDENCE.MIN_SUGGEST,
      Math.min(0.95, Number.isFinite(claimed) ? claimed : 0.6)
    );

    out.push({
      finding,
      action,
      category,
      severity,
      dueAt: new Date(new Date(anchorDate).getTime() + days * 86_400_000),
      anchorDate: new Date(anchorDate),
      sourceText: src.slice(0, 2000),
      confidence: Number(confidence.toFixed(3)),
      timeframeText: null,
      inferredWindow: false,
      recurring: false,
      extractedBy: `llm:${model}`,
    });
  }
  return out;
};

/**
 * Attempt LLM extraction. Returns null on any failure so the caller can fall
 * back to rules — an outage in a third-party API must never mean a patient
 * silently loses a follow-up.
 */
const extract = async (text, { anchorDate = new Date() } = {}) => {
  if (!isEnabled()) return null;

  const provider = process.env.FOLLOWUP_LLM_PROVIDER;
  const model = process.env.FOLLOWUP_LLM_MODEL || 'default';
  const timeoutMs = Number(process.env.FOLLOWUP_LLM_TIMEOUT_MS || 15000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // ─────────────────────────────────────────────────────────────
    // IMPLEMENT YOUR PROVIDER CALL HERE.
    //
    // The contract: send buildPrompt(text), get back a JSON array, hand it
    // to validateAndMap. Everything downstream is provider-agnostic.
    //
    // Example (OpenAI-compatible chat completions):
    //
    //   const res = await fetch(process.env.FOLLOWUP_LLM_BASE_URL, {
    //     method: 'POST',
    //     signal: controller.signal,
    //     headers: {
    //       'Content-Type': 'application/json',
    //       Authorization: `Bearer ${process.env.FOLLOWUP_LLM_API_KEY}`,
    //     },
    //     body: JSON.stringify({
    //       model,
    //       temperature: 0,                       // determinism matters here
    //       response_format: { type: 'json_object' },
    //       messages: [{ role: 'user', content: buildPrompt(text) }],
    //     }),
    //   });
    //   const json = await res.json();
    //   const parsed = JSON.parse(json.choices[0].message.content);
    //   return validateAndMap(parsed.items ?? parsed, { anchorDate, sourceText: text, model });
    // ─────────────────────────────────────────────────────────────

    logger.warn('FOLLOWUP_LLM_PROVIDER is set but no provider call is implemented', { provider });
    return null;
  } catch (err) {
    logger.error('Follow-up LLM extraction failed; falling back to rules', {
      provider,
      error: err.message,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { extract, isEnabled, validateAndMap, buildPrompt, _internals: { isGrounded } };
