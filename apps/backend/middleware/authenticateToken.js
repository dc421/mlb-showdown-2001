const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401); // if there isn't any token

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            // Check specifically for TokenExpiredError
            if (err.name === 'TokenExpiredError') {
                // Return 401 Unauthorized for expired tokens (client should re-login)
                // We do NOT log this as an error, as it is a normal occurrence.
                return res.sendStatus(401);
            }

            // For other errors (invalid signature, malformed), log it and return 403
            console.error('--- MIDDLEWARE ERROR: JWT verification failed ---', err);
            return res.sendStatus(403);
        }
        req.user = user;
        next(); // proceed to the endpoint
    });
}

module.exports = authenticateToken;