process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const app = require('../src/app');
const User = require('../src/models/User');
const RefreshToken = require('../src/models/RefreshToken');
const AuditLog = require('../src/models/AuditLog');
const emailService = require('../src/services/email.service');

// Spy on email service
jest.spyOn(emailService, 'sendVerificationEmail').mockImplementation(() => Promise.resolve(true));

const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/healthsync_test';

const patientUser = {
  firstName: 'Ayush',
  lastName: 'Singh',
  email: 'patient@example.com',
  mobileNumber: '9876543210',
  password: 'Password123!',
};

describe('Patient / User Dashboard API Integration Tests', () => {
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

  describe('GET /api/patients/profile', () => {
    it('should fetch patient profile with virtual age and patientId', async () => {
      const res = await request(app)
        .get('/api/patients/profile')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(patientUser.email);
      expect(res.body.data.patientId).toBeDefined();
      expect(res.body.data.patientId).toMatch(/^HS-[A-F0-9]{8}$/);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/patients/profile');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/patients/profile', () => {
    it('should update patient profile fields successfully', async () => {
      const updateData = {
        dob: '1995-05-15',
        gender: 'male',
        bloodGroup: 'O+',
        address: {
          street: '45 Healthcare Ave',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          country: 'India',
        },
        emergencyContact: {
          name: 'Parent Name',
          relation: 'Parent',
          phone: '9876543211',
        },
      };

      const res = await request(app)
        .patch('/api/patients/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.gender).toBe('male');
      expect(res.body.data.bloodGroup).toBe('O+');
      expect(res.body.data.age).toBeDefined();
      expect(res.body.data.address.city).toBe('Mumbai');

      // Check audit log
      const audit = await AuditLog.findOne({ userId, action: 'PROFILE_UPDATED' });
      expect(audit).toBeDefined();
    });

    it('should reject update with invalid blood group or future DOB', async () => {
      const invalidData = {
        bloodGroup: 'INVALID',
        dob: '2099-01-01',
      };

      const res = await request(app)
        .patch('/api/patients/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(invalidData);

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/patients/dashboard', () => {
    it('should return dashboard summary with completeness percentage', async () => {
      const res = await request(app)
        .get('/api/patients/dashboard')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dashboard.profileCompleteness).toBeDefined();
      expect(typeof res.body.data.dashboard.profileCompleteness).toBe('number');
    });
  });

  describe('Profile Picture Upload & Delete', () => {
    const testImagePath = path.join(__dirname, 'test_avatar.png');

    beforeAll(() => {
      // Create a dummy image file for testing
      fs.writeFileSync(testImagePath, 'dummy image content');
    });

    afterAll(() => {
      if (fs.existsSync(testImagePath)) {
        fs.unlinkSync(testImagePath);
      }
    });

    it('should upload profile picture successfully', async () => {
      const res = await request(app)
        .post('/api/patients/profile/picture')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('profilePicture', testImagePath);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profilePicture).toBeDefined();

      // Verify audit log
      const audit = await AuditLog.findOne({ userId, action: 'PROFILE_PICTURE_UPLOADED' });
      expect(audit).toBeDefined();

      // Clean up uploaded file
      const uploadedFilePath = path.resolve(res.body.data.profilePicture);
      if (fs.existsSync(uploadedFilePath)) {
        fs.unlinkSync(uploadedFilePath);
      }
    });

    it('should delete profile picture successfully', async () => {
      // First upload a picture
      const uploadRes = await request(app)
        .post('/api/patients/profile/picture')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('profilePicture', testImagePath);

      const uploadedFilePath = path.resolve(uploadRes.body.data.profilePicture);

      // Now delete it
      const deleteRes = await request(app)
        .delete('/api/patients/profile/picture')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.data.profilePicture).toBeNull();
      expect(fs.existsSync(uploadedFilePath)).toBe(false);

      // Audit log check
      const audit = await AuditLog.findOne({ userId, action: 'PROFILE_PICTURE_DELETED' });
      expect(audit).toBeDefined();
    });
  });
});
