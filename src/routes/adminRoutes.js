const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');

/**
 * @route   GET /api/admin/companies-overview
 * @desc    ADMIN-ONLY. Every company that's ever signed up, with their
 *          owner's contact, current employee count, and payment history —
 *          a plain read, nothing here writes to the database. Answers
 *          "who's signed up" and "who's actually paid" in one screen.
 * @access  Private (admin only)
 */
router.get('/companies-overview', protect, adminOnly, async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT
                c.id,
                c.company_name,
                c.created_at,
                u.full_name AS owner_name,
                u.email AS owner_email,
                (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id) AS employee_count,
                (SELECT COALESCE(SUM(p.amount_due), 0) FROM payroll_periods p
                    WHERE p.company_id = c.id AND p.status = 'PAID') AS total_paid,
                (SELECT MAX(p.paid_at) FROM payroll_periods p
                    WHERE p.company_id = c.id AND p.status = 'PAID') AS last_paid_at
            FROM companies c
            LEFT JOIN users u ON u.company_id = c.id AND u.role = 'Owner'
            ORDER BY c.created_at DESC;
        `);
        res.status(200).json({ status: 'success', companies: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/admin/companies/:companyId/payments
 * @desc    ADMIN-ONLY. Every payroll period this specific company has ever
 *          touched — PAID, PENDING, or EXPIRED — newest first. Backs the
 *          click-to-expand row on the Companies page: "total paid" alone
 *          hides which months actually went through, and can't show a
 *          company that's been stuck on PENDING for weeks.
 * @access  Private (admin only)
 */
router.get('/companies/:companyId/payments', protect, adminOnly, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, payroll_month, payroll_year, status, is_correction, correction_of,
                    amount_due, employee_count, confirmed_at, paid_at, intasend_invoice_id
             FROM payroll_periods
             WHERE company_id = $1
             ORDER BY created_at DESC`,
            [req.params.companyId]
        );
        res.status(200).json({ status: 'success', periods: result.rows });
    } catch (error) {
        next(error);
    }
});

module.exports = router;