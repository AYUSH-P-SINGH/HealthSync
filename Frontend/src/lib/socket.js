import { io } from "socket.io-client";
import { API_ORIGIN } from "./api.js";

/**
 * Single shared Socket.IO connection for the whole app.
 * AuthContext calls connectSocket()/disconnectSocket() as the session
 * changes; pages/components just subscribe with `onSocketEvent`.
 */
let socket = null;

export function connectSocket(accessToken) {
  if (!accessToken) return null;

  // Already connected with the same token — reuse it.
  if (socket && socket.connected && socket.auth?.token === accessToken) {
    return socket;
  }

  if (socket) {
    socket.disconnect();
  }

  socket = io(API_ORIGIN, {
    auth: { token: accessToken },
    withCredentials: true,
    transports: ["websocket", "polling"],
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}

/**
 * Subscribe to a socket event for the lifetime of a component.
 * Usage inside a useEffect:
 *   useEffect(() => onSocketEvent("claim:updated", handler), [handler]);
 * Returns an unsubscribe function, so it can be returned directly as a
 * useEffect cleanup.
 */
export function onSocketEvent(event, handler) {
  if (!socket) return () => {};
  socket.on(event, handler);
  return () => {
    socket?.off(event, handler);
  };
}
