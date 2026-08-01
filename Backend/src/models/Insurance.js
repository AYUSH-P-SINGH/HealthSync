const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { bcryptSaltRounds, maxLoginAttempts, lockDurationMs } = require('../config/jwt.config');

const insuranceSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, 'Insurance company name is required'],
      trim: true,
      minlength: [3, 'Company name must be at least 3 characters'],
      maxlength: [200, 'Company name cannot exceed 200 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    mobileNumber: {
      type: String,
      required: [true, 'Contact mobile number is required'],
      unique: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit mobile number'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    registrationNumber: {
      // IRDAI Registration Number
      type: String,
      required: [true, 'IRDAI registration number is required'],
      unique: true,
      trim: true,
    },
    address: {
      street: { type: String, required: [true, 'Street address is required'], trim: true },
      city: { type: String, required: [true, 'City is required'], trim: true },
      state: { type: String, required: [true, 'State is required'], trim: true },
      pincode: {
        type: String,
        required: [true, 'Pincode is required'],
        match: [/^\d{6}$/, 'Please provide a valid 6-digit pincode'],
      },
      country: { type: String, default: 'India', trim: true },
    },
    policyTypes: {
      type: [String],
      default: ['Individual Health', 'Family Floater', 'Critical Illness', 'Senior Citizen'],
    },
    operatingStates: {
      type: [String],
      default: ['All India'],
    },
    website: {
      type: String,
      trim: true,
    },
    isVerified: {
      type: Boolean,
      default: true,
    },
    verificationToken: {
      type: String,
      default: null,
      select: false,
    },
    verificationExpiry: {
      type: Date,
      default: null,
      select: false,
    },

    // ─── Account Recovery ────────────────────────────
    resetPasswordToken: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordExpiry: {
      type: Date,
      default: null,
      select: false,
    },

    // ─── Account Security & Auditing ─────────────────
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    lastLoginIP: {
      type: String,
      default: null,
    },
    lastLoginDevice: {
      type: String,
      default: null,
    },

    // ─── Account Lockout ─────────────────────────────
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Hash password before saving
insuranceSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, bcryptSaltRounds);
});

// Compare candidate password with stored hash
insuranceSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Check if the account is currently locked
insuranceSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts & lock account if max reached
insuranceSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= maxLoginAttempts) {
    updates.$set = { lockUntil: new Date(Date.now() + lockDurationMs) };
  }

  return this.updateOne(updates);
};

// Reset login attempts after successful login
insuranceSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 },
  });
};

// Remove sensitive fields & expose role
insuranceSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.loginAttempts;
  delete obj.lockUntil;
  delete obj.__v;
  obj.role = 'insurance';
  return obj;
};

module.exports = mongoose.model('Insurance', insuranceSchema);
