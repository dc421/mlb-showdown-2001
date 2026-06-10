// apps/frontend/src/services/api.js
import { ref } from 'vue';

const API_URL = import.meta.env.VITE_API_URL || '';

// Reactive flag set when a 401 is received. Components watch this to show
// an inline re-login prompt instead of navigating away mid-session.
export const sessionExpiredFlag = ref(false);

function handleAuthError() {
    console.warn('Authentication failed (401). Session expired.');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionExpiredFlag.value = true;
}

/**
 * A wrapper around the native fetch API that handles:
 * 1. Automatically attaching the Bearer token.
 * 2. Redirecting to login on 401 errors.
 *
 * @param {string} endpoint - The API endpoint (e.g., '/api/games').
 * @param {Object} [options={}] - Fetch options.
 * @returns {Promise<Response>}
 */
export async function apiClient(endpoint, options = {}) {
    const token = localStorage.getItem('token');

    // Ensure headers exist
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        ...options,
        headers,
    };

    // Construct full URL if endpoint is relative
    const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;

    // Don't make further calls while session recovery is pending.
    if (sessionExpiredFlag.value) {
        return Promise.reject(new Error('Session expired'));
    }

    try {
        const response = await fetch(url, config);

        if (response.status === 401) {
            handleAuthError();
            return Promise.reject(new Error('Authentication failed'));
        }

        return response;
    } catch (error) {
        throw error;
    }
}
