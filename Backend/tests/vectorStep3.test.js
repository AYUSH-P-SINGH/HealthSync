/**
 * Step 3 Integration Test Suite — Vector Embeddings & MedicalRecordChunk Persistence
 *
 * Verifies the Step 3 target pipeline:
 *   MedicalRecord.rawText → Chunking → Embedding → MedicalRecordChunk → MongoDB
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const MedicalRecord = require('../src/models/MedicalRecord');
const MedicalRecordChunk = require('../src/models/MedicalRecordChunk');
const emailService = require('../src/services/email.service');
const embeddingService = require('../src/services/ai/embedding.service');
const vectorService = require('../src/services/ai/vector.service');

jest.spyOn(emailService, 'sendVerificationEmail').mockImplementation(() => Promise.resolve(true));

const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/healthsync_test';

const testUser = {
  firstName: 'Vector',
  lastName: 'Tester',
  email: 'vector.step3@example.com',
  mobileNumber: '9000000009',
  password: 'Password123!',
};

const LONG_MEDICAL_REPORT = `
CITY GENERAL HOSPITAL - CLINICAL DISCHARGE SUMMARY
Patient Name: Robert Chen    DOB: 12/04/1978    Date of Admission: 01/08/2026

PRIMARY DIAGNOSIS:
Acute exacerbation of chronic obstructive pulmonary disease (COPD) with secondary mild community-acquired pneumonia.

HISTORY OF PRESENT ILLNESS:
The patient is a 48-year-old male with a history of moderate COPD presenting with progressive dyspnea, increased sputum production, and low-grade fever over 3 days. Vital signs on admission: Blood Pressure 134/86 mmHg, Heart Rate 92 bpm, SpO2 91% on room air, Temperature 38.1 C.

LABORATORY & DIAGNOSTIC FINDINGS:
1. Complete Blood Count:
   - WBC: 13.4 x10^3 /uL (HIGH)
   - Hemoglobin: 14.8 g/dL (NORMAL)
   - Platelets: 280 x10^3 /uL (NORMAL)
2. Arterial Blood Gas (Room Air):
   - pH: 7.36
   - PaCO2: 48 mmHg (SLIGHTLY ELEVATED)
   - PaO2: 62 mmHg (LOW)
3. Chest X-Ray:
   - Bilateral hyperinflation consistent with COPD.
   - Patchy opacity in the right lower lobe indicating mild consolidation/pneumonia.

HOSPITAL COURSE & TREATMENT:
Patient was treated with intravenous bronchodilators, short-course systemic corticosteroids (Methylprednisolone 40mg IV daily), and targeted antibiotic coverage (Azithromycin 500mg daily for 5 days). Oxygen supplementation via nasal cannula was titrated to maintain SpO2 > 92%. Patient showed significant clinical improvement by day 3 with resolution of fever and decreased oxygen requirements.

DISCHARGE MEDICATIONS:
1. Fluticasone/Salmeterol 250/50 mcg inhaler - 1 puff twice daily continuously.
2. Albuterol 90 mcg inhaler - 2 puffs every 4-6 hours as needed for shortness of breath.
3. Prednisone 20mg oral tablet - Take 1 tablet daily for 5 days then discontinue.
4. Azithromycin 250mg oral tablet - Take 1 tablet daily for 2 remaining days to complete 5-day course.

RECOMMENDATIONS & FOLLOW-UP:
- Follow up with Pulmonology clinic in 2 weeks for spirometry re-evaluation.
- Repeat chest X-ray in 6 weeks to confirm resolution of right lower lobe opacity.
- Continue daily pulse oximetry monitoring at home. Seek immediate care if SpO2 < 90%.
`;

describe('Step 3: Chunking, Embeddings & MedicalRecordChunk Persistence', () => {
  let accessToken;
  let userId;

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
    jest.clearAllMocks();
    await User.deleteMany({});
    await MedicalRecord.deleteMany({});
    await MedicalRecordChunk.deleteMany({});

    const tokenService = require('../src/services/token.service');

    const user = await User.create({
      fullName: { firstName: testUser.firstName, lastName: testUser.lastName },
      email: testUser.email,
      mobileNumber: testUser.mobileNumber,
      password: testUser.password,
      isVerified: true,
    });

    accessToken = tokenService.generateAccessToken(user._id.toString(), 'user');
    userId = user._id;
  });

  // ─── 1. Unit Test for Embedding Service ──────────────────
  describe('Embedding Service (embedding.service.js)', () => {
    it('generates a normalized vector array of expected dimension', async () => {
      const vector = await embeddingService.generateEmbedding('Sample medical text for embedding');
      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBe(768);
      vector.forEach((val) => expect(typeof val).toBe('number'));
    });

    it('returns zero vector for empty text', async () => {
      const vector = await embeddingService.generateEmbedding('');
      expect(vector).toHaveLength(768);
      expect(vector.every((v) => v === 0)).toBe(true);
    });
  });

  // ─── 2. Vector Service Direct Processing ─────────────────
  describe('Vector Service (vector.service.js)', () => {
    it('processes rawText into chunks and persists MedicalRecordChunks in MongoDB', async () => {
      const record = await MedicalRecord.create({
        patient: userId,
        createdByRole: 'patient',
        type: 'visit',
        title: 'COPD Discharge Summary',
        rawText: LONG_MEDICAL_REPORT,
      });

      const chunks = await vectorService.processAndStoreRecordChunks({
        recordId: record._id,
        patientId: userId,
        rawText: LONG_MEDICAL_REPORT,
        metadata: {
          recordType: 'visit',
          recordTitle: record.title,
        },
      });

      expect(chunks.length).toBeGreaterThan(1);

      // Verify in MongoDB
      const stored = await MedicalRecordChunk.find({ record: record._id }).sort({ chunkIndex: 1 });
      expect(stored).toHaveLength(chunks.length);

      stored.forEach((doc, idx) => {
        expect(doc.patient.toString()).toBe(userId.toString());
        expect(doc.record.toString()).toBe(record._id.toString());
        expect(doc.chunkIndex).toBe(idx);
        expect(doc.totalChunks).toBe(stored.length);
        expect(doc.text.length).toBeGreaterThan(0);
        expect(doc.embedding.length).toBe(768);
        expect(doc.metadata.recordType).toBe('visit');
      });
    });

    it('removes chunks cleanly when removeRecordChunks is called', async () => {
      const record = await MedicalRecord.create({
        patient: userId,
        createdByRole: 'patient',
        type: 'visit',
        title: 'Temporary Record',
        rawText: LONG_MEDICAL_REPORT,
      });

      await vectorService.processAndStoreRecordChunks({
        recordId: record._id,
        patientId: userId,
        rawText: LONG_MEDICAL_REPORT,
      });

      const beforeCount = await MedicalRecordChunk.countDocuments({ record: record._id });
      expect(beforeCount).toBeGreaterThan(0);

      const deletedCount = await vectorService.removeRecordChunks(record._id);
      expect(deletedCount).toBe(beforeCount);

      const afterCount = await MedicalRecordChunk.countDocuments({ record: record._id });
      expect(afterCount).toBe(0);
    });
  });

  // ─── 3. Full API Pipeline Integration ────────────────────
  describe('Full HTTP API Pipeline Integration', () => {
    it('automatically creates MedicalRecordChunks when a record with rawText is posted via API', async () => {
      const res = await request(app)
        .post('/api/patients/records')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'visit',
          title: 'Automated Chunking Test Record',
          description: 'Testing automatic vector chunk creation',
          rawText: LONG_MEDICAL_REPORT,
        });

      expect(res.statusCode).toBe(201);
      const recordId = res.body.data.record._id;

      // Verify MedicalRecordChunk persistence in MongoDB
      const chunks = await MedicalRecordChunk.find({ record: recordId }).sort({ chunkIndex: 1 });
      expect(chunks.length).toBeGreaterThan(0);

      chunks.forEach((chunk) => {
        expect(chunk.patient.toString()).toBe(userId.toString());
        expect(chunk.embedding.length).toBe(768);
        expect(chunk.metadata.recordTitle).toBe('Automated Chunking Test Record');
      });
    });

    it('does NOT create MedicalRecordChunks when rawText is empty', async () => {
      const res = await request(app)
        .post('/api/patients/records')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'visit',
          title: 'Record Without Raw Text',
          description: 'No text layer',
        });

      expect(res.statusCode).toBe(201);
      const recordId = res.body.data.record._id;

      const chunks = await MedicalRecordChunk.find({ record: recordId });
      expect(chunks).toHaveLength(0);
    });

    it('automatically deletes MedicalRecordChunks when a record is deleted by the patient', async () => {
      // 1. Create record with rawText
      const createRes = await request(app)
        .post('/api/patients/records')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'visit',
          title: 'Record To Be Deleted',
          rawText: LONG_MEDICAL_REPORT,
        });

      const recordId = createRes.body.data.record._id;

      // Confirm chunks exist
      const chunksBefore = await MedicalRecordChunk.find({ record: recordId });
      expect(chunksBefore.length).toBeGreaterThan(0);

      // 2. Delete record
      const deleteRes = await request(app)
        .delete(`/api/patients/records/${recordId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(deleteRes.statusCode).toBe(200);

      // 3. Confirm chunks are cascade-deleted
      const chunksAfter = await MedicalRecordChunk.find({ record: recordId });
      expect(chunksAfter).toHaveLength(0);
    });
  });
});
