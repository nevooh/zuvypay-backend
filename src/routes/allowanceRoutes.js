const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');

const VALID_CATEGORIES = ['ALLOWANCE', 'DEDUCTION'];

/* ======================================================================
   PAYMENT TYPES — company-wide, set up once, reused across employees.
   ====================================================================== */

/**
 * @route   GET /api/allowances/payment-types
 * @desc    Lists this company's payment types, with how many employees
 *          currently have each one attached (drives the "4 employees" note
 *          in the UI, and tells the frontend whether delete is safe).
 * @access  Private
 */
router.get('/payment-types', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT t.*, COUNT(r.id)::int AS employee_count
             FROM company_payment_types t
             LEFT JOIN employee_recurring_payments r ON r.payment_type_id = t.id
             WHERE t.company_id = $1
             GROUP BY t.id
             ORDER BY t.created_at ASC`,
            [req.user.companyId]
        );
        res.status(200).json({ status: 'success', paymentTypes: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/allowances/payment-types
 * @desc    Creates a reusable payment type for this company. Allowances are
 *          always taxable — most cash allowances (transport, housing, meal,
 *          hardship) are taxable under KRA rules by default, and the real
 *          exceptions are capped/conditional (e.g. meals exempt only up to a
 *          monthly limit), which a simple on/off toggle can't model safely.
 *          Rather than risk someone marking a capped exemption as fully
 *          tax-free, every allowance is taxed in full. Deductions are
 *          unaffected either way — they never read this flag.
 * @access  Private
 */
router.post('/payment-types', protect, async (req, res, next) => {
    const { name, typeCategory } = req.body;
    const companyId = req.user.companyId;

    if (!name || !name.trim()) {
        return res.status(400).json({ status: 'error', message: 'Name is required.' });
    }
    if (name.trim().length > 100) {
        return res.status(400).json({ status: 'error', message: 'Name must be at most 100 characters.' });
    }
    const category = (typeCategory || '').toUpperCase();
    if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ status: 'error', message: "Category must be 'ALLOWANCE' or 'DEDUCTION'." });
    }

    try {
        const result = await pool.query(
            `INSERT INTO company_payment_types (company_id, name, type_category, is_taxable)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [companyId, name.trim(), category, true]
        );
        res.status(201).json({ status: 'success', data: { ...result.rows[0], employee_count: 0 } });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   DELETE /api/allowances/payment-types/:id
 * @desc    Deletes a payment type. Blocked while any employee still has it
 *          attached — employee_recurring_payments.payment_type_id has no
 *          cascade, so Postgres itself refuses this (error 23503); we just
 *          turn that into a message that says how many employees to detach
 *          first, instead of a raw FK-violation crash.
 * @access  Private
 */
router.delete('/payment-types/:id', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `DELETE FROM company_payment_types WHERE id = $1 AND company_id = $2 RETURNING id`,
            [req.params.id, req.user.companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Payment type not found.' });
        }
        res.status(200).json({ status: 'success', message: 'Payment type deleted.' });
    } catch (error) {
        if (error.code === '23503') {
            return res.status(400).json({
                status: 'error',
                message: 'This payment type is still attached to one or more employees. Remove it from them first.'
            });
        }
        next(error);
    }
});

/* ======================================================================
   ASSIGNMENTS — a payment type attached to one specific employee, at
   their own amount. employee_recurring_payments has no company_id column
   directly, so every query here scopes through the employees table instead.
   ====================================================================== */

/**
 * @route   GET /api/allowances/assignments
 * @desc    Every recurring payment currently attached to any of this
 *          company's employees, with employee and type names joined in
 *          for display.
 * @access  Private
 */
router.get('/assignments', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT r.id, r.amount, r.employee_id, r.payment_type_id,
                    e.full_name AS employee_name,
                    t.name AS type_name, t.type_category, t.is_taxable
             FROM employee_recurring_payments r
             JOIN employees e ON e.id = r.employee_id
             JOIN company_payment_types t ON t.id = r.payment_type_id
             WHERE e.company_id = $1
             ORDER BY e.full_name ASC, t.name ASC`,
            [req.user.companyId]
        );
        res.status(200).json({ status: 'success', assignments: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/allowances/assignments
 * @desc    Attaches a payment type to an employee at a given amount.
 *          Both employeeId and paymentTypeId are verified as belonging to
 *          the caller's own company before the insert — without this, one
 *          company could attach another company's payment type by guessing
 *          its ID, since the FK columns alone don't enforce that.
 * @access  Private
 */
router.post('/assignments', protect, async (req, res, next) => {
    const { employeeId, paymentTypeId, amount } = req.body;
    const companyId = req.user.companyId;

    if (!employeeId || !paymentTypeId || amount === undefined || amount === null || amount === '') {
        return res.status(400).json({ status: 'error', message: 'Employee, payment type, and amount are all required.' });
    }
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ status: 'error', message: 'Amount must be a positive number.' });
    }

    try {
        const ownershipCheck = await pool.query(
            `SELECT
                (SELECT 1 FROM employees WHERE id = $1 AND company_id = $3) AS employee_ok,
                (SELECT 1 FROM company_payment_types WHERE id = $2 AND company_id = $3) AS type_ok`,
            [employeeId, paymentTypeId, companyId]
        );
        const { employee_ok, type_ok } = ownershipCheck.rows[0];
        if (!employee_ok) {
            return res.status(404).json({ status: 'error', message: 'Employee not found.' });
        }
        if (!type_ok) {
            return res.status(404).json({ status: 'error', message: 'Payment type not found.' });
        }

        const result = await pool.query(
            `INSERT INTO employee_recurring_payments (employee_id, payment_type_id, amount)
             VALUES ($1, $2, $3) RETURNING *`,
            [employeeId, paymentTypeId, numericAmount]
        );

        const withNames = await pool.query(
            `SELECT r.id, r.amount, r.employee_id, r.payment_type_id,
                    e.full_name AS employee_name,
                    t.name AS type_name, t.type_category, t.is_taxable
             FROM employee_recurring_payments r
             JOIN employees e ON e.id = r.employee_id
             JOIN company_payment_types t ON t.id = r.payment_type_id
             WHERE r.id = $1`,
            [result.rows[0].id]
        );

        res.status(201).json({ status: 'success', data: withNames.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   DELETE /api/allowances/assignments/:id
 * @desc    Detaches a payment type from an employee. Scoped through the
 *          employees join since employee_recurring_payments has no
 *          company_id of its own.
 * @access  Private
 */
router.delete('/assignments/:id', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `DELETE FROM employee_recurring_payments r
             USING employees e
             WHERE r.id = $1 AND r.employee_id = e.id AND e.company_id = $2
             RETURNING r.id`,
            [req.params.id, req.user.companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Assignment not found.' });
        }
        res.status(200).json({ status: 'success', message: 'Removed.' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;