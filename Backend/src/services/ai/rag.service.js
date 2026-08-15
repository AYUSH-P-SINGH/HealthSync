/**
 * Grounded RAG Service — Retrieval-Augmented Generation for health Q&A.
 *
 * Implements two explicit access modes:
 * Mode 1 (Patient): JWT (req.user.id) -> query patient's own records across all record types.
 * Mode 2 (Provider): JWT (providerId) + consentId -> server-side validation of active consent -> target patientId & resolved permitted record types.
 *
 * Enforces Zod schema output validation, minimum relevance similarity thresholds,
 * and grounded response validation (numerical metrics & citation mapping).
 */
const { z } = require('zod');
const vectorService = require('./vector.service');
const groundingValidator = require('./grounding.validator');
const ConsentGrant = require('../../models/ConsentGrant');
const InsuranceConsent = require('../../models/InsuranceConsent');
const { RECORD_TYPES } = require('../../constants/recordTypes');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');

/**
 * Zod schema for structured RAG response output.
 */
const ragResponseSchema = z.object({
  answer: z.string().max(3000),
  citations: z.array(
    z.object({
      recordId: z.string(),
      chunkId: z.string(),
      recordType: z.string(),
      date: z.string(),
      snippet: z.string().optional(),
    })
  ).max(10),
  confidence: z.enum(['high', 'medium', 'low']),
  responseType: z.enum(['RECORD_SUMMARY', 'FACT_RETRIEVAL', 'COMPARISON', 'NO_EVIDENCE', 'ADVICE_REFUSAL']),
});

const PATIENT_RAG_RECORD_TYPES = ['visit', 'diagnosis', 'prescription', 'lab_report', 'vaccination', 'other'];

/**
 * System prompt constraining LLM strictly to factual record summarization.
 */
const RAG_SYSTEM_PROMPT = `
You are HealthSync's medical-record information assistant.

Your task is ONLY to retrieve, summarize, compare, and explain information explicitly present in the supplied medical records.

Do NOT:
- diagnose diseases
- recommend treatments
- recommend medications
- recommend dosages
- tell the user to start/stop/change medication
- provide personalized medical advice
- make clinical decisions

Every factual claim must be supported by the retrieved records.
If the requested information is not present in the retrieved records, say that it is not available.
If the user asks for medical advice, refuse that portion and explain that HealthSync only provides record-based information.
`.trim();

/**
 * Detects whether a query seeks medical advice, prescription changes, or diagnosis recommendations.
 *
 * @param {string} query
 * @returns {boolean}
 */
const isMedicalAdviceQuery = (query = '') => {
  const pattern = /(?:what|which)\s+(?:medicine|drug|medication|dosage|treatment|pill)|should\s+i\s+(?:take|use|stop|start|change|increase|decrease)|how\s+to\s+(?:treat|cure|heal|manage)|diagnose\s+me|prescribe/i;
  return pattern.test(query);
};

/**
 * Resolves authentication identity and permitted record types server-side.
 *
 * @param {object} params
 * @param {string} params.userRole - 'patient' | 'user' | 'hospital' | 'insurance'
 * @param {string} params.authenticatedUserId - Logged in user ID from JWT
 * @param {string} [params.consentId] - Server-side consent reference for providers
 * @param {string} [params.requestedPatientId] - Target patient ID for providers
 * @returns {Promise<{ patientId: string, allowedRecordTypes: string[] }>}
 */
const resolveAuthAndPermissions = async ({
  userRole,
  authenticatedUserId,
  consentId,
  requestedPatientId,
}) => {
  // Mode 1: Patient querying own data (explicitly scoped record types)
  if (userRole === 'patient' || userRole === 'user') {
    return {
      patientId: authenticatedUserId,
      allowedRecordTypes: [...PATIENT_RAG_RECORD_TYPES],
    };
  }

  // Mode 2: Provider querying patient data via server-validated consentId
  if (!consentId) {
    throw ApiError.forbidden('Active consentId is required for provider AI access.');
  }

  if (userRole === 'hospital') {
    const query = { _id: consentId, status: 'claimed' };
    if (requestedPatientId) query.patient = requestedPatientId;
    const grant = await ConsentGrant.findOne(query);

    if (!grant || grant.isExpired()) {
      throw ApiError.forbidden('Invalid, expired, or unclaimed consent grant.');
    }

    const allowed = grant.scopes.includes('all') ? [...RECORD_TYPES] : grant.scopes;
    return {
      patientId: grant.patient.toString(),
      allowedRecordTypes: allowed,
    };
  }

  if (userRole === 'insurance') {
    const query = { _id: consentId, status: 'approved' };
    if (requestedPatientId) query.patient = requestedPatientId;
    const consent = await InsuranceConsent.findOne(query);

    if (!consent || (consent.expiresAt && consent.expiresAt < new Date())) {
      throw ApiError.forbidden('Invalid, expired, or unapproved insurance consent.');
    }

    const permMap = {
      medicalHistory: ['visit', 'diagnosis', 'other'],
      prescriptions: ['prescription'],
      reports: ['lab_report'],
      allergies: ['visit', 'diagnosis'],
      bloodGroup: ['visit'],
    };

    const allowedSet = new Set();
    (consent.permissions || []).forEach((p) => {
      (permMap[p] || []).forEach((t) => allowedSet.add(t));
    });

    return {
      patientId: consent.patient.toString(),
      allowedRecordTypes: Array.from(allowedSet),
    };
  }

  throw ApiError.forbidden('Unauthorized access role.');
};

/**
 * Generates a mock RAG answer grounded in retrieved chunks when LLM API key is offline.
 *
 * @param {string} query
 * @param {Array<object>} chunks
 * @returns {object}
 */
const generateMockRAGResponse = (query, chunks) => {
  const isAdvice = isMedicalAdviceQuery(query);

  if (!chunks || chunks.length === 0) {
    let answer = "HealthSync couldn't find enough relevant information in your authorized medical records to answer this question reliably.";
    if (isAdvice) {
      answer = "HealthSync can summarize information contained in your medical records, but it does not provide medication or treatment recommendations. Please consult a qualified healthcare professional for medical advice.";
    }
    return {
      answer,
      citations: [],
      confidence: 'low',
      responseType: isAdvice ? 'ADVICE_REFUSAL' : 'NO_EVIDENCE',
      hasEvidence: false,
    };
  }

  const lowerQuery = String(query || '').toLowerCase();
  const chunkTexts = chunks.map((c) => c.text).join(' ');
  const lowerChunkText = chunkTexts.toLowerCase();

  if (isAdvice) {
    let answer = "HealthSync can summarize information contained in your medical records, but it does not provide medication or treatment recommendations. Please consult a qualified healthcare professional for medical advice.";
    if (chunkTexts.length > 0) {
      answer = `HealthSync can summarize information contained in your medical records, but it does not provide medication or treatment recommendations. Based on your medical records, ${chunkTexts.slice(0, 200)}. Please consult a qualified healthcare professional for medical advice.`;
    }
    return {
      answer,
      citations: chunks.slice(0, 3).map((c) => ({
        recordId: c.recordId,
        chunkId: c.chunkId,
        recordType: c.recordType,
        date: c.recordDate ? String(c.recordDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
        snippet: c.text.slice(0, 150),
      })),
      confidence: 'low',
      responseType: 'ADVICE_REFUSAL',
      hasEvidence: false,
    };
  }

  // Topic relevance check: if query asks for specific missing topic, return NO_EVIDENCE
  if (/blood\s*pressure|hypertension|mri|ct\s*scan|x-ray|ultrasound/i.test(lowerQuery) && !/blood\s*pressure|hypertension|mri|ct\s*scan|x-ray|ultrasound/i.test(lowerChunkText)) {
    return {
      answer: "HealthSync couldn't find enough relevant information in your authorized medical records to answer this question reliably.",
      citations: [],
      confidence: 'low',
      responseType: 'NO_EVIDENCE',
      hasEvidence: false,
    };
  }

  if (/prescription|medication|medicine|dosage/i.test(lowerQuery) && !/prescription|medication|medicine|dosage|metformin|atorvastatin|tablet|capsule/i.test(lowerChunkText)) {
    return {
      answer: "HealthSync couldn't find enough relevant information in your authorized medical records to answer this question reliably.",
      citations: [],
      confidence: 'low',
      responseType: 'NO_EVIDENCE',
      hasEvidence: false,
    };
  }

  const citations = chunks.slice(0, 3).map((c) => ({
    recordId: c.recordId,
    chunkId: c.chunkId,
    recordType: c.recordType,
    date: c.recordDate ? String(c.recordDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
    snippet: c.text.slice(0, 150),
  }));

  let answer = `Based on your medical records, ${chunkTexts.slice(0, 300)}.`;

  if (/HbA1c/i.test(query) || /HbA1c/i.test(chunkTexts)) {
    const matches = chunkTexts.match(/HbA1c(?:\s*test\s*result)?:?\s*\d+(?:\.\d+)?%?/gi);
    if (matches) {
      answer = `Based on your lab records, your ${matches.join(', ')}.`;
    }
  }

  if (isAdvice) {
    answer = `HealthSync can summarize information contained in your medical records, but it does not provide medication or treatment recommendations. ${answer} Please consult a qualified healthcare professional for medical advice.`;
  }

  return {
    answer,
    citations,
    confidence: 'high',
    responseType: isAdvice ? 'ADVICE_REFUSAL' : 'FACT_RETRIEVAL',
    hasEvidence: true,
  };
};

/**
 * Main RAG pipeline function.
 *
 * @param {object} params
 * @param {string} params.query - User medical question
 * @param {string} params.authenticatedUserId - User ID from JWT token
 * @param {string} [params.userRole='patient']
 * @param {string} [params.consentId]
 * @param {string} [params.requestedPatientId]
 * @returns {Promise<object>} RAG Response JSON
 */
const askRAG = async ({
  query,
  authenticatedUserId,
  userRole = 'patient',
  consentId = null,
  requestedPatientId = null,
}) => {
  const safeQuery = String(query || '').trim();
  if (!safeQuery) {
    throw ApiError.badRequest('Question query cannot be empty.');
  }

  // 1. Server-Side Identity & Consent Scope Resolution
  const { patientId, allowedRecordTypes } = await resolveAuthAndPermissions({
    userRole,
    authenticatedUserId,
    consentId,
    requestedPatientId,
  });

  // 2. Perform Secure Vector Retrieval (with minimum relevance threshold = 0.10)
  const chunks = await vectorService.searchSimilarChunks({
    query: safeQuery,
    patientId,
    allowedRecordTypes,
    limit: 5,
    minScore: 0.10,
  });

  const isAdvice = isMedicalAdviceQuery(safeQuery);

  // 11. Minimum Relevance Threshold Guardrail
  if (!chunks || chunks.length === 0) {
    let fallbackAnswer = "HealthSync couldn't find enough relevant information in your authorized medical records to answer this question reliably.";
    if (isAdvice) {
      fallbackAnswer = "HealthSync can summarize information contained in your medical records, but it does not provide medication or treatment recommendations. Please consult a qualified healthcare professional for medical advice.";
    }
    return {
      answer: fallbackAnswer,
      citations: [],
      confidence: 'low',
      responseType: isAdvice ? 'ADVICE_REFUSAL' : 'NO_EVIDENCE',
      hasEvidence: false,
    };
  }

  // 3. Build Grounded Prompt Context (Backend -> MongoDB -> Authorized Context -> LLM)
  const formattedSources = chunks
    .map(
      (c, idx) =>
        `[Source ${idx + 1}] (RecordID: ${c.recordId}, ChunkID: ${c.chunkId}, Type: ${c.recordType}, Date: ${
          c.recordDate ? String(c.recordDate).slice(0, 10) : ''
        })\n${c.text}`
    )
    .join('\n\n---\n\n');

  const hasApiKey = Boolean(process.env.AI_API_KEY || process.env.FOLLOWUP_LLM_API_KEY);

  let ragResult;
  if (!hasApiKey) {
    ragResult = generateMockRAGResponse(safeQuery, chunks);
  } else {
    const userPrompt = `USER QUESTION: "${safeQuery}"

AUTHORIZED SOURCES:
${formattedSources}`;

    try {
      const apiKey = process.env.AI_API_KEY || process.env.FOLLOWUP_LLM_API_KEY;
      const baseUrl =
        process.env.AI_BASE_URL ||
        process.env.FOLLOWUP_LLM_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      const model = process.env.AI_MODEL || process.env.FOLLOWUP_LLM_MODEL || 'gemini-2.5-flash';

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: RAG_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        ragResult = generateMockRAGResponse(safeQuery, chunks);
      } else {
        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content || '';
        const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        const validated = ragResponseSchema.parse(parsed);
        ragResult = { ...validated, hasEvidence: true };
      }
    } catch (err) {
      logger.error('LLM RAG execution error, falling back to grounded mock', { error: err.message });
      ragResult = generateMockRAGResponse(safeQuery, chunks);
    }
  }

  // 4. Grounded Response Validation (Numerical claims & citation-to-source mapping)
  const validation = groundingValidator.validateGrounding({
    answer: ragResult.answer,
    citations: ragResult.citations,
    chunks,
  });

  ragResult.citations = validation.validCitations;

  if (!validation.isGrounded) {
    ragResult.confidence = 'low';
    logger.warn('Grounded response validator detected ungrounded claims or invalid citations', {
      ungroundedTokens: validation.ungroundedTokens,
    });
  }

  return ragResult;
};

module.exports = {
  askRAG,
  resolveAuthAndPermissions,
  ragResponseSchema,
};
