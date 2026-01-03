// apps/frontend/src/services/api.js

const API_URL = import.meta.env.VITE_API_URL || '';

// Helper to handle authentication errors
function handleAuthError() {
    console.warn('Authentication failed (401/403). Redirecting to login.');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
}

/**
 * A wrapper around the native fetch API that handles:
 * 1. Automatically attaching the Bearer token.
 * 2. Redirecting to login on 401/403 errors.
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

    try {
        const response = await fetch(url, config);

        if (response.status === 401 || response.status === 403) {
            handleAuthError();
            // We return a rejected promise to stop further processing in the caller
            // (though the page will redirect shortly).
            return Promise.reject(new Error('Authentication failed'));
        }

        return response;
    } catch (error) {
        throw error;
    }
}
