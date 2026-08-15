/**
 * AI Orchestrator Service — Deterministic Pipeline for HealthSync AI Medical Record Understanding Assistant.
 *
 * Pipeline Flow (Steps 6 -> 9):
 * User Query
 *     │
 *     ▼
 * 1. Intent Router (Classifies RECORD_SUMMARY | FACT_RETRIEVAL | COMPARISON | UNSUPPORTED_MEDICAL_ADVICE)
 *     │
 *     ├── If UNSUPPORTED_MEDICAL_ADVICE -> Returns ADVICE_REFUSAL with medical advice disclaimer
 *     │
 * 2. Identity & Consent Resolver (Server-side consent & record-type permission resolution)
 *     │
 * 3. Secure Vector Search (MongoDB Atlas $vectorSearch + patient isolation + record-type filtering)
 *     │
 *     ├── If no relevant chunks -> Returns NO_EVIDENCE response
 *     │
 * 4. Grounded RAG Synthesizer (Gemini / OpenAI constrained by RAG_SYSTEM_PROMPT)
 *     │
 * 5. Grounding & Citation Validation (Extracts numerical tokens & validates citation-chunk mapping)
 *     │
 *     ▼
 * Structured JSON Response ({ answer, citations, confidence, responseType, hasEvidence })
 */

const intentRouter = require('./intent.router');
const ragService = require('./rag.service');
const vectorService = require('./vector.service');
const groundingValidator = require('./grounding.validator');
const logger = require('../../utils/logger');

/**
 * Executes the complete AI Orchestration Pipeline for a medical record query.
 *
 * @param {object} params
 * @param {string} params.query - User question or instruction
 * @param {string} params.authenticatedUserId - JWT authenticated user ID
 * @param {string} [params.userRole='patient'] - 'patient' | 'user' | 'hospital' | 'insurance'
 * @param {string} [params.consentId] - Server-side consent ID for providers
 * @param {string} [params.requestedPatientId] - Target patient ID for providers
 * @returns {Promise<object>} Orchestrated AI Response JSON
 */
const processAIQuery = async ({
  query,
  authenticatedUserId,
  userRole = 'patient',
  consentId = null,
  requestedPatientId = null,
}) => {
  const safeQuery = String(query || '').trim();
  if (!safeQuery) {
    return {
      answer: 'Please provide a valid question or medical record query.',
      citations: [],
      confidence: 'low',
      responseType: 'NO_EVIDENCE',
      hasEvidence: false,
    };
  }

  // 1. STEP 8 — Intent Classification
  const intent = intentRouter.classifyIntent(safeQuery);
  logger.info('AI Query Intent classified', { query: safeQuery.slice(0, 80), intent });

  // 2. Immediate Guardrail: Refuse Medical Advice / Diagnostic / Treatment requests
  if (intent === 'UNSUPPORTED_MEDICAL_ADVICE') {
    return {
      answer:
        'HealthSync can summarize information contained in your medical records, but it does not provide medication, treatment recommendations, or medical diagnoses. Please consult a qualified healthcare professional for medical advice regarding treatment choices.',
      citations: [],
      confidence: 'high',
      responseType: 'ADVICE_REFUSAL',
      hasEvidence: false,
    };
  }

  // 3. STEPS 4 & 5 — Delegate to Grounded RAG Pipeline (Auth Resolution + Secure Vector Search + LLM Synthesis)
  const ragResult = await ragService.askRAG({
    query: safeQuery,
    authenticatedUserId,
    userRole,
    consentId,
    requestedPatientId,
  });

  if (!ragResult.hasEvidence) {
    return ragResult;
  }

  let finalResponseType = ragResult.responseType || 'FACT_RETRIEVAL';
  if (intent === 'RECORD_SUMMARY') finalResponseType = 'RECORD_SUMMARY';
  else if (intent === 'RECORD_COMPARISON') finalResponseType = 'COMPARISON';

  return {
    ...ragResult,
    responseType: finalResponseType,
  };
};

module.exports = {
  processAIQuery,
};
