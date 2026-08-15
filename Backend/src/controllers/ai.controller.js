const aiOrchestrator = require('../services/ai/ai.orchestrator');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

/**
 * POST /api/ai/ask
 * Grounded RAG query endpoint with Intent Routing, AI Safety Guardrails, and Orchestration.
 */
const askAI = asyncHandler(async (req, res) => {
  const { query, consentId, patientId: queryPatientId } = req.body;
  const userId = req.user.id || req.user._id;
  const userRole = req.user.role || 'patient';

  const result = await aiOrchestrator.processAIQuery({
    query,
    authenticatedUserId: userId.toString(),
    userRole,
    consentId,
    requestedPatientId: queryPatientId,
  });

  res.status(200).json(ApiResponse.ok(result, 'AI query processed successfully.'));
});

module.exports = {
  askAI,
};
