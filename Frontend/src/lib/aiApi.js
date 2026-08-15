import { request } from "./api.js";

/**
 * AI Assistant API client.
 */
export const aiApi = {
  /**
   * Queries the grounded AI RAG assistant.
   *
   * @param {object} params
   * @param {string} params.query - User question
   * @param {string} [params.consentId] - Optional consent grant ID for provider roles
   * @param {string} [params.patientId] - Optional target patient ID for provider roles
   * @param {string} [token] - Access token
   * @returns {Promise<{ answer: string, citations: Array<object>, confidence: string, hasEvidence: boolean }>}
   */
  ask: async ({ query, consentId, patientId }, token) => {
    const res = await request("/ai/ask", {
      method: "POST",
      body: { query, consentId, patientId },
      token,
    });
    return res.data;
  },
};
