/**
 * Medical record types — the single source of truth used by the
 * MedicalRecord model, validators, timeline filters and consent scopes.
 */
const RECORD_TYPES = Object.freeze([
  'visit',
  'diagnosis',
  'prescription',
  'lab_report',
  'vaccination',
  'other',
]);

/** Consent scopes = record types + 'all' (grants every type). */
const CONSENT_SCOPES = Object.freeze([...RECORD_TYPES, 'all']);

module.exports = { RECORD_TYPES, CONSENT_SCOPES };
