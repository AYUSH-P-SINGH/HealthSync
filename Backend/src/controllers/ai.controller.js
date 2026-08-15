const ragService = require('../services/ai/rag.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

/**
 * POST /api/ai/ask
 * Grounded RAG query endpoint with strict server-side identity & consent resolution.
 */
const askAI = asyncHandler(async (req, res) => {
  const { query, consentId, patientId: queryPatientId } = req.body;
  const userId = req.user.id || req.user._id;
  const userRole = req.user.role || 'patient';

  const result = await ragService.askRAG({
    query,
    authenticatedUserId: userId.toString(),
    userRole,
    consentId,
    requestedPatientId: queryPatientId,
  });

  res.status(200).json(ApiResponse.ok(result, 'AI query answered successfully.'));
});

module.exports = {
  askAI,
};
