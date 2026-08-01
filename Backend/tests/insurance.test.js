process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Insurance = require('../src/models/Insurance');
const InsuranceConsent = require('../src/models/InsuranceConsent');
const Policy = require('../src/models/Policy');
const Disclosure = require('../src/models/Disclosure');
const Claim = require('../src/models/Claim');
const auditService = require('../src/services/audit.service');

const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/healthsync_test';

const testPatient = {
  firstName: 'Ayush',
  lastName: 'Singh',
  email: 'patient.insurance.test@example.com',
  mobileNumber: '9876543001',
  password: 'Password123!',
};

const testInsurance = {
  companyName: 'Star Health Insurance',
  email: 'starhealth.test@insurance.com',
  mobileNumber: '9876543002',
  password: 'Password123!',
  registrationNumber: 'IRDAI-TEST-001',
  address: {
    street: '10 Tech Park',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    country: 'India',
  },
  policyTypes: ['Individual Health', 'Family Floater'],
  isVerified: true,
};

describe('Insurance Module Integration Tests', () => {
  let patientToken;
  let insuranceToken;
  let patientId;
  let insuranceId;
  let healthSyncId;
  let consentId;
  let policyId;

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
    await Insurance.deleteMany({});
    await InsuranceConsent.deleteMany({});
    await Policy.deleteMany({});
    await Disclosure.deleteMany({});
    await Claim.deleteMany({});

    // Register & log in Patient
    const regRes = await request(app).post('/api/auth/register').send(testPatient);
    patientId = regRes.body.data._id;
    await User.findByIdAndUpdate(patientId, { isVerified: true });

    const patLogin = await request(app).post('/api/auth/login').send({
      email: testPatient.email,
      password: testPatient.password,
      role: 'user',
    });
    patientToken = patLogin.body.data.accessToken;

    const patProfile = await User.findById(patientId);
    healthSyncId = patProfile.healthSyncId || patProfile.patientId;

    // Create & log in Insurance Organization
    const insDoc = await Insurance.create(testInsurance);
    insuranceId = insDoc._id;

    const insLogin = await request(app).post('/api/auth/login').send({
      email: testInsurance.email,
      password: testInsurance.password,
      role: 'insurance',
    });
    insuranceToken = insLogin.body.data.accessToken;
  });

  test('Phase 1: HealthSync ID is auto-generated for registered patient', async () => {
    expect(healthSyncId).toBeDefined();
    expect(healthSyncId).toMatch(/^HS-[A-F0-9]{8}$/);
  });

  test('Phase 2: Insurance Organization can search patient by HealthSync ID', async () => {
    const res = await request(app)
      .get(`/api/insurance/search/${healthSyncId}`)
      .set('Authorization', `Bearer ${insuranceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.patientName).toBe('Ayush Singh');
    expect(res.body.data.healthSyncId).toBe(healthSyncId);
    expect(res.body.data.maskedEmail).toBeDefined();
  });

  test('Phase 3: Insurance sends access request & patient approves with permissions', async () => {
    // Insurer requests access
    const reqRes = await request(app)
      .post('/api/insurance/request-access')
      .set('Authorization', `Bearer ${insuranceToken}`)
      .send({
        healthSyncId,
        purpose: 'Underwriting Health Insurance Policy',
        permissions: ['medicalHistory', 'allergies', 'prescriptions'],
      });

    expect(reqRes.status).toBe(201);
    consentId = reqRes.body.data._id;
    expect(reqRes.body.data.status).toBe('pending');

    // Patient lists insurance requests
    const listRes = await request(app)
      .get('/api/patients/insurance-requests')
      .set('Authorization', `Bearer ${patientToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);

    // Patient approves request with permissions
    const appRes = await request(app)
      .patch(`/api/patients/insurance-requests/${consentId}/respond`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        action: 'approve',
        permissions: ['medicalHistory', 'allergies'],
      });

    expect(appRes.status).toBe(200);
    expect(appRes.body.data.status).toBe('approved');
  });

  test('Phase 4: Scoped records access works for approved consent', async () => {
    // Approve consent first
    const consent = await InsuranceConsent.create({
      patient: patientId,
      insurance: insuranceId,
      purpose: 'Policy Underwriting',
      permissions: ['medicalHistory', 'allergies'],
      status: 'approved',
    });

    const res = await request(app)
      .get(`/api/insurance/patient/${patientId}/records`)
      .set('Authorization', `Bearer ${insuranceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.patientName).toBe('Ayush Singh');
    expect(res.body.data.medicalHistory).toBeDefined();
    expect(res.body.data.allergies).toBeDefined();
    // Prescriptions was NOT in granted permissions
    expect(res.body.data.prescriptions).toBeUndefined();
  });

  test('Phase 5: Policy issuance creates policy & SHA-256 Disclosure Record', async () => {
    // Approve consent
    await InsuranceConsent.create({
      patient: patientId,
      insurance: insuranceId,
      purpose: 'Underwriting',
      permissions: ['medicalHistory', 'allergies', 'reports'],
      status: 'approved',
    });

    const polRes = await request(app)
      .post('/api/insurance/policy')
      .set('Authorization', `Bearer ${insuranceToken}`)
      .send({
        patientId,
        type: 'Individual Health',
        coverageAmount: 500000,
        premium: 12000,
        durationMonths: 12,
      });

    expect(polRes.status).toBe(201);
    expect(polRes.body.data.policy.policyNumber).toMatch(/^POL-\d{4}-\d{6}$/);
    expect(polRes.body.data.disclosure.recordHash).toBeDefined();
    expect(polRes.body.data.disclosure.recordHash.length).toBe(64); // SHA-256 hex length
  });

  test('Phase 6: Claims submission & status update pipeline', async () => {
    // Setup approved consent & policy
    const consent = await InsuranceConsent.create({
      patient: patientId,
      insurance: insuranceId,
      purpose: 'Underwriting',
      status: 'approved',
    });

    const policy = await Policy.create({
      patient: patientId,
      insurance: insuranceId,
      consent: consent._id,
      policyNumber: 'POL-2026-112233',
      type: 'Individual Health',
      coverageAmount: 500000,
      premium: 10000,
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: 'active',
    });

    // Patient submits claim
    const claimRes = await request(app)
      .post('/api/patients/claims')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        policyId: policy._id,
        hospitalName: 'Manipal Hospital',
        diagnosis: 'Acute Gastritis Treatment',
        claimAmount: 45000,
      });

    expect(claimRes.status).toBe(201);
    const claimId = claimRes.body.data._id;
    expect(claimRes.body.data.claimNumber).toMatch(/^CLM-\d{4}-\d{6}$/);

    // Insurance updates claim status to approved
    const updateRes = await request(app)
      .patch(`/api/insurance/claims/${claimId}/status`)
      .set('Authorization', `Bearer ${insuranceToken}`)
      .send({
        status: 'approved',
        approvedAmount: 42000,
        comment: 'Claim verified and approved for settlement.',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.status).toBe('approved');
    expect(updateRes.body.data.approvedAmount).toBe(42000);
  });
});
