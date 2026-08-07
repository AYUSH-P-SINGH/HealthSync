/**
 * Server entry point.
 * Loads environment, validates config, connects to DB, and starts the server.
 */
require('dotenv').config();

// Validate environment variables before anything else
const validateEnv = require('./config/env');
validateEnv();

const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start Express server (Socket.IO attaches to the same HTTP server)
    const server = app.listen(PORT, () => {
      console.log(`  HealthSync API Server`);
      console.log(`  Environment: ${process.env.NODE_ENV}`);
      console.log(`  Port:        ${PORT}`);
      console.log(`  URL:         http://localhost:${PORT}`);
      // Diagnostic: confirms which route modules THIS process actually loaded.
      console.log(`  Routes:      /api/auth, /api/patients, /api/hospitals`);
    });

    // Real-time layer (JWT-authenticated Socket.IO on the same port)
    require('./socket').init(server);

    // Follow-up clock — escalates overdue obligations and sends reminders.
    // Runs in-process; see jobs/followupScheduler.js before scaling to more
    // than one API instance.
    const followupScheduler = require('./jobs/followupScheduler');
    followupScheduler.start();

    // Fail loudly if the port is already taken by a stale process — otherwise
    // an old server keeps answering requests with outdated code.
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `\nPort ${PORT} is already in use — another (possibly stale) server is running.\n` +
            `Kill it and retry. On Windows: netstat -ano | findstr :${PORT}  then  taskkill /F /PID <pid>\n`
        );
        process.exit(1);
      }
      throw err;
    });

    // ─── Graceful Shutdown ─────────────────────────────
    const gracefulShutdown = (signal) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);
      followupScheduler.stop();
      // Tesseract runs in worker threads that would otherwise keep the
      // process alive past server.close().
      require('./services/ocr.service').shutdown().catch(() => {});
      server.close(() => {
        console.log('HTTP server closed.');
        const mongoose = require('mongoose');
        mongoose.connection.close(false).then(() => {
          console.log('MongoDB connection closed.');
          process.exit(0);
        });
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

startServer();
