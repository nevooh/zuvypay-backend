const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const pool = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');
const { saveFile, getFile, getFileUrl } = require('../services/fileStorage');

const ALLOWED_TEMPLATE_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_TEMPLATE_EXTENSIONS.includes(ext)) {
            const err = new Error(`Unsupported file type "${ext || 'unknown'}" — please upload a .xlsx, .xls, or .csv bank template.`);
            err.statusCode = 400;
            return cb(err);
        }
        cb(null, true);
    }
});

/**
 * @route   GET /api/bank/kenya-banks
 * @desc    Dropdown list — no free text, no typos possible.
 */
router.get('/kenya-banks', protect, async (req, res, next) => {
    try {
        const result = await pool.query(`SELECT bank_name, bank_code FROM kenya_banks ORDER BY bank_name ASC`);
        res.status(200).json({ status: 'success', banks: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/bank/available
 * @desc    Banks that are actually built and ready (a real generator file exists for them).
 */
router.get('/available', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT bank_name FROM bank_layout_submissions WHERE status = 'built' ORDER BY bank_name ASC`
        );
        res.status(200).json({ status: 'success', banks: result.rows.map(r => r.bank_name) });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/bank/check/:bankName
 * @desc    "Is this bank already built?" — checked the moment a company picks one.
 */
router.get('/check/:bankName', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT status FROM bank_layout_submissions WHERE bank_name = $1 AND status = 'built' LIMIT 1`,
            [req.params.bankName]
        );
        res.status(200).json({ status: 'success', exists: result.rows.length > 0 });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/bank/submit-template
 * @desc    Company uploads their bank's blank template. Sits as 'pending' —
 *          you personally look at it and write a hardcoded generator for
 *          this bank (same pattern as nssfGenerator.js / p10Generator.js).
 *          Once written, flip this submission to 'built' and every company
 *          on this bank is unblocked, forever, with zero setup of their own.
 * @access  Private
 */
router.post('/submit-template', protect, upload.single('template'), async (req, res, next) => {
    const { bankName } = req.body;
    const companyId = req.user.companyId;

    if (!req.file || !bankName) {
        return res.status(400).json({ status: 'error', message: 'Missing bankName or template file.' });
    }

    try {
        const fingerprint = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const realExtension = path.extname(req.file.originalname).toLowerCase() || '.xlsx';
        const storageKey = await saveFile(`bank-submissions/${fingerprint}${realExtension}`, req.file.buffer);

        await pool.query(
            `INSERT INTO bank_layout_submissions (bank_name, submitted_by_company_id, file_fingerprint, file_storage_key, status)
             VALUES ($1, $2, $3, $4, 'pending')`,
            [bankName, companyId, fingerprint, storageKey]
        );

        res.status(201).json({
            status: 'success',
            message: `Thanks — ${bankName} is being set up. This usually takes under 24 hours.`,
            fileUrl: getFileUrl(storageKey)
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/bank/my-submission/:bankName
 * @desc    Company checks the status of what they submitted.
 */
router.get('/my-submission/:bankName', protect, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT status, submitted_at FROM bank_layout_submissions
             WHERE bank_name = $1 AND submitted_by_company_id = $2
             ORDER BY submitted_at DESC LIMIT 1`,
            [req.params.bankName, req.user.companyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'No submission found.' });
        }
        res.status(200).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/admin/bank-submissions
 * @desc    ADMIN-ONLY (you). Your queue — every bank waiting on you to build.
 */
router.get('/admin/bank-submissions', protect, adminOnly, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT bs.*, c.company_name FROM bank_layout_submissions bs
             JOIN companies c ON bs.submitted_by_company_id = c.id
             WHERE bs.status = 'pending' ORDER BY bs.submitted_at ASC`
        );
        const submissions = result.rows.map(row => ({ ...row, fileUrl: getFileUrl(row.file_storage_key) }));
        res.status(200).json({ status: 'success', submissions });
    } catch (error) {
        next(error);
    }
});

/**
 * @route   GET /api/admin/bank-submissions/:id/download
 * @desc    ADMIN-ONLY. Download the real submitted file to inspect before
 *          writing the hardcoded generator — same use as the Template
 *          Inspector, just pulling from real storage now instead of memory.
 */
router.get('/admin/bank-submissions/:id/download', protect, adminOnly, async (req, res, next) => {
    try {
        const subResult = await pool.query(`SELECT * FROM bank_layout_submissions WHERE id = $1`, [req.params.id]);
        const submission = subResult.rows[0];
        if (!submission) return res.status(404).json({ status: 'error', message: 'Submission not found.' });

        const buffer = await getFile(submission.file_storage_key);
        const realExtension = path.extname(submission.file_storage_key) || '.xlsx';
        const contentTypeByExt = {
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.xls': 'application/vnd.ms-excel',
            '.csv': 'text/csv'
        };
        res.setHeader('Content-Type', contentTypeByExt[realExtension] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${submission.bank_name}_template${realExtension}"`);
        return res.status(200).send(buffer);
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/admin/bank-submissions/:id/mark-built
 * @desc    ADMIN-ONLY. You've written the hardcoded generator for this bank —
 *          flip it to 'built'. Manual, on purpose — no auto-detection.
 */
router.post('/admin/bank-submissions/:id/mark-built', protect, adminOnly, async (req, res, next) => {
    try {
        const result = await pool.query(
            `UPDATE bank_layout_submissions SET status = 'built', reviewed_at = NOW() WHERE id = $1 RETURNING *;`,
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Submission not found.' });
        res.status(200).json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

module.exports = router;