const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { sendNewAccountEmail } = require('../services/emailService');

function ownerOnly(req, res, next) {
    if (req.user.role !== 'Owner') {
        return res.status(403).json({ status: 'error', message: 'Only the account admin can do this.' });
    }
    next();
}

/**
 * @route   GET /api/companies/me
 */
router.get('/me', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, company_name, kra_pin, nssf_number, sha_number, selected_bank,
                    bank_branch_code, bank_account_number, created_at
             FROM companies WHERE id = $1`,
            [req.user.companyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Company not found.' });
        }

        res.status(200).json({ status: 'success', company: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/companies/me
 */
router.put('/me', protect, async (req, res, next) => {
    const { companyName, kraPin, nssfNumber, shaNumber, selectedBank, bankBranchCode, bankAccountNumber } = req.body;

    if (!companyName) {
        return res.status(400).json({ status: 'error', message: 'Business name is required.' });
    }

    try {
        const result = await pool.query(
            `UPDATE companies
             SET company_name = $1, kra_pin = $2, nssf_number = $3, sha_number = $4,
                 selected_bank = $5, bank_branch_code = $6, bank_account_number = $7
             WHERE id = $8
             RETURNING id, company_name, kra_pin, nssf_number, sha_number, selected_bank, bank_branch_code, bank_account_number`,
            [companyName, kraPin || null, nssfNumber || null, shaNumber || null,
             selectedBank || null, bankBranchCode || null, bankAccountNumber || null, req.user.companyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Company not found.' });
        }

        res.status(200).json({ status: 'success', message: 'Company details saved.', company: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/companies/users
 * @desc    Every login account under this company. Anyone logged in can see
 *          this list — the only owner-exclusive powers are adding and
 *          removing accounts below, everything else is equal access.
 * @access  Private
 */
router.get('/users', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, full_name, email, role, created_at FROM users WHERE company_id = $1 ORDER BY created_at ASC`,
            [req.user.companyId]
        );
        res.status(200).json({ status: 'success', users: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/companies/users
 * @desc    OWNER-ONLY. Adds another login for this same company — a
 *          colleague who needs to run payroll too. No separate email
 *          verification loop: the owner is directly vouching for them, so
 *          the account is created already verified and ready to log in.
 * @access  Private (owner only)
 */
router.post('/users', protect, ownerOnly, async (req, res, next) => {
    const { fullName, email } = req.body;
    if (!fullName || !email) {
        return res.status(400).json({ status: 'error', message: 'Full name and email are both required.' });
    }

    try {
        // 6-digit numeric PIN — crypto.randomInt, not Math.random, since this
        // is a real login credential, not just a display value.
        const loginPin = String(crypto.randomInt(100000, 1000000));
        const passwordHash = await bcrypt.hash(loginPin, 10);

        const result = await pool.query(
            `INSERT INTO users (company_id, full_name, email, password_hash, role, is_verified)
             VALUES ($1, $2, $3, $4, 'Staff', TRUE)
             RETURNING id, full_name, email, role, created_at`,
            [req.user.companyId, fullName, email, passwordHash]
        );

        const companyResult = await pool.query(`SELECT company_name FROM companies WHERE id = $1`, [req.user.companyId]);
        const companyName = companyResult.rows[0]?.company_name || 'your company';

        let emailSent = true;
        try {
            await sendNewAccountEmail(email, fullName, companyName, loginPin);
        } catch (emailError) {
            emailSent = false; // don't fail the whole request over a flaky email send — show the PIN instead as a fallback
        }

        res.status(201).json({
            status: 'success',
            message: emailSent
                ? 'Account added — a login PIN was emailed to them.'
                : `Account added, but the email couldn't be sent. Their login PIN is ${loginPin} — share it with them directly.`,
            user: result.rows[0],
            loginPin, // shown once in the success confirmation as a safety net either way
            emailSent
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ status: 'error', message: 'An account with this email already exists.' });
        }
        next(error);
    }
});

/**
 * @route   DELETE /api/companies/users/:id
 * @desc    OWNER-ONLY. Removes a colleague's login. Can't remove your own
 *          account this way (avoids a company accidentally locking itself
 *          out). Past payroll actions they took stay in History exactly as
 *          they were — payroll_periods.confirmed_by/paid_by reference this
 *          table with ON DELETE SET NULL, so nothing breaks, the "who did
 *          this" name just can't be shown anymore for their old actions.
 * @access  Private (owner only)
 */
router.delete('/users/:id', protect, ownerOnly, async (req, res, next) => {
    if (Number(req.params.id) === req.user.id) {
        return res.status(400).json({ status: 'error', message: "You can't remove your own account." });
    }
    try {
        const result = await pool.query(
            `DELETE FROM users WHERE id = $1 AND company_id = $2 RETURNING id`,
            [req.params.id, req.user.companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Account not found.' });
        }
        res.status(200).json({ status: 'success', message: 'Account removed.' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;