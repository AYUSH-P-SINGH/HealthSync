/**
 * Step 8 & Step 9 AI Orchestrator & Intent Router Integration Test Suite
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const MedicalRecord = require('../src/models/MedicalRecord');
const MedicalRecordChunk = require('../src/models/MedicalRecordChunk');
const aiOrchestrator = require('../src/services/ai/ai.orchestrator');
const tokenService = require('../src/services/token.service');
const intentRouter = require('../src/services/ai/intent.router');
const ragService = require('../src/services/ai/rag.service');
const vectorService = require('../src/services/ai/vector.service');
const groundingValidator = require('../src/services/ai/grounding.validator');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/healthsync_test';

describe('Steps 8 & 9 — Intent Routing & AI Orchestration Integration Tests', () => {
  let patient;
  let token;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGO_URI);
    }

    await User.deleteMany({});
    await MedicalRecord.deleteMany({});
    const regRes = await request(app).post('/api/auth/register').send({
      firstName: 'Orchestrator',
      lastName: 'Patient',
      email: 'orchestrator.patient@example.com',
      mobileNumber: '9876543299',
      password: 'Password123!',
    });
    const patientId = regRes.body.data._id;
    await User.findByIdAndUpdate(patientId, { isVerified: true });
    patient = await User.findById(patientId);

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'orchestrator.patient@example.com',
      password: 'Password123!',
    });
    token = loginRes.body.data.accessToken;

    // Create 2 Medical Records with deterministic embeddings
    const record1 = await MedicalRecord.create({
      patient: patient._id,
      createdByRole: 'patient',
      title: 'Comprehensive Blood Panel',
      type: 'lab_report',
      recordDate: new Date('2025-09-15'),
      rawText: 'Patient HbA1c test result: 6.8%. Hemoglobin: 13.8 g/dL. Fasting Blood Glucose: 105 mg/dL.',
    });

    await vectorService.processAndStoreRecordChunks({
      recordId: record1._id,
      patientId: patient._id,
      rawText: record1.rawText,
      metadata: {
        recordType: 'lab_report',
        recordTitle: 'Comprehensive Blood Panel',
        recordDate: '2025-09-15',
      },
    });

    const record2 = await MedicalRecord.create({
      patient: patient._id,
      createdByRole: 'patient',
      title: 'Followup Lab Report',
      type: 'lab_report',
      recordDate: new Date('2026-03-15'),
      rawText: 'Patient HbA1c test result: 7.2%. Fasting Blood Glucose: 118 mg/dL. Doctor note: Repeat test in 6 months.',
    });

    await vectorService.processAndStoreRecordChunks({
      recordId: record2._id,
      patientId: patient._id,
      rawText: record2.rawText,
      metadata: {
        recordType: 'lab_report',
        recordTitle: 'Followup Lab Report',
        recordDate: '2026-03-15',
      },
    });
  }, 15000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  test('Route 1: UNSUPPORTED_MEDICAL_ADVICE -> Returns ADVICE_REFUSAL with disclaimer', async () => {
    const res = await request(app)
      .post('/api/ai/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'My HbA1c is 7.2. What medicine should I take?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.responseType).toBe('ADVICE_REFUSAL');
    expect(res.body.data.answer).toContain('does not provide medication, treatment recommendations, or medical diagnoses');
    expect(res.body.data.answer).toContain('Please consult a qualified healthcare professional');
  });

  test('Route 2: RECORD_SUMMARY -> Classifies and returns RECORD_SUMMARY', async () => {
    const result = await aiOrchestrator.processAIQuery({
      query: 'Summarize my latest blood report in simple English',
      authenticatedUserId: patient._id.toString(),
      userRole: 'patient',
    });

    expect(result.responseType).toBe('RECORD_SUMMARY');
    expect(result.hasEvidence).toBe(true);
    expect(result.answer).toBeDefined();
    expect(result.citations.length).toBeGreaterThan(0);
  });

  test('Route 3: RECORD_COMPARISON -> Classifies and returns COMPARISON', async () => {
    const result = await aiOrchestrator.processAIQuery({
      query: 'Compare my HbA1c lab report results across 2025 and 2026',
      authenticatedUserId: patient._id.toString(),
      userRole: 'patient',
    });

    expect(result.responseType).toBe('COMPARISON');
    expect(result.hasEvidence).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
  });

  test('Route 4: FACT_RETRIEVAL -> Extracts specific facts with source citations', async () => {
    const result = await aiOrchestrator.processAIQuery({
      query: 'What was my HbA1c value in September 2025?',
      authenticatedUserId: patient._id.toString(),
      userRole: 'patient',
    });

    expect(result.responseType).toBe('FACT_RETRIEVAL');
    expect(result.hasEvidence).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
  });

  test('Route 5: NO_EVIDENCE -> Returns NO_EVIDENCE when records do not contain the answer', async () => {
    const result = await aiOrchestrator.processAIQuery({
      query: 'What did my chest CT scan show?',
      authenticatedUserId: patient._id.toString(),
      userRole: 'patient',
    });

    expect(result.responseType).toBe('NO_EVIDENCE');
    expect(result.hasEvidence).toBe(false);
    expect(result.citations).toEqual([]);
  });
});
