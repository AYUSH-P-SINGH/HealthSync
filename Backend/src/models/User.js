const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { bcryptSaltRounds, maxLoginAttempts, lockDurationMs } = require('../config/jwt.config');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true,
        minlength: [2, 'First name must be at least 2 characters'],
        maxlength: [100, 'First name cannot exceed 100 characters'],
      },
      lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true,
        minlength: [2, 'Last name must be at least 2 characters'],
        maxlength: [100, 'Last name cannot exceed 100 characters'],
      },
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
      required: [true, 'Mobile number is required'],
      unique: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit mobile number'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Never returned in queries by default
    },
    role: {
      type: String,
      enum: ['user'],
      default: 'user',
    },
    healthSyncId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    // ─── Patient Profile Fields ─────────────────────
    dob: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      default: null,
    },
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
      default: null,
    },
    address: {
      street: { type: String, trim: true, default: null },
      city: { type: String, trim: true, default: null },
      state: { type: String, trim: true, default: null },
      pincode: {
        type: String,
        match: [/^\d{6}$/, 'Please provide a valid 6-digit pincode'],
        default: null,
      },
      country: { type: String, trim: true, default: 'India' },
    },
    emergencyContact: {
      name: { type: String, trim: true, default: null },
      relation: { type: String, trim: true, default: null },
      phone: {
        type: String,
        trim: true,
        match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit mobile number'],
        default: null,
      },
    },
    profilePicture: {
      type: String,
      default: null,
    },

    // ─── Clinical Safety Profile ─────────────────────
    // Known drug/substance allergies — powers automatic allergy alerts
    // whenever a new prescription is recorded.
    allergies: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    // Ongoing conditions (e.g. "Type 2 Diabetes") — shown on the timeline
    // and shared with hospitals through consented access.
    chronicConditions: {
      type: [{ type: String, trim: true, maxlength: 200 }],
      default: [],
    },

    // ─── Email Verification ──────────────────────────
    isVerified: {
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
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ─── Virtuals ──────────────────────────────────────────

/**
 * Computed age from DOB. Returns null if DOB is not set.
 */
userSchema.virtual('age').get(function () {
  if (!this.dob) return null;
  const today = new Date();
  const birth = new Date(this.dob);
  let years = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    years--;
  }
  return years;
});

/**
 * Formatted patient ID: HS-XXXXXXXX (first 8 hex chars of _id).
 */
userSchema.virtual('patientId').get(function () {
  if (this.healthSyncId) return this.healthSyncId;
  if (!this._id) return null;
  return `HS-${this._id.toString().slice(0, 8).toUpperCase()}`;
});

// ─── Pre-save Hook: Hash Password & HealthSync ID ──────
// Mongoose 9 no longer passes a `next` callback to pre-hooks; use an async function instead.
userSchema.pre('save', async function () {
  if (!this.healthSyncId && this._id) {
    this.healthSyncId = `HS-${this._id.toString().slice(0, 8).toUpperCase()}`;
  }
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, bcryptSaltRounds);
});

// ─── Instance Methods ──────────────────────────────────

/**
 * Compare a candidate password with the stored hash.
 */
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Check if the account is currently locked.
 */
userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

/*
 Increment login attempts. Lock account after max attempts.
*/
userSchema.methods.incrementLoginAttempts = async function () {
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
userSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 },
  });
};

/**
 * Remove sensitive fields when converting to JSON.
 */
userSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  delete obj.loginAttempts;
  delete obj.lockUntil;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);

