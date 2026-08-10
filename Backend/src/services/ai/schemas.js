const { z } = require('zod');

/**
 * Zod schemas for AI-extracted medical record summaries.
 *
 * These schemas are the validation firewall between the LLM and the database.
 * Every field has explicit length limits and array caps to prevent the model
 * from generating unbounded output that would bloat MongoDB documents.
 *
 * Zod's default object mode strips unknown keys, so any hallucinated fields
 * the model invents (e.g., "diagnosis", "severity") are silently dropped.
 */

const MAX_SUMMARY_LENGTH = 2000;
const MAX_FINDING_LENGTH = 500;
const MAX_TEST_NAME_LENGTH = 200;
const MAX_VALUE_LENGTH = 100;
const MAX_MED_NAME_LENGTH = 200;
const MAX_RECOMMENDATION_LENGTH = 500;
const MAX_ARRAY_ITEMS = 50;

const abnormalValueSchema = z.object({
  test: z.string().min(1, 'Test name is required').max(MAX_TEST_NAME_LENGTH),
  value: z.string().max(MAX_VALUE_LENGTH).default(''),
  referenceRange: z.string().max(MAX_VALUE_LENGTH).default(''),
  flag: z.enum(['normal', 'low', 'high', 'critical']).nullable().default(null),
});

const medicationSchema = z.object({
  name: z.string().min(1, 'Medication name is required').max(MAX_MED_NAME_LENGTH),
  dosage: z.string().max(MAX_VALUE_LENGTH).default(''),
  frequency: z.string().max(MAX_VALUE_LENGTH).default(''),
  duration: z.string().max(MAX_VALUE_LENGTH).default(''),
});

const aiSummarySchema = z.object({
  summary: z.string().max(MAX_SUMMARY_LENGTH).default(''),
  keyFindings: z.array(z.string().max(MAX_FINDING_LENGTH)).max(MAX_ARRAY_ITEMS).default([]),
  abnormalValues: z.array(abnormalValueSchema).max(MAX_ARRAY_ITEMS).default([]),
  medications: z.array(medicationSchema).max(MAX_ARRAY_ITEMS).default([]),
  recommendations: z.array(z.string().max(MAX_RECOMMENDATION_LENGTH)).max(MAX_ARRAY_ITEMS).default([]),
});

module.exports = {
  aiSummarySchema,
  abnormalValueSchema,
  medicationSchema,
};
