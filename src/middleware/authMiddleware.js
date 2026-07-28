const jwt = require('jsonwebtoken');

/**
 * Authentication Middleware Bouncer.
 * Blocks unauthenticated traffic, verifies JWT tokens, and appends the 
 * secure user session metrics (userId, companyId, role) directly to the request object.
 */
function protect(req, res, next) {
    let token;

    // Check if token arrives in the standard HTTP Authorization header format
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Extract the raw token string past the 'Bearer ' title
            token = req.headers.authorization.split(' ')[1];

            // Verify token signature against your secret environment string
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Secure Injection: Attach the authorized user details to the request
            req.user = {
                id: decoded.id,
                companyId: decoded.companyId,
                role: decoded.role,
                email: decoded.email
            };

            return next(); // Pass the verified user through to the API route controller safely!

        } catch (error) {
            return res.status(401).json({
                status: 'error',
                message: 'Not authorized: Access token verification failed or expired.'
            });
        }
    }

    if (!token) {
        return res.status(401).json({
            status: 'error',
            message: 'Access denied: No token bearer provided in authentication headers.'
        });
    }
}

module.exports = { protect };