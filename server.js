const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./src/config/db');

// 1. Import all your secure route modules
const authRoutes = require('./src/routes/authRoutes');
const employeeRoutes = require('./src/routes/employeeRoutes');
const payrollRoutes = require('./src/routes/payrollRoutes');
const bankRoutes = require('./src/routes/bankRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const nssfRoutes = require('./src/routes/nssfRoutes');
const shifRoutes = require('./src/routes/shifroutes');       // <-- casing fixed to match the real file
const payslipRoutes = require('./src/routes/paysliproutes'); // <-- casing fixed to match the real file
const p10Routes = require('./src/routes/p10routes');         // <-- casing fixed to match the real file
const allowanceRoutes = require('./src/routes/allowanceRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

const app = express();
// exposedHeaders lets the browser's JS actually read Content-Disposition on
// cross-origin responses — without this, every file download's real
// filename/extension is invisible to the frontend and silently falls back
// to whatever guess the calling code hardcoded (this was the cause of
// downloaded bank templates showing up misnamed as .xlsx).
app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
const PORT = process.env.PORT || 5000;

app.use(express.json());

// 2. Mount network endpoints
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/nssf', nssfRoutes);
app.use('/api/shif', shifRoutes);
app.use('/api/payslips', payslipRoutes);
app.use('/api/p10', p10Routes);
app.use('/api/allowances', allowanceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/companies', require('./src/routes/companyRoutes'));
app.get('/api/health', async (req, res) => {
    try {
        const dbCheck = await db.query('SELECT NOW()');
        res.status(200).json({
            status: 'success',
            message: 'Kenya Payroll Backend Engine is running smoothly!',
            databaseTimestamp: dbCheck.rows[0].now
        });
    } catch (err) {
        res.status(500).json({
            status: 'error',
            message: 'Server is running, but database connection failed.',
            error: err.message
        });
    }
});

// Centralized Global Error Handler — hardened so it can never print a bare
// "undefined" again, even if something throws a plain object instead of a
// real Error (which is what was happening with the IntaSend SDK failure).
app.use((err, req, res, next) => {
    console.error('--- Unhandled error ---');
    console.error('Path:', req.method, req.originalUrl);
    console.error('Message:', err?.message || '(no message — a non-Error value was thrown)');
    console.error('Stack:', err?.stack || '(no stack available on whatever was thrown)');
    console.error('Raw value:', err);
    console.error('------------------------');

    const statusCode = err?.statusCode || err?.status || 500;
    res.status(statusCode).json({
        status: 'error',
        message: statusCode === 500
            ? 'An unexpected internal error occurred on the payroll server.'
            : (err?.message || 'Something went wrong.')
    });
});

app.listen(PORT, () => {
    console.log(`Server successfully ignited and listening on port ${PORT}`);
});

module.exports = app;