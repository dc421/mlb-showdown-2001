// src/services/socket.js
import { io } from 'socket.io-client';

// Use your Vite environment variable to connect to the right server
const URL = import.meta.env.VITE_API_URL;

export const socket = io(URL);