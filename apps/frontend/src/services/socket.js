// src/services/socket.js
import { io } from 'socket.io-client';

// Use your Vite environment variable to connect to the right server.
// Default to an empty string if undefined (allows relative path usage in production).
const URL = import.meta.env.VITE_API_URL || '';

export const socket = io(URL, {
  transports: ['websocket', 'polling'], // Prioritize websocket, fallback to polling
  reconnection: true,
  reconnectionAttempts: 20, // Try to reconnect many times before giving up
  reconnectionDelay: 1000,
});

// Add global error logging for debugging connection issues
socket.on('connect_error', (err) => {
  console.error('Socket Connection Error:', err.message);
});
