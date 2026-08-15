/**
 * Intent Router Service — Classifies user queries into distinct medical record intelligence intents.
 *
 * Supported Intents:
 * 1. UNSUPPORTED_MEDICAL_ADVICE: Query asks for diagnoses, treatment plans, medication choices, dosage changes.
 * 2. RECORD_COMPARISON: Query requests comparison of lab values/metrics across historical dates.
 * 3. RECORD_SUMMARY: Query requests summarization or simplification of a medical record/report.
 * 4. FACT_RETRIEVAL: Query asks for specific lab values, medications mentioned, or historical facts.
 */

const MEDICAL_ADVICE_PATTERNS = [
  /(?:what|which)\s+(?:medicine|drug|medication|dosage|pill|remedy|treatment|cure|prescription)\s+(?:should|can|must)\s+i/i,
  /should\s+i\s+(?:take|use|stop|start|change|increase|decrease|discontinue|buy|inject|consume)/i,
  /how\s+to\s+(?:treat|cure|heal|manage|fix|prevent)\s+(?:my|this)?/i,
  /diagnose\s+me|do\s+i\s+have\s+(?:cancer|diabetes|hypertension|covid|tb|infection)/i,
  /what\s+dose|how\s+many\s+mg|dosage\s+for/i,
  /what\s+should\s+i\s+do\s+about\s+my/i,
];

const COMPARISON_PATTERNS = [
  /compare|trend|change|differ|over\s+time|between|previous\s+vs\s+latest|history\s+of/i,
  /how\s+did\s+my\s+\w+\s+change/i,
  /increased|decreased|improved|worsened/i,
];

const SUMMARY_PATTERNS = [
  /explain|summarize|summary|overview|breakdown|simple\s+english|what\s+does\s+this\s+(?:mean|report|mri|ct|xray|lab)/i,
  /simplify|translate|meaning\s+of/i,
];

/**
 * Classifies a user query string into an explicit Intent type.
 *
 * @param {string} query
 * @returns {'UNSUPPORTED_MEDICAL_ADVICE' | 'RECORD_COMPARISON' | 'RECORD_SUMMARY' | 'FACT_RETRIEVAL'}
 */
const classifyIntent = (query = '') => {
  const safeQuery = String(query || '').trim();
  if (!safeQuery) return 'FACT_RETRIEVAL';

  // 1. High-priority check for medical advice / diagnostic intent
  for (const pattern of MEDICAL_ADVICE_PATTERNS) {
    if (pattern.test(safeQuery)) {
      return 'UNSUPPORTED_MEDICAL_ADVICE';
    }
  }

  // 2. Historical Comparison Intent
  for (const pattern of COMPARISON_PATTERNS) {
    if (pattern.test(safeQuery)) {
      return 'RECORD_COMPARISON';
    }
  }

  // 3. Report Summarization Intent
  for (const pattern of SUMMARY_PATTERNS) {
    if (pattern.test(safeQuery)) {
      return 'RECORD_SUMMARY';
    }
  }

  // 4. Default: Specific Fact Retrieval
  return 'FACT_RETRIEVAL';
};

module.exports = {
  classifyIntent,
  MEDICAL_ADVICE_PATTERNS,
  COMPARISON_PATTERNS,
  SUMMARY_PATTERNS,
};
