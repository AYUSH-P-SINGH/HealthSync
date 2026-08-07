/**
 * Socket.IO real-time layer.
 * ──────────────────────────
 * - Handshake is authenticated with the same JWT access token the REST
 *   API uses (`auth: { token }` from the client).
 * - Each connection joins a private per-user room (`user:<id>`), so
 *   services can push events to exactly one patient / hospital /
 *   insurance organization with `emitToUser`.
 * - Emits are best-effort: if the socket layer is not initialized
 *   (e.g. in tests) they are silent no-ops, so services never crash
 *   because of a missing realtime transport.
 *
 * Event catalog (payloads are intentionally small — clients refetch
 * through the REST API, which re-applies all authorization checks):
 *   consent:request   → patient   (insurer asked for record access)
 *   consent:updated   → insurer   (patient approved/rejected/revoked)
 *   link:request      → patient   (hospital asked to link)
 *   link:updated      → hospital  (patient responded / revoked)
 *   policy:new        → patient   (policy issued)
 *   claim:new         → insurer   (patient submitted a claim)
 *   claim:updated     → either    (status/documents/appeal changed)
 *   claim:message     → either    (new message on a claim thread)
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./utils/logger');

let io = null;

const init = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL,
      credentials: true,
    },
  });

  // Authenticate every connection with the JWT access token.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      socket.user = { id: decoded.sub, role: decoded.role };
      return next();
    } catch {
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
    logger.info(`Socket connected: ${socket.user.role} ${socket.user.id}`);
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.user.role} ${socket.user.id}`);
    });
  });

  return io;
};

/**
 * Push an event to one user's private room. Safe no-op when the
 * socket server isn't running or the target id is missing.
 */
const emitToUser = (userId, event, payload = {}) => {
  if (!io || !userId) return;
  io.to(`user:${userId.toString()}`).emit(event, payload);
};

module.exports = { init, emitToUser };
