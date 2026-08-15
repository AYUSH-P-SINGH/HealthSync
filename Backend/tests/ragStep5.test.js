process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const MedicalRecord = require('../src/models/MedicalRecord');
const MedicalRecordChunk = require('../src/models/MedicalRecordChunk');
const vectorService = require('../src/services/ai/vector.service');
const ragService = require('../src/services/ai/rag.service');
const groundingValidator = require('../src/services/ai/grounding.validator');

const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/healthsync_test';
jest.setTimeout(30000);

describe('Step 5 — Grounded RAG System & AI API Integration Tests', () => {
  let patient;
  let patientToken;
  let record1;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGO_URI);
    }
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await MedicalRecord.deleteMany({});
    await MedicalRecordChunk.deleteMany({});

    // Register & log in Patient
    const regRes = await request(app).post('/api/auth/register').send({
      firstName: 'RAGPatient',
      lastName: 'Testing',
      email: 'ragpatient@example.com',
      mobileNumber: '9876543210',
      password: 'Password123!',
    });
    const patientId = regRes.body.data._id;
    await User.findByIdAndUpdate(patientId, { isVerified: true });

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'ragpatient@example.com',
      password: 'Password123!',
      role: 'user',
    });
    patientToken = loginRes.body.data.accessToken;
    patient = await User.findById(patientId);

    // Create medical record for patient
    record1 = await MedicalRecord.create({
      patient: patient._id,
      createdByRole: 'patient',
      title: 'HbA1c Lab Progress Report',
      type: 'lab_report',
      recordDate: new Date('2026-02-21'),
      rawText: 'Patient HbA1c levels measured at 6.4% on 2026-02-21. Previous HbA1c was 5.8% on 2024-03-12.',
    });

    await vectorService.processAndStoreRecordChunks({
      recordId: record1._id,
      patientId: patient._id,
      rawText: record1.rawText,
      metadata: { recordType: 'lab_report', recordTitle: record1.title, recordDate: record1.recordDate },
    });
  });

  test('5.1 Grounding Validator checks numerical claims & citations against source chunks', () => {
    const chunks = [{ recordId: 'rec123', chunkId: 'chk456', text: 'HbA1c: 6.4%' }];
    const citations = [{ recordId: 'rec123', chunkId: 'chk456', recordType: 'lab_report', date: '2026-02-21' }];

    // Grounded match
    const valid = groundingValidator.validateGrounding({
      answer: 'Your HbA1c is 6.4%.',
      citations,
      chunks,
    });
    expect(valid.isGrounded).toBe(true);
    expect(valid.validCitations.length).toBe(1);

    // Hallucinated number
    const invalid = groundingValidator.validateGrounding({
      answer: 'Your HbA1c is 7.4%.',
      citations,
      chunks,
    });
    expect(invalid.isGrounded).toBe(false);
    expect(invalid.ungroundedTokens.some((t) => t.includes('7.4'))).toBe(true);
  });

  test('5.2 askRAG service generates grounded answer with citations and confidence', async () => {
    const ragResponse = await ragService.askRAG({
      query: 'How has my HbA1c changed?',
      authenticatedUserId: patient._id.toString(),
      userRole: 'patient',
    });

    expect(ragResponse.answer).toBeDefined();
    expect(typeof ragResponse.answer).toBe('string');
    expect(Array.isArray(ragResponse.citations)).toBe(true);
    expect(ragResponse.citations.length).toBeGreaterThan(0);
    expect(ragResponse.citations[0].recordId).toBe(record1._id.toString());
    expect(['high', 'medium', 'low']).toContain(ragResponse.confidence);
  });

  test('5.3 POST /api/ai/ask authenticated API endpoint returns validated schema', async () => {
    const res = await request(app)
      .post('/api/ai/ask')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        query: 'What were my HbA1c lab results?',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.answer).toBeDefined();
    expect(Array.isArray(res.body.data.citations)).toBe(true);
    expect(res.body.data.citations.length).toBeGreaterThan(0);
    expect(res.body.data.confidence).toBeDefined();
  });

  test('5.4 POST /api/ai/ask rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/ai/ask')
      .send({
        query: 'What are my medical records?',
      });

    expect(res.status).toBe(401);
  });

  test('5.5 Minimum relevance threshold returns NO_EVIDENCE when evidence is absent', async () => {
    const ragResponse = await ragService.askRAG({
      query: 'What was my echocardiogram ejection fraction?',
      authenticatedUserId: patient._id.toString(),
      userRole: 'patient',
    });

    expect(ragResponse.hasEvidence).toBe(false);
    expect(ragResponse.confidence).toBe('low');
    expect(ragResponse.citations).toEqual([]);
    expect(ragResponse.answer).toContain("couldn't find enough relevant information");
  });
});
