const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { bcryptSaltRounds } = require('../config/jwt.config');

const hospitalSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Hospital name is required'],
      trim: true,
      minlength: [3, 'Hospital name must be at least 3 characters'],
      maxlength: [200, 'Hospital name cannot exceed 200 characters'],
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
      required: [true, 'Contact number is required'],
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
      // Government/medical council registration number
      type: String,
      required: [true, 'Hospital registration number is required'],
      unique: true,
      trim: true,
    },
    hospitalType: {
      type: String,
      enum: ['government', 'private', 'trust', 'clinic', 'multi-speciality'],
      required: [true, 'Hospital type is required'],
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
    specialities: {
      // e.g. ["Cardiology", "Orthopedics", "Neurology"]
      type: [String],
      default: [],
    },
    totalBeds: {
      type: Number,
      min: [0, 'Total beds cannot be negative'],
      default: 0,
    },
    emergencyAvailable: {
      type: Boolean,
      default: false,
    },
    website: {
      type: String,
      trim: true,
    },
    isVerified: {
      // set true by admin after verifying registration details
      type: Boolean,
      default: false,
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
// Mongoose 9 no longer passes a `next` callback to pre-hooks; use an async function instead.
hospitalSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, bcryptSaltRounds);
});

// Compare candidate password with stored hash
hospitalSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Check if the account is currently locked.
 */
hospitalSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

/**
 * Increment login attempts. Lock account after max attempts.
 */
hospitalSchema.methods.incrementLoginAttempts = async function () {
  const { maxLoginAttempts, lockDurationMs } = require('../config/jwt.config');
  // If previous lock has expired, reset attempts
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Lock account if we've reached max attempts
  if (this.loginAttempts + 1 >= maxLoginAttempts) {
    updates.$set = { lockUntil: new Date(Date.now() + lockDurationMs) };
  }

  return this.updateOne(updates);
};

/**
 * Reset login attempts after successful login.
 */
hospitalSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 },
  });
};

// Remove sensitive fields when converting to JSON (mirrors User.js)
hospitalSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.loginAttempts;
  delete obj.lockUntil;
  delete obj.__v;
  // Hospitals live in their own collection and have no stored role field, but
  // API consumers (login, /auth/me) rely on `role` to route the account to the
  // right dashboard — expose it explicitly like User.js and Admin.js do.
  obj.role = 'hospital';
  return obj;
};

module.exports = mongoose.model('Hospital', hospitalSchema);
