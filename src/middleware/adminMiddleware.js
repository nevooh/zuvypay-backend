// Single source of truth for who counts as admin — bankRoutes.js and
// adminRoutes.js both import this, instead of each keeping their own copy
// of ADMIN_EMAIL that could quietly drift out of sync.
//
// TODO: replace with your real admin email.
const ADMIN_EMAIL = 'calebongaga290@gmail.com';

function adminOnly(req, res, next) {
    if (req.user.email !== ADMIN_EMAIL) {
        return res.status(403).json({ status: 'error', message: 'Admin access only.' });
    }
    next();
}

module.exports = { adminOnly, ADMIN_EMAIL };