process.env.NODE_ENV = 'test';
require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = require('../src/app');
const User = require('../src/models/User');
const Hospital = require('../src/models/Hospital');
const RefreshToken = require('../src/models/RefreshToken');
const AuditLog = require('../src/models/AuditLog');
const emailService = require('../src/services/email.service');

// Spy on email service to intercept raw tokens for verification/resets
jest.spyOn(emailService, 'sendVerificationEmail').mockImplementation(() => Promise.resolve(true));
jest.spyOn(emailService, 'sendPasswordResetEmail').mockImplementation(() => Promise.resolve(true));

const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/healthsync_test';

const testUser = {
  firstName: 'Ayush',
  lastName: 'Sharma',
  email: 'ayush@example.com',
  mobileNumber: '9876543210',
  password: 'Password123!',
};

const testHospital = {
  name: 'City General Hospital',
  email: 'citygeneral@example.com',
  mobileNumber: '9988776655',
  password: 'Password123!',
  registrationNumber: 'HOSP-12345',
  hospitalType: 'private',
  street: '123 Main St',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
};

describe('Authentication & Security Integration Tests', () => {
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
    await Hospital.deleteMany({});
    await RefreshToken.deleteMany({});
    await AuditLog.deleteMany({});
  });

  // ─── 1. Registration & Email Verification ───────────
  describe('User Registration & Email Verification', () => {
    it('should register a new user with status unverified and generate audit log', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(testUser);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isVerified).toBe(false);

      // Verify email service was called
      expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        testUser.email,
        expect.any(String)
      );

      // Verify user exists in database
      const dbUser = await User.findOne({ email: testUser.email });
      expect(dbUser).toBeDefined();
      expect(dbUser.isVerified).toBe(false);

      // Verify audit log
      const audit = await AuditLog.findOne({ userId: dbUser._id, action: 'REGISTER' });
      expect(audit).toBeDefined();
      expect(audit.success).toBe(true);
    });

    it('should reject registration with weak or common passwords', async () => {
      const weakUser = { ...testUser, password: 'password123' }; // Common/blacklist
      const res = await request(app)
        .post('/api/auth/register')
        .send(weakUser);

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('should verify email with valid token and allow login', async () => {
      // 1. Register user
      await request(app).post('/api/auth/register').send(testUser);
      const rawToken = emailService.sendVerificationEmail.mock.calls[0][1];

      // 2. Try logging in before verification (should fail)
      const failLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      expect(failLogin.statusCode).toBe(403);
      expect(failLogin.body.message).toContain('verify your email');

      // 3. Verify email
      const verifyRes = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: rawToken });
      expect(verifyRes.statusCode).toBe(200);

      // 4. Log in after verification (should succeed)
      const successLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      expect(successLogin.statusCode).toBe(200);
      expect(successLogin.body.data.accessToken).toBeDefined();
      expect(successLogin.headers['set-cookie']).toBeDefined();
    });

    it('should fail verification with invalid token', async () => {
      await request(app).post('/api/auth/register').send(testUser);
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'invalid_token_value' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── 2. Login, Lockout, and Auditing ────────────────
  describe('Login & Account Lockout', () => {
    it('should lock user out after 5 failed login attempts', async () => {
      await request(app).post('/api/auth/register').send(testUser);
      const rawToken = emailService.sendVerificationEmail.mock.calls[0][1];
      await request(app).post('/api/auth/verify-email').send({ token: rawToken });

      // Perform 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        const failRes = await request(app)
          .post('/api/auth/login')
          .send({ email: testUser.email, password: 'WrongPassword1!' });
        expect(failRes.statusCode).toBe(401);
      }

      // 6th attempt should be locked out
      const lockedRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      expect(lockedRes.statusCode).toBe(403);
      expect(lockedRes.body.message).toContain('locked');

      // Verify account lockout audit log exists
      const dbUser = await User.findOne({ email: testUser.email });
      const lockoutAudit = await AuditLog.findOne({ userId: dbUser._id, action: 'ACCOUNT_LOCKED' });
      expect(lockoutAudit).toBeDefined();
    }, 15_000);

    it('should reset login attempts after successful login', async () => {
      await request(app).post('/api/auth/register').send(testUser);
      const rawToken = emailService.sendVerificationEmail.mock.calls[0][1];
      await request(app).post('/api/auth/verify-email').send({ token: rawToken });

      // 2 failed attempts
      await request(app).post('/api/auth/login').send({ email: testUser.email, password: 'wrong' });
      await request(app).post('/api/auth/login').send({ email: testUser.email, password: 'wrong' });

      // Successful login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      expect(loginRes.statusCode).toBe(200);

      // Verify attempts reset to 0 in database
      const dbUser = await User.findOne({ email: testUser.email }).select('+loginAttempts');
      expect(dbUser.loginAttempts).toBe(0);
    });
  });

  // ─── 3. Session Management & Token Rotation ─────────
  describe('Session Management & Refresh Token Rotation', () => {
    let accessToken;
    let cookie;

    beforeEach(async () => {
      await User.deleteMany({});
      jest.clearAllMocks();
      const regRes = await request(app).post('/api/auth/register').send(testUser);
      const userId = regRes.body.data._id;
      await User.findByIdAndUpdate(userId, { isVerified: true });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      
      accessToken = loginRes.body.data.accessToken;
      cookie = loginRes.headers['set-cookie'][0];
    });

    it('should refresh access token and rotate refresh token cookie', async () => {
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [cookie]);

      expect(refreshRes.statusCode).toBe(200);
      expect(refreshRes.body.data.accessToken).toBeDefined();
      expect(refreshRes.headers['set-cookie']).toBeDefined();
      
      const newCookie = refreshRes.headers['set-cookie'][0];
      expect(newCookie).not.toBe(cookie); // Rotation validation
    });

    it('should detect refresh token reuse and revoke all tokens in family', async () => {
      // 1. First refresh (rotates token)
      const firstRefresh = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [cookie]);
      
      expect(firstRefresh.statusCode).toBe(200);

      // 2. Second refresh using the *same* old cookie (reuse attempt!)
      const reuseRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [cookie]);

      expect(reuseRes.statusCode).toBe(401);
      expect(reuseRes.body.message).toContain('Suspicious activity');

      // Verify refresh tokens are marked as revoked in the database (no active tokens, 2 revoked)
      const activeCount = await RefreshToken.countDocuments({ isRevoked: false });
      expect(activeCount).toBe(0);

      const revokedCount = await RefreshToken.countDocuments({ isRevoked: true });
      expect(revokedCount).toBe(2);
    });

    it('should logout and clear cookies', async () => {
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(logoutRes.statusCode).toBe(200);
      expect(logoutRes.headers['set-cookie'][0]).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);

      const count = await RefreshToken.countDocuments({});
      expect(count).toBe(0);
    });

    it('should logout from all devices and clear all sessions', async () => {
      // Create another session by logging in again
      await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });

      // Total tokens should be 2 (one from login in beforeEach, one from the second login)
      const totalCount = await RefreshToken.countDocuments({});
      expect(totalCount).toBe(2);

      const logoutAllRes = await request(app)
        .post('/api/auth/logout/all')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(logoutAllRes.statusCode).toBe(200);

      // Verify all tokens deleted
      const postCount = await RefreshToken.countDocuments({});
      expect(postCount).toBe(0);
    });
  });

  // ─── 4. Account Recovery ────────────────────────────
  describe('Account Recovery', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(testUser);
      const rawToken = emailService.sendVerificationEmail.mock.calls[0][1];
      await request(app).post('/api/auth/verify-email').send({ token: rawToken });
    });

    it('should generate reset password token, send link, and reset password successfully', async () => {
      // 1. Request forgot password
      const forgotRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: testUser.email });
      
      expect(forgotRes.statusCode).toBe(200);
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      
      const rawResetToken = emailService.sendPasswordResetEmail.mock.calls[0][1];

      // 2. Reset password
      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: rawResetToken, password: 'NewPassword123!' });
      
      expect(resetRes.statusCode).toBe(200);

      // 3. Try login with old password (should fail)
      const oldLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      expect(oldLogin.statusCode).toBe(401);

      // 4. Login with new password (should succeed)
      const newLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: 'NewPassword123!' });
      expect(newLogin.statusCode).toBe(200);
    });

    it('should change password for authenticated user and revoke other sessions', async () => {
      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      const token = loginRes.body.data.accessToken;

      // Change password
      const changeRes = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: testUser.password, newPassword: 'NewPassword123!' });
      
      expect(changeRes.statusCode).toBe(200);

      // Verify sessions are deleted
      const tokenCount = await RefreshToken.countDocuments({});
      expect(tokenCount).toBe(0);
    });
  });

  // ─── 5. Additional Edge Cases & Security Behaviors ───
  describe('Additional Edge Cases & Security Behaviors', () => {
    let activeUser, activeAccessToken, activeRefreshToken;

    beforeEach(async () => {
      // Create and verify user
      await request(app).post('/api/auth/register').send(testUser);
      const rawToken = emailService.sendVerificationEmail.mock.calls[0][1];
      await request(app).post('/api/auth/verify-email').send({ token: rawToken });

      // Login to get tokens
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password });
      
      activeUser = loginRes.body.data.user;
      activeAccessToken = loginRes.body.data.accessToken;
      activeRefreshToken = loginRes.headers['set-cookie'][0].split(';')[0].split('=')[1];
    });

    it('should reject expired access token', async () => {
      // Generate expired access token manually
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { sub: activeUser._id, role: 'user', type: 'access' },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: '-1s' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);
      
      expect(res.statusCode).toBe(401);
      expect(res.body.message).toContain('expired');
    });

    it('should reject invalid JWT signature', async () => {
      const badSignatureToken = activeAccessToken + 'invalid';
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${badSignatureToken}`);
      
      expect(res.statusCode).toBe(401);
      expect(res.body.message).toContain('Invalid or expired token');
    });

    it('should reject expired refresh token', async () => {
      // Simulate expired refresh token in DB
      await RefreshToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${activeRefreshToken}`);
      
      expect(res.statusCode).toBe(401);
      expect(res.body.message).toContain('expired');
    });

    it('should reject invalid verification token', async () => {
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'invalid_verification_token' });
      
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('Invalid or expired');
    });

    it('should reject invalid reset password token', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'invalid_reset_token', password: 'NewPassword123!' });
      
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('Invalid or expired');
    });

    it('should fail to refresh after logout', async () => {
      // Logout
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${activeAccessToken}`)
        .set('Cookie', `refreshToken=${activeRefreshToken}`);

      // Try refresh
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${activeRefreshToken}`);
      
      expect(res.statusCode).toBe(401);
    });

    it('should fail to refresh after password change', async () => {
      // Change password
      await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${activeAccessToken}`)
        .send({ currentPassword: testUser.password, newPassword: 'NewPassword123!' });

      // Try refresh
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${activeRefreshToken}`);
      
      expect(res.statusCode).toBe(401);
    });

    it('should fail to refresh after logout all devices', async () => {
      // Logout all devices
      await request(app)
        .post('/api/auth/logout/all')
        .set('Authorization', `Bearer ${activeAccessToken}`);

      // Try refresh
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${activeRefreshToken}`);
      
      expect(res.statusCode).toBe(401);
    });

    it('should enforce rate limiting behavior in production mode', async () => {
      // Temporarily set NODE_ENV to production to test rate limiting
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        // Trigger forgot-password rate limiter (max 3 per hour)
        // Make 4 requests
        await request(app).post('/api/auth/forgot-password').send({ email: testUser.email });
        await request(app).post('/api/auth/forgot-password').send({ email: testUser.email });
        await request(app).post('/api/auth/forgot-password').send({ email: testUser.email });
        const res = await request(app).post('/api/auth/forgot-password').send({ email: testUser.email });

        expect(res.statusCode).toBe(429);
      } finally {
        // Restore original env
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
