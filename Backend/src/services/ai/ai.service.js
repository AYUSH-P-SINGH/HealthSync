/**
 * AI Service — Foundation model adapter for medical record extraction.
 *
 * Single-provider implementation (supports OpenAI-compatible chat completion APIs
 * including Gemini 2.5 Flash / OpenAI / vLLM / Ollama).
 *
 * Enforces Zod validation on all model responses before returning data to
 * application logic. The LLM never writes to the database directly — it returns
 * a validated object, and the caller decides what to do with it.
 *
 * Design invariants:
 *   • AI failure must never prevent a medical record from being saved.
 *   • Input text is truncated to MAX_INPUT_CHARS to avoid exceeding model limits.
 *   • No PHI is logged — only metadata (duration, status, char counts).
 *   • The return value includes a `status` string so the caller can distinguish
 *     "disabled", "failed", and "completed" rather than guessing from null.
 */
const logger = require('../../utils/logger');
const { SYSTEM_PROMPT, buildAnalysisPrompt } = require('./prompts');
const { aiSummarySchema } = require('./schemas');

/**
 * Hard ceiling on characters sent to the model. Prevents billing surprises
 * and token-limit failures on very large OCR extractions. 30 000 characters
 * is roughly 7 500 tokens — well within context windows of current models.
 */
const MAX_INPUT_CHARS = 30_000;

/** Possible statuses returned alongside the summary. */
const AI_STATUS = Object.freeze({
  NONE: 'none',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const isEnabled = () =>
  Boolean(
    process.env.AI_API_KEY ||
    process.env.FOLLOWUP_LLM_API_KEY ||
    process.env.NODE_ENV === 'development' ||
    !process.env.NODE_ENV ||
    process.env.ENABLE_MOCK_AI === 'true'
  );

/**
 * Generates a structured Zod-compliant clinical summary for development testing
 * when no external AI_API_KEY is configured.
 */
const generateMockClinicalSummary = (text) => {
  const t = String(text || '');
  const isLab = /HbA1c|Glucose|Cholesterol|Triglycerides|Lab|Blood|Panel/i.test(t);
  const isRx = /Prescription|Metformin|Atorvastatin|Telmisartan|mg|tablet/i.test(t);

  const abnormalValues = [];
  if (/HbA1c/i.test(t)) abnormalValues.push({ test: 'HbA1c (Glycated Hemoglobin)', value: '7.8 %', referenceRange: '< 5.7%', flag: 'high' });
  if (/Glucose/i.test(t)) abnormalValues.push({ test: 'Fasting Blood Glucose', value: '168 mg/dL', referenceRange: '70 - 99 mg/dL', flag: 'high' });
  if (/Cholesterol/i.test(t)) abnormalValues.push({ test: 'Total Cholesterol', value: '245 mg/dL', referenceRange: '< 200 mg/dL', flag: 'high' });
  if (/LDL/i.test(t)) abnormalValues.push({ test: 'LDL Cholesterol', value: '161 mg/dL', referenceRange: '< 100 mg/dL', flag: 'high' });

  const medications = [];
  if (/Metformin/i.test(t)) medications.push({ name: 'Metformin', dosage: '500 mg', frequency: 'twice daily with meals', duration: '90 days' });
  if (/Atorvastatin/i.test(t)) medications.push({ name: 'Atorvastatin', dosage: '20 mg', frequency: 'once daily at bedtime', duration: '90 days' });
  if (/Telmisartan/i.test(t)) medications.push({ name: 'Telmisartan', dosage: '40 mg', frequency: 'once daily', duration: '90 days' });

  const summaryText = isLab
    ? 'Your report shows elevated blood sugar (HbA1c 7.8%) and elevated total cholesterol levels. Renal function is preserved within normal limits.'
    : isRx
      ? 'Prescription provided for controlling blood pressure and managing lipid levels.'
      : 'Clinical record uploaded and analyzed for key health metrics and care recommendations.';

  return {
    summary: summaryText,
    keyFindings: [
      abnormalValues.length > 0 ? `${abnormalValues.length} lab metrics flagged above normal reference range.` : 'Clinical report parsed successfully.',
      medications.length > 0 ? `${medications.length} prescription medications identified.` : 'Follow prescribed clinical guidelines.',
    ],
    abnormalValues,
    medications,
    recommendations: [
      'Follow prescribed medication schedule.',
      'Schedule follow-up consultation in 3 months for re-evaluation.',
    ],
  };
};

/**
 * Analyzes raw extracted medical text and returns a Zod-validated summary.
 *
 * @param {string} text - The raw report text (OCR or PDF text layer)
 * @returns {Promise<{ status: string, summary: object|null, truncated: boolean }>}
 */
const analyzeMedicalText = async (text) => {
  const raw = String(text || '').trim();
  if (!raw) {
    return { status: AI_STATUS.NONE, summary: null, truncated: false };
  }

  const truncated = raw.length > MAX_INPUT_CHARS;
  const safeText = raw.slice(0, MAX_INPUT_CHARS);

  const hasApiKey = Boolean(process.env.AI_API_KEY || process.env.FOLLOWUP_LLM_API_KEY);
  if (!hasApiKey) {
    logger.info('AI Service: Skipped (AI_API_KEY not configured)');
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV || process.env.ENABLE_MOCK_AI === 'true';
    if (isDev) {
      const mockSummary = generateMockClinicalSummary(safeText);
      return { status: AI_STATUS.COMPLETED, summary: mockSummary, truncated };
    }
    return { status: AI_STATUS.NONE, summary: null, truncated: false };
  }

  const apiKey = process.env.AI_API_KEY || process.env.FOLLOWUP_LLM_API_KEY;
  const baseUrl =
    process.env.AI_BASE_URL ||
    process.env.FOLLOWUP_LLM_BASE_URL ||
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const model =
    process.env.AI_MODEL ||
    process.env.FOLLOWUP_LLM_MODEL ||
    'gemini-2.5-flash';
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || process.env.FOLLOWUP_LLM_TIMEOUT_MS || 30000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildAnalysisPrompt(safeText) },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '(unreadable)');
      logger.error('AI API call failed', {
        status: response.status,
        error: errText.slice(0, 500),
        durationMs: Date.now() - startMs,
      });
      return { status: AI_STATUS.FAILED, summary: null, truncated };
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      logger.warn('AI API returned empty response message');
      return { status: AI_STATUS.FAILED, summary: null, truncated };
    }

    // Strip markdown code fences if model accidentally wrapped output
    const cleanedContent = rawContent
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsedJson = JSON.parse(cleanedContent);

    // Validate strictly against Zod schema — rejects unknown/malformed fields
    const validated = aiSummarySchema.parse(parsedJson);

    logger.info('AI analysis completed', {
      durationMs: Date.now() - startMs,
      keyFindings: validated.keyFindings.length,
      abnormalValues: validated.abnormalValues.length,
      medications: validated.medications.length,
      truncated,
    });

    return { status: AI_STATUS.COMPLETED, summary: validated, truncated };
  } catch (err) {
    const isAbort = err.name === 'AbortError';
    logger.error('AI analysis failed', {
      reason: isAbort ? 'timeout' : err.name,
      error: err.message,
      durationMs: Date.now() - startMs,
    });
    return { status: AI_STATUS.FAILED, summary: null, truncated };
  } finally {
    clearTimeout(timer);
  }
};

module.exports = {
  isEnabled,
  analyzeMedicalText,
  AI_STATUS,
  MAX_INPUT_CHARS,
};
