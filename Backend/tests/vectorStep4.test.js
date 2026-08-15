process.env.NODE_ENV = 'test';
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const MedicalRecord = require('../src/models/MedicalRecord');
const MedicalRecordChunk = require('../src/models/MedicalRecordChunk');
const embeddingService = require('../src/services/ai/embedding.service');
const vectorService = require('../src/services/ai/vector.service');
const { RECORD_TYPES } = require('../src/constants/recordTypes');

const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/healthsync_test';
jest.setTimeout(30000);

describe('Step 4 — MongoDB Vector Search & Secure Retrieval Integration Tests', () => {
  let patientA;
  let patientB;
  let recordA1;
  let recordA2;
  let recordB1;

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

    // Create Patient A
    patientA = await User.create({
      fullName: { firstName: 'PatientA', lastName: 'Doe' },
      healthSyncId: `HS-A${Math.floor(1000000 + Math.random() * 9000000)}`,
      email: `patientA.${Math.random()}@example.com`,
      mobileNumber: '9876543210',
      password: 'Password123!',
      isVerified: true,
    });

    // Create Patient B
    patientB = await User.create({
      fullName: { firstName: 'PatientB', lastName: 'Smith' },
      healthSyncId: `HS-B${Math.floor(1000000 + Math.random() * 9000000)}`,
      email: `patientB.${Math.random()}@example.com`,
      mobileNumber: '9876543211',
      password: 'Password123!',
      isVerified: true,
    });

    // Create records for Patient A
    recordA1 = await MedicalRecord.create({
      patient: patientA._id,
      createdByRole: 'patient',
      title: 'HbA1c Lab Report 2024',
      type: 'lab_report',
      recordDate: new Date('2024-03-12'),
      rawText: 'Patient HbA1c test result: 5.8%. Fasting glucose is 95 mg/dL. Normal renal panel.',
    });
    await vectorService.processAndStoreRecordChunks({
      recordId: recordA1._id,
      patientId: patientA._id,
      rawText: recordA1.rawText,
      metadata: { recordType: 'lab_report', recordTitle: recordA1.title, recordDate: recordA1.recordDate },
    });

    recordA2 = await MedicalRecord.create({
      patient: patientA._id,
      createdByRole: 'patient',
      title: 'Diabetes Medication Prescription',
      type: 'prescription',
      recordDate: new Date('2025-01-17'),
      rawText: 'Prescription: Metformin 500mg twice daily with meals. Atorvastatin 20mg once daily.',
    });
    await vectorService.processAndStoreRecordChunks({
      recordId: recordA2._id,
      patientId: patientA._id,
      rawText: recordA2.rawText,
      metadata: { recordType: 'prescription', recordTitle: recordA2.title, recordDate: recordA2.recordDate },
    });

    // Create record for Patient B
    recordB1 = await MedicalRecord.create({
      patient: patientB._id,
      createdByRole: 'patient',
      title: 'Patient B HbA1c Lab Report',
      type: 'lab_report',
      recordDate: new Date('2026-02-21'),
      rawText: 'Patient B HbA1c test result: 9.2%. High blood sugar flagged.',
    });
    await vectorService.processAndStoreRecordChunks({
      recordId: recordB1._id,
      patientId: patientB._id,
      rawText: recordB1.rawText,
      metadata: { recordType: 'lab_report', recordTitle: recordB1.title, recordDate: recordB1.recordDate },
    });
  });

  test('4.1 Embeddings & Query Embeddings enforce 768 dimensions strictly', async () => {
    const queryVector = await embeddingService.embedQuery('How has my HbA1c changed?');
    expect(Array.isArray(queryVector)).toBe(true);
    expect(queryVector.length).toBe(768);

    // Verify dimension validator throws error on wrong dimension count
    expect(() => {
      embeddingService.validateEmbeddingDimensions([0.1, 0.2, 0.3]);
    }).toThrow(/Embedding dimension mismatch: expected 768, got 3/);
  });

  test('4.2 searchSimilarChunks retrieves relevant chunks for authorised patient', async () => {
    const results = await vectorService.searchSimilarChunks({
      query: 'HbA1c test result',
      patientId: patientA._id,
      allowedRecordTypes: ['lab_report', 'prescription'],
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    const labRecordResult = results.find((r) => r.recordId === recordA1._id.toString());
    expect(labRecordResult).toBeDefined();
    expect(labRecordResult.text).toContain('HbA1c');
    expect(labRecordResult.score).toBeGreaterThan(0);
  });

  test('4.3 Patient Isolation: Patient A cannot retrieve Patient B chunks', async () => {
    const resultsForA = await vectorService.searchSimilarChunks({
      query: 'Patient B HbA1c high blood sugar',
      patientId: patientA._id,
      allowedRecordTypes: RECORD_TYPES,
      limit: 10,
    });

    // All returned chunks MUST belong exclusively to Patient A
    const returnedRecordIds = resultsForA.map((r) => r.recordId);
    expect(returnedRecordIds).not.toContain(recordB1._id.toString());
    expect(returnedRecordIds.every((id) => id === recordA1._id.toString() || id === recordA2._id.toString())).toBe(true);
  });

  test('4.4 Record-Type Security Filtering: Unauthorized record types are excluded at DB query level', async () => {
    // Grant access ONLY to prescriptions (excluding lab_reports)
    const resultsOnlyPrescriptions = await vectorService.searchSimilarChunks({
      query: 'HbA1c lab report',
      patientId: patientA._id,
      allowedRecordTypes: ['prescription'],
      limit: 10,
    });

    // Even though query mentions HbA1c (which is in lab_report recordA1), lab_report is NOT in allowedRecordTypes
    const returnedRecordIds = resultsOnlyPrescriptions.map((r) => r.recordId);
    expect(returnedRecordIds).not.toContain(recordA1._id.toString());
    if (resultsOnlyPrescriptions.length > 0) {
      expect(resultsOnlyPrescriptions.every((r) => r.recordType === 'prescription')).toBe(true);
    }
  });

  test('4.5 Edge cases: Handles empty query, empty allowed types, and no matches gracefully', async () => {
    const emptyQueryRes = await vectorService.searchSimilarChunks({
      query: '',
      patientId: patientA._id,
      allowedRecordTypes: ['lab_report'],
    });
    expect(emptyQueryRes).toEqual([]);

    const emptyTypesRes = await vectorService.searchSimilarChunks({
      query: 'HbA1c',
      patientId: patientA._id,
      allowedRecordTypes: [],
    });
    expect(emptyTypesRes).toEqual([]);

    const nonExistentPatientId = new mongoose.Types.ObjectId();
    const noResultsRes = await vectorService.searchSimilarChunks({
      query: 'HbA1c',
      patientId: nonExistentPatientId,
      allowedRecordTypes: RECORD_TYPES,
    });
    expect(noResultsRes).toEqual([]);
  });
});
