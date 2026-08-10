const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let transporter = null;

// Initialize Nodemailer transporter if config is present
if (
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Whether real SMTP credentials are configured.
 * When false, the app runs in "dev mode": emails are logged to the console
 * and email verification is bypassed (accounts are auto-verified).
 */
const isEmailConfigured = () => transporter !== null;

/**
 * Sends email. Falls back to console log if SMTP is not configured.
 */
const sendEmail = async ({ to, subject, text, html }) => {
  if (process.env.NODE_ENV === 'test') return true;

  const from = process.env.SMTP_FROM || 'HealthSync <no-reply@healthsync.com>';

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
      });
      logger.info(`Email sent successfully: ${info.messageId}`, { to, subject });
      return true;
    } catch (error) {
      logger.error(`Error sending email to ${to}: ${error.message}`);
      return false;
    }
  } else {
    // Development fallback
    logger.warn('SMTP credentials not configured. Logging email below:', { to, subject });
    console.log('\n╔═══════════════════ OUTGOING EMAIL ═══════════════════╗');
    console.log(`║ TO:      ${to}`);
    console.log(`║ SUBJECT: ${subject}`);
    console.log(`║ TEXT:    ${text}`);
    console.log('╚══════════════════════════════════════════════════════╝\n');
    return true;
  }
};

/**
 * Send account verification email.
 */
const sendVerificationEmail = async (email, token) => {
  const verificationLink = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
  const subject = 'Verify your HealthSync Account';
  const text = `Welcome to HealthSync! Please verify your email by clicking the link: ${verificationLink}`;
  const html = `
    <h3>Welcome to HealthSync</h3>
    <p>Please verify your email address to complete registration:</p>
    <a href="${verificationLink}" target="_blank">${verificationLink}</a>
  `;
  return sendEmail({ to: email, subject, text, html });
};

/**
 * Send password reset email.
 */
const sendPasswordResetEmail = async (email, token) => {
  const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
  const subject = 'Reset your HealthSync Password';
  const text = `You requested a password reset. Please click the link to reset your password: ${resetLink}`;
  const html = `
    <h3>Reset your HealthSync Password</h3>
    <p>Please click the link below to reset your password. This link is valid for 1 hour:</p>
    <a href="${resetLink}" target="_blank">${resetLink}</a>
  `;
  return sendEmail({ to: email, subject, text, html });
};

/**
 * Send a claim-related notification (status change, new message,
 * document request/fulfilment, appeal). Fire-and-forget by callers.
 */
const sendClaimNotificationEmail = async ({ to, claimNumber, title, detail }) => {
  const claimsLink = `${process.env.CLIENT_URL}/dashboard`;
  const subject = `[HealthSync] ${title} — Claim ${claimNumber}`;
  const text = `${title} on claim ${claimNumber}. ${detail} View the claim in your HealthSync dashboard: ${claimsLink}`;
  const html = `
    <h3>${title}</h3>
    <p><strong>Claim:</strong> ${claimNumber}</p>
    <p>${detail}</p>
    <p><a href="${claimsLink}" target="_blank">Open your HealthSync dashboard</a> to view the claim and respond.</p>
  `;
  return sendEmail({ to, subject, text, html });
};

module.exports = {
  isEmailConfigured,
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendClaimNotificationEmail,
};
