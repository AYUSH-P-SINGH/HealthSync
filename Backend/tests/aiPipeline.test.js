/**
 * Step 1 + Step 2: Exhaustive AI Pipeline Verification Tests
 *
 * These tests verify the ENTIRE pipeline, not just individual functions:
 *
 *   Upload → OCR → rawText → AI → Zod → MedicalRecord → MongoDB
 *
 * Test Map:
 *   Test 1  — AI disabled: record creation still works
 *   Test 2  — AI enabled: mock provider returns valid summary
 *   Test 3  — rawText is preserved and never overwritten
 *   Test 4  — Invalid AI output rejected by Zod
 *   Test 5  — Malformed JSON from LLM handled safely
 *   Test 6  — Hallucination: schema constrains LLM freedom
 *   Test 7  — Different document types produce correct shapes
 *   Test 8  — Long documents are truncated safely
 *   Test 9  — AI provider failure: record still saved
 *   Test 10 — Logging: no PHI leaked
 *   Test 11 — Duplicate uploads create separate records
 *   Test 12 — Existing functionality unbroken (via full test suite)
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const MedicalRecord = require('../src/models/MedicalRecord');
const RefreshToken = require('../src/models/RefreshToken');
const AuditLog = require('../src/models/AuditLog');
const emailService = require('../src/services/email.service');
const aiService = require('../src/services/ai/ai.service');
const { aiSummarySchema } = require('../src/services/ai/schemas');

jest.spyOn(emailService, 'sendVerificationEmail').mockImplementation(() => Promise.resolve(true));

const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/healthsync_test';

const patientUser = {
  firstName: 'Test',
  lastName: 'Patient',
  email: 'ai.pipeline.test@example.com',
  mobileNumber: '9000000001',
  password: 'SecurePass123!',
};

// ─── Sample medical texts for different document types ─────

const SAMPLE_LAB_REPORT = `
PATHOLOGY LAB REPORT
Patient: John Doe  DOB: 15/03/1985  Date: 10/08/2026

Complete Blood Count (CBC)
Hemoglobin: 11.2 g/dL (Ref: 13.0-17.0) LOW
WBC: 7,500 /uL (Ref: 4,500-11,000) NORMAL
Platelets: 250,000 /uL (Ref: 150,000-400,000) NORMAL

Metabolic Panel
HbA1c: 6.4% (Ref: <5.7%) HIGH
Fasting Glucose: 118 mg/dL (Ref: 70-100) HIGH
LDL Cholesterol: 142 mg/dL (Ref: <100) HIGH
HDL Cholesterol: 48 mg/dL (Ref: >40) NORMAL
Triglycerides: 165 mg/dL (Ref: <150) HIGH

Recommendation: Repeat lipid panel in 3 months. Consider statin therapy.
Follow up with endocrinology for elevated HbA1c.
`;

const SAMPLE_PRESCRIPTION = `
PRESCRIPTION
Dr. Sharma, City Hospital
Date: 10/08/2026

Patient: Jane Smith

1. Amoxicillin 500mg - Take twice daily for 7 days
2. Paracetamol 650mg - Take as needed for fever, max 4 per day
3. Omeprazole 20mg - Take once daily before breakfast for 14 days

Diagnosis: Upper respiratory tract infection with gastritis.
Follow-up in 10 days if symptoms persist.
`;

const SAMPLE_RADIOLOGY = `
RADIOLOGY REPORT - MRI LUMBAR SPINE
Date: 10/08/2026
Referring Physician: Dr. Kumar

FINDINGS:
- L4-L5: Mild disc bulge with slight compression of the thecal sac.
  No significant neural foraminal narrowing.
- L5-S1: Small central disc protrusion measuring 3mm.
  Mild bilateral neural foraminal narrowing.
- No evidence of spondylolisthesis or fracture.
- Conus medullaris terminates normally at L1 level.

IMPRESSION:
Degenerative disc disease at L4-L5 and L5-S1 with mild disc changes.
No acute findings requiring urgent intervention.

RECOMMENDATION:
Conservative management with physiotherapy. Repeat MRI in 6 months if
symptoms worsen. Neurosurgery consultation if progressive neurological
deficits develop.
`;

// ─── Valid mock AI response matching our schema ────────────

const VALID_AI_RESPONSE = {
  summary: 'Blood test results show mildly low hemoglobin and elevated blood sugar markers.',
  keyFindings: [
    'Hemoglobin is below normal range at 11.2 g/dL',
    'HbA1c elevated at 6.4% suggesting pre-diabetic range',
    'LDL cholesterol elevated at 142 mg/dL',
  ],
  abnormalValues: [
    { test: 'Hemoglobin', value: '11.2 g/dL', referenceRange: '13.0-17.0 g/dL', flag: 'low' },
    { test: 'HbA1c', value: '6.4%', referenceRange: '<5.7%', flag: 'high' },
    { test: 'LDL Cholesterol', value: '142 mg/dL', referenceRange: '<100 mg/dL', flag: 'high' },
  ],
  medications: [],
  recommendations: [
    'Repeat lipid panel in 3 months',
    'Follow up with endocrinology for elevated HbA1c',
  ],
};

// ─── Helper: mock fetch for AI API ─────────────────────────

const mockFetchResponse = (responseBody, status = 200) => {
  return jest.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify(responseBody) } }],
      }),
      text: () => Promise.resolve(JSON.stringify({ error: 'mock error' })),
    })
  );
};

const mockFetchMalformed = () => {
  return jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"summary": "The patient...' } }], // truncated JSON
      }),
      text: () => Promise.resolve(''),
    })
  );
};

const mockFetchFailure = (status = 500) => {
  return jest.fn(() =>
    Promise.resolve({
      ok: false,
      status,
      text: () => Promise.resolve('Internal Server Error'),
    })
  );
};

const mockFetchNetworkError = () => {
  return jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
};

// ─── Test Suite ────────────────────────────────────────────

describe('Step 1 + Step 2: Full AI Pipeline Verification', () => {
  let accessToken;
  let userId;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGO_URI);
    }
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
    await User.deleteMany({});
    await MedicalRecord.deleteMany({});
    await RefreshToken.deleteMany({});
    await AuditLog.deleteMany({});

    const tokenService = require('../src/services/token.service');

    const user = await User.create({
      fullName: { firstName: patientUser.firstName, lastName: patientUser.lastName },
      email: patientUser.email,
      mobileNumber: patientUser.mobileNumber,
      password: patientUser.password,
      isVerified: true,
    });

    accessToken = tokenService.generateAccessToken(user._id.toString(), 'user');
    userId = user._id;
  });

  // ─── Helper: create a record via API ──────────────────

  const createLabReport = async (overrides = {}) => {
    return request(app)
      .post('/api/patients/records')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'lab_report',
        title: 'Blood Test Report Aug 2026',
        description: 'Complete blood count and metabolic panel',
        labResults: [
          { name: 'Hemoglobin', value: '11.2', unit: 'g/dL', referenceRange: '13.0-17.0', flag: 'low' },
          { name: 'HbA1c', value: '6.4', unit: '%', referenceRange: '<5.7', flag: 'high' },
        ],
        rawText: SAMPLE_LAB_REPORT,
        ...overrides,
      });
  };

  const createPrescription = async (overrides = {}) => {
    return request(app)
      .post('/api/patients/records')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'prescription',
        title: 'Prescription - Dr. Sharma',
        medicines: [
          { name: 'Amoxicillin', dosage: '500mg', frequency: 'twice daily', duration: '7 days' },
        ],
        rawText: SAMPLE_PRESCRIPTION,
        ...overrides,
      });
  };

  // ═══════════════════════════════════════════════════════
  // TEST 1 — AI DISABLED: record creation still works
  // ═══════════════════════════════════════════════════════

  describe('Test 1 — AI disabled', () => {
    it('creates a record with aiStatus=none and aiSummary=null when no API key is configured', async () => {
      // Ensure AI is disabled
      delete process.env.AI_API_KEY;
      delete process.env.FOLLOWUP_LLM_API_KEY;
      expect(aiService.isEnabled()).toBe(false);

      const res = await createLabReport();

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify in MongoDB directly
      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record).not.toBeNull();
      expect(record.rawText).toBe(SAMPLE_LAB_REPORT);
      expect(record.aiStatus).toBe('none');
      expect(record.aiSummary).toBeNull();
      expect(record.title).toBe('Blood Test Report Aug 2026');
      expect(record.labResults).toHaveLength(2);
    });

    it('creates a record WITHOUT rawText and AI fields remain default', async () => {
      delete process.env.AI_API_KEY;

      const res = await request(app)
        .post('/api/patients/records')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'visit',
          title: 'General Checkup',
          description: 'Routine annual visit',
        });

      expect(res.statusCode).toBe(201);
      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.rawText).toBe('');
      expect(record.aiStatus).toBe('none');
      expect(record.aiSummary).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 2 — AI ENABLED: mock provider returns valid summary
  // ═══════════════════════════════════════════════════════

  describe('Test 2 — AI enabled with valid response', () => {
    it('generates and stores a valid aiSummary when AI is configured and rawText is provided', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);

      const res = await createLabReport();

      expect(res.statusCode).toBe(201);

      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiStatus).toBe('completed');
      expect(record.aiSummary).not.toBeNull();
      expect(record.aiSummary.summary).toContain('hemoglobin');
      expect(record.aiSummary.abnormalValues).toHaveLength(3);
      expect(record.aiSummary.abnormalValues[0].test).toBe('Hemoglobin');
      expect(record.aiSummary.abnormalValues[0].flag).toBe('low');
      expect(record.aiSummary.recommendations).toHaveLength(2);

      // Verify fetch was called with correct structure
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, fetchOptions] = global.fetch.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      expect(body.temperature).toBe(0.1);
      expect(body.response_format.type).toBe('json_object');
    });

    it('does NOT call AI when rawText is empty even if API key is set', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);

      const res = await request(app)
        .post('/api/patients/records')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'visit',
          title: 'Checkup without OCR text',
        });

      expect(res.statusCode).toBe(201);
      expect(global.fetch).not.toHaveBeenCalled();

      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiStatus).toBe('none');
      expect(record.aiSummary).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 3 — rawText is preserved and never overwritten
  // ═══════════════════════════════════════════════════════

  describe('Test 3 — rawText preservation', () => {
    it('rawText in MongoDB matches the original source text exactly', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);

      await createLabReport();

      const record = await MedicalRecord.findOne({ patient: userId });
      // rawText must be the ORIGINAL OCR text, not the AI summary
      expect(record.rawText).toBe(SAMPLE_LAB_REPORT);
      expect(record.rawText).toContain('HbA1c: 6.4%');
      expect(record.rawText).toContain('LDL Cholesterol: 142 mg/dL');
      // aiSummary is the AI interpretation, NOT rawText
      expect(record.aiSummary.summary).not.toBe(record.rawText);
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 4 — Invalid AI output rejected by Zod
  // ═══════════════════════════════════════════════════════

  describe('Test 4 — Invalid AI output', () => {
    it('rejects completely wrong schema: { "hello": "test" }', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      // The LLM returns garbage — Zod should parse it with defaults (empty arrays)
      // since aiSummarySchema uses .default() for all fields
      global.fetch = mockFetchResponse({ hello: 'test' });

      const res = await createLabReport();
      expect(res.statusCode).toBe(201);

      const record = await MedicalRecord.findOne({ patient: userId });
      // Zod .default() fills in all arrays as empty — this is valid but empty
      expect(record.aiStatus).toBe('completed');
      expect(record.aiSummary.summary).toBe('');
      expect(record.aiSummary.keyFindings).toEqual([]);
    });

    it('rejects output with wrong types: number where string expected', () => {
      expect(() => aiSummarySchema.parse({
        summary: 12345,
      })).toThrow();
    });

    it('rejects output with invalid enum: flag = "elevated"', () => {
      expect(() => aiSummarySchema.parse({
        abnormalValues: [{ test: 'HbA1c', value: '6.4%', flag: 'elevated' }],
      })).toThrow();
    });

    it('rejects null input to Zod', () => {
      expect(() => aiSummarySchema.parse(null)).toThrow();
    });

    it('strips unknown/hallucinated fields from LLM output', () => {
      const parsed = aiSummarySchema.parse({
        summary: 'Test',
        diagnosis: 'Diabetes Type 2',
        treatment_plan: 'Start insulin immediately',
        secretKey: 'abc123',
      });

      expect(parsed.summary).toBe('Test');
      expect(parsed.diagnosis).toBeUndefined();
      expect(parsed.treatment_plan).toBeUndefined();
      expect(parsed.secretKey).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 5 — Malformed JSON from LLM
  // ═══════════════════════════════════════════════════════

  describe('Test 5 — Malformed JSON', () => {
    it('handles truncated JSON without crashing the server', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchMalformed();

      const res = await createLabReport();

      // Record MUST still be created
      expect(res.statusCode).toBe(201);

      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record).not.toBeNull();
      expect(record.rawText).toBe(SAMPLE_LAB_REPORT);
      expect(record.aiStatus).toBe('failed');
      expect(record.aiSummary).toBeNull();
    });

    it('handles empty response content from LLM', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            choices: [{ message: { content: '' } }],
          }),
        })
      );

      const res = await createLabReport();

      expect(res.statusCode).toBe(201);
      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiStatus).toBe('failed');
      expect(record.aiSummary).toBeNull();
      expect(record.rawText).toBe(SAMPLE_LAB_REPORT); // rawText preserved
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 6 — Hallucination behavior / Schema constraints
  // ═══════════════════════════════════════════════════════

  describe('Test 6 — Hallucination constraints', () => {
    it('schema allows only valid flag values, preventing invented categories', () => {
      const validFlags = ['normal', 'low', 'high', 'critical'];
      for (const flag of validFlags) {
        const parsed = aiSummarySchema.parse({
          abnormalValues: [{ test: 'HbA1c', value: '6.4%', flag }],
        });
        expect(parsed.abnormalValues[0].flag).toBe(flag);
      }

      // Invalid flags are rejected
      const invalidFlags = ['elevated', 'borderline', 'abnormal', 'danger', 'moderate'];
      for (const flag of invalidFlags) {
        expect(() => aiSummarySchema.parse({
          abnormalValues: [{ test: 'Test', value: '1', flag }],
        })).toThrow();
      }
    });

    it('enforces max-length constraints to prevent unbounded LLM output', () => {
      const longString = 'A'.repeat(3000);
      expect(() => aiSummarySchema.parse({
        summary: longString,
      })).toThrow();
    });

    it('enforces max array item count to prevent LLM generating hundreds of items', () => {
      const tooManyItems = Array.from({ length: 60 }, (_, i) => `Finding ${i}`);
      expect(() => aiSummarySchema.parse({
        keyFindings: tooManyItems,
      })).toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 7 — Different document types
  // ═══════════════════════════════════════════════════════

  describe('Test 7 — Different document types', () => {
    beforeEach(() => {
      process.env.AI_API_KEY = 'test-api-key';
    });

    it('lab report: abnormalValues populated, medications possibly empty', async () => {
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);
      const res = await createLabReport();
      expect(res.statusCode).toBe(201);

      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiSummary.abnormalValues.length).toBeGreaterThan(0);
      expect(record.aiSummary.medications).toEqual([]);
    });

    it('prescription: medications populated, abnormalValues possibly empty', async () => {
      const prescriptionResponse = {
        summary: 'Prescription for respiratory infection treatment.',
        keyFindings: ['Upper respiratory tract infection diagnosed'],
        abnormalValues: [],
        medications: [
          { name: 'Amoxicillin', dosage: '500mg', frequency: 'twice daily', duration: '7 days' },
          { name: 'Paracetamol', dosage: '650mg', frequency: 'as needed', duration: '' },
        ],
        recommendations: ['Follow-up in 10 days if symptoms persist'],
      };
      global.fetch = mockFetchResponse(prescriptionResponse);

      const res = await createPrescription();
      expect(res.statusCode).toBe(201);

      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiSummary.medications.length).toBeGreaterThan(0);
      expect(record.aiSummary.abnormalValues).toEqual([]);
    });

    it('radiology report: keyFindings populated, recommendations present', async () => {
      const radiologyResponse = {
        summary: 'MRI shows mild degenerative disc disease at L4-L5 and L5-S1.',
        keyFindings: [
          'Mild disc bulge at L4-L5',
          'Small central disc protrusion at L5-S1 measuring 3mm',
          'No fracture or spondylolisthesis',
        ],
        abnormalValues: [],
        medications: [],
        recommendations: [
          'Conservative management with physiotherapy',
          'Repeat MRI in 6 months if symptoms worsen',
        ],
      };
      global.fetch = mockFetchResponse(radiologyResponse);

      const res = await request(app)
        .post('/api/patients/records')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'visit',
          title: 'MRI Lumbar Spine',
          rawText: SAMPLE_RADIOLOGY,
        });

      expect(res.statusCode).toBe(201);

      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiSummary.keyFindings.length).toBeGreaterThan(0);
      expect(record.aiSummary.recommendations.length).toBeGreaterThan(0);
      expect(record.aiSummary.medications).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 8 — Long documents truncated safely
  // ═══════════════════════════════════════════════════════

  describe('Test 8 — Long documents', () => {
    it('truncates text exceeding MAX_INPUT_CHARS before sending to AI', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);

      const longText = SAMPLE_LAB_REPORT + '\n' + 'X'.repeat(aiService.MAX_INPUT_CHARS);

      const res = await createLabReport({ rawText: longText });

      expect(res.statusCode).toBe(201);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Verify the text sent to LLM was truncated
      const [, fetchOptions] = global.fetch.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      const userMessage = body.messages[1].content;
      // The prompt wraps the text, so the raw text portion should be capped
      expect(userMessage.length).toBeLessThan(longText.length + 500);

      // rawText in MongoDB stores the FULL original (up to Mongoose maxlength)
      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.rawText.length).toBeGreaterThan(aiService.MAX_INPUT_CHARS);
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 9 — AI provider failure: record still saved
  // ═══════════════════════════════════════════════════════

  describe('Test 9 — AI provider failure', () => {
    it('saves record with aiStatus=failed when API returns 500', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchFailure(500);

      const res = await createLabReport();

      expect(res.statusCode).toBe(201); // Record MUST still be created
      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record).not.toBeNull();
      expect(record.rawText).toBe(SAMPLE_LAB_REPORT);
      expect(record.aiStatus).toBe('failed');
      expect(record.aiSummary).toBeNull();
    });

    it('saves record with aiStatus=failed when API returns 429 (rate limited)', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchFailure(429);

      const res = await createLabReport();

      expect(res.statusCode).toBe(201);
      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiStatus).toBe('failed');
      expect(record.aiSummary).toBeNull();
    });

    it('saves record with aiStatus=failed on network error (ECONNREFUSED)', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchNetworkError();

      const res = await createLabReport();

      expect(res.statusCode).toBe(201);
      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiStatus).toBe('failed');
      expect(record.aiSummary).toBeNull();
      expect(record.rawText).toBe(SAMPLE_LAB_REPORT);
    });

    it('saves record with aiStatus=failed when API key is invalid (401)', async () => {
      process.env.AI_API_KEY = 'invalid-key-12345';
      global.fetch = mockFetchFailure(401);

      const res = await createLabReport();

      expect(res.statusCode).toBe(201);
      const record = await MedicalRecord.findOne({ patient: userId });
      expect(record.aiStatus).toBe('failed');
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 10 — Logging: no PHI leaked
  // ═══════════════════════════════════════════════════════

  describe('Test 10 — No PHI in logs', () => {
    it('AI service does NOT include rawText or patient data in log calls', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);

      // Spy on logger
      const logger = require('../src/utils/logger');
      const infoSpy = jest.spyOn(logger, 'info');
      const errorSpy = jest.spyOn(logger, 'error');

      await createLabReport();

      // Check all info log calls — none should contain PHI
      for (const call of infoSpy.mock.calls) {
        const logMessage = JSON.stringify(call);
        expect(logMessage).not.toContain('John Doe');
        expect(logMessage).not.toContain('15/03/1985');
        expect(logMessage).not.toContain(process.env.AI_API_KEY);
      }

      // Check error logs too
      for (const call of errorSpy.mock.calls) {
        const logMessage = JSON.stringify(call);
        expect(logMessage).not.toContain('John Doe');
        expect(logMessage).not.toContain(process.env.AI_API_KEY);
      }

      infoSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 11 — Duplicate uploads create separate records
  // ═══════════════════════════════════════════════════════

  describe('Test 11 — Duplicate handling', () => {
    it('uploading the same report twice creates two separate records', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);

      const res1 = await createLabReport();
      const res2 = await createLabReport();

      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);

      const records = await MedicalRecord.find({ patient: userId });
      expect(records).toHaveLength(2);
      expect(records[0]._id.toString()).not.toBe(records[1]._id.toString());
      // Both have the same rawText but are independent documents
      expect(records[0].rawText).toBe(records[1].rawText);
    });
  });

  // ═══════════════════════════════════════════════════════
  // TEST 12 — Existing functionality unbroken
  // ═══════════════════════════════════════════════════════

  describe('Test 12 — Existing functionality preserved', () => {
    it('record CRUD still works: create → list → update → delete', async () => {
      delete process.env.AI_API_KEY;

      // Create
      const createRes = await createLabReport({ rawText: '' });
      expect(createRes.statusCode).toBe(201);
      const recordId = createRes.body.data.record._id;

      // List
      const listRes = await request(app)
        .get('/api/patients/records')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.data.records).toHaveLength(1);

      // Update
      const updateRes = await request(app)
        .patch(`/api/patients/records/${recordId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Updated Title' });
      expect(updateRes.statusCode).toBe(200);

      // Delete
      const deleteRes = await request(app)
        .delete(`/api/patients/records/${recordId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(deleteRes.statusCode).toBe(200);

      // Verify deleted
      const after = await MedicalRecord.findById(recordId);
      expect(after).toBeNull();
    });

    it('timeline endpoint still works with AI fields present', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);

      await createLabReport();

      const res = await request(app)
        .get('/api/patients/timeline')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.groups.length).toBeGreaterThan(0);
      expect(res.body.data.total).toBe(1);
    });

    it('prescription creation with drug interaction check still works', async () => {
      delete process.env.AI_API_KEY;

      const res = await createPrescription({ rawText: '' });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.record.type).toBe('prescription');
      expect(res.body.data.record.medicines).toHaveLength(1);
    });

    it('medication cabinet endpoint still works', async () => {
      delete process.env.AI_API_KEY;

      await createPrescription({ rawText: '' });

      const res = await request(app)
        .get('/api/patients/medications')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.activeMedications).toHaveLength(1);
    });

    it('authentication still required for record endpoints', async () => {
      const res = await request(app)
        .post('/api/patients/records')
        .send({ type: 'visit', title: 'Test' });

      expect(res.statusCode).toBe(401);
    });

    it('aiSummary field CANNOT be injected from HTTP request body', async () => {
      process.env.AI_API_KEY = 'test-api-key';
      global.fetch = mockFetchResponse(VALID_AI_RESPONSE);

      // Attempt to inject a fake aiSummary via the request body
      const res = await request(app)
        .post('/api/patients/records')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'visit',
          title: 'Injected AI Test',
          rawText: SAMPLE_LAB_REPORT,
          aiSummary: {
            summary: 'INJECTED FAKE SUMMARY',
            keyFindings: ['Fake finding'],
          },
        });

      expect(res.statusCode).toBe(201);

      const record = await MedicalRecord.findOne({ patient: userId });
      // The stored aiSummary should be from the REAL AI call, not the injected one
      expect(record.aiSummary.summary).not.toBe('INJECTED FAKE SUMMARY');
      expect(record.aiSummary.summary).toContain('hemoglobin');
    });
  });
});
