const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { sendOtpEmail, sendPasswordResetEmail } = require('../services/emailService');
const { ADMIN_EMAIL } = require('../middleware/adminMiddleware');
const { protect } = require('../middleware/authMiddleware');
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const OTP_EXPIRY_MINUTES = 10;

function generateOtp() {
    return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

/**
 * @route   POST /api/auth/register-company
 */
router.post('/register-company', async (req, res, next) => {
    const { companyName, kraPin, fullName, email, password, confirmPassword } = req.body;

    if (!companyName || !fullName || !email || !password || !confirmPassword) {
        return res.status(400).json({ status: 'error', message: 'All fields are required.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ status: 'error', message: 'Enter a valid email address.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters.' });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ status: 'error', message: 'Passwords do not match.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const compResult = await client.query(
            `INSERT INTO companies (company_name, kra_pin) VALUES ($1, $2) RETURNING id, company_name`,
            [companyName, kraPin || null]
        );
        const newCompany = compResult.rows[0];

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const otpCode = generateOtp();
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);

        await client.query(
            `INSERT INTO users (company_id, full_name, email, password_hash, role, otp_code, otp_expires_at, is_verified)
             VALUES ($1, $2, $3, $4, 'Owner', $5, $6, FALSE)`,
            [newCompany.id, fullName, email, passwordHash, otpCode, otpExpiresAt]
        );

        await sendOtpEmail(email, fullName, otpCode);

        await client.query('COMMIT');
        res.status(201).json({
            status: 'success',
            message: 'Account created. Check your email for a 6-digit verification code.',
            email
        });

    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
            return res.status(400).json({ status: 'error', message: 'That email is already registered.' });
        }
        next(error);
    } finally {
        client.release();
    }
});

/**
 * @route   POST /api/auth/verify-otp
 */
router.post('/verify-otp', async (req, res, next) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ status: 'error', message: 'Email and code are required.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ status: 'error', message: 'Invalid email or code.' });
        }
        if (user.is_verified) {
            return res.status(400).json({ status: 'error', message: 'This account is already verified.' });
        }
        if (!user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
            return res.status(400).json({ status: 'error', message: 'That code has expired. Request a new one.' });
        }
        if (user.otp_code !== otp) {
            return res.status(400).json({ status: 'error', message: 'Incorrect code. Check and try again.' });
        }

        await pool.query(
            `UPDATE users SET is_verified = TRUE, otp_code = NULL, otp_expires_at = NULL WHERE id = $1`,
            [user.id]
        );

        const token = jwt.sign(
            { id: user.id, companyId: user.company_id, role: user.role, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(200).json({
            status: 'success',
            message: 'Email verified!',
            token,
            user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role, companyId: user.company_id, isAdmin: user.email === ADMIN_EMAIL }
        });

    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/auth/resend-otp
 */
router.post('/resend-otp', async (req, res, next) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ status: 'error', message: 'Email is required.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ status: 'error', message: 'No account found for that email.' });
        }
        if (user.is_verified) {
            return res.status(400).json({ status: 'error', message: 'This account is already verified.' });
        }

        const otpCode = generateOtp();
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);

        await pool.query(
            `UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3`,
            [otpCode, otpExpiresAt, user.id]
        );

        await sendOtpEmail(email, user.full_name, otpCode);

        res.status(200).json({ status: 'success', message: 'A new code has been sent.' });

    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Emails a 6-digit reset code, reusing the same otp_code /
 *          otp_expires_at columns as signup verification. Always responds
 *          with the same generic success message whether or not the email
 *          exists — so this can't be used to check which emails are
 *          registered. The email only actually gets sent if the account
 *          is real.
 */
router.post('/forgot-password', async (req, res, next) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ status: 'error', message: 'Email is required.' });
    }

    const genericResponse = () => res.status(200).json({
        status: 'success',
        message: 'If an account exists for that email, a reset code has been sent.'
    });

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return genericResponse();
        }

        const otpCode = generateOtp();
        const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);

        await pool.query(
            `UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3`,
            [otpCode, otpExpiresAt, user.id]
        );

        await sendPasswordResetEmail(email, user.full_name, otpCode);

        return genericResponse();

    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/auth/reset-password
 * @desc    Confirms the reset code and sets a new password.
 */
router.post('/reset-password', async (req, res, next) => {
    const { email, otp, newPassword, confirmNewPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmNewPassword) {
        return res.status(400).json({ status: 'error', message: 'All fields are required.' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters.' });
    }
    if (newPassword !== confirmNewPassword) {
        return res.status(400).json({ status: 'error', message: 'Passwords do not match.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ status: 'error', message: 'Invalid email or code.' });
        }
        if (!user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
            return res.status(400).json({ status: 'error', message: 'That code has expired. Request a new one.' });
        }
        if (user.otp_code !== otp) {
            return res.status(400).json({ status: 'error', message: 'Incorrect code. Check and try again.' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);

        await pool.query(
            `UPDATE users
             SET password_hash = $1, otp_code = NULL, otp_expires_at = NULL,
                 failed_login_attempts = 0, locked_until = NULL
             WHERE id = $2`,
            [passwordHash, user.id]
        );

        res.status(200).json({ status: 'success', message: 'Password updated. You can now sign in.' });

    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/auth/login
 */
router.post('/login', async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ status: 'error', message: 'Please provide both email and password.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        const genericFail = () => res.status(401).json({ status: 'error', message: 'Invalid email or password.' });

        if (!user) return genericFail();

        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            const minsLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
            return res.status(423).json({
                status: 'error',
                message: `Too many failed attempts. Try again in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}.`
            });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            const attempts = (user.failed_login_attempts || 0) + 1;
            const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60000)
                : null;

            await pool.query(
                'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
                [attempts >= MAX_FAILED_ATTEMPTS ? 0 : attempts, lockedUntil, user.id]
            );

            if (lockedUntil) {
                return res.status(423).json({
                    status: 'error',
                    message: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`
                });
            }
            return genericFail();
        }

        if (!user.is_verified) {
            return res.status(403).json({
                status: 'error',
                message: 'Please verify your email before logging in.',
                needsVerification: true,
                email: user.email
            });
        }

        if (user.failed_login_attempts > 0 || user.locked_until) {
            await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
        }

        const token = jwt.sign(
            { id: user.id, companyId: user.company_id, role: user.role, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(200).json({
            status: 'success',
            message: 'Authentication successful! Logged in.',
            token,
            user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role, companyId: user.company_id, isAdmin: user.email === ADMIN_EMAIL }
        });

    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/auth/change-password
 * @desc    Logged-in user changes their OWN password. Different from the
 *          forgot-password/OTP flow above — this is for someone who already
 *          knows their current password and just wants to update it.
 * @access  Private
 */
router.put('/change-password', protect, async (req, res, next) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ status: 'error', message: 'Current and new password are both required.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters.' });
    }

    try {
        const result = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
        const user = result.rows[0];
        if (!user) return res.status(404).json({ status: 'error', message: 'Account not found.' });

        const matches = await bcrypt.compare(currentPassword, user.password_hash);
        if (!matches) {
            return res.status(400).json({ status: 'error', message: 'Current password is incorrect.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, req.user.id]);

        res.status(200).json({ status: 'success', message: 'Password changed.' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;