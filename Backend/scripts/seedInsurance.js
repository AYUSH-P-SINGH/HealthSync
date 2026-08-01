/**
 * Script to onboard a verified Insurance Organization.
 * Run using: node scripts/seedInsurance.js
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const Insurance = require('../src/models/Insurance');

dotenv.config({ path: path.join(__dirname, '../.env') });

const seedInsurance = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/healthsync';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const defaultCompany = {
      companyName: 'Star Health & Allied Insurance',
      email: 'starhealth@insurance.com',
      mobileNumber: '9876500001',
      password: 'SecureP@ss1!',
      registrationNumber: 'IRDAI-HLT-2026-001',
      address: {
        street: '15 Star Towers, MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
      policyTypes: ['Individual Health', 'Family Floater', 'Critical Illness', 'Senior Citizen'],
      operatingStates: ['Karnataka', 'Maharashtra', 'Delhi', 'Tamil Nadu', 'All India'],
      website: 'https://www.starhealth.in',
      isVerified: true,
    };

    const existing = await Insurance.findOne({ email: defaultCompany.email });
    if (existing) {
      console.log('Insurance organization already exists:', defaultCompany.email);
    } else {
      await Insurance.create(defaultCompany);
      console.log('✅ Default Insurance Organization created successfully!');
      console.log('   Email:', defaultCompany.email);
      console.log('   Password:', defaultCompany.password);
      console.log('   IRDAI Reg No:', defaultCompany.registrationNumber);
    }

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding insurance company:', error);
    process.exit(1);
  }
};

seedInsurance();
