const IntaSend = require('intasend-node');

const intasend = new IntaSend(
    process.env.INTASEND_PUBLISHABLE_KEY,
    process.env.INTASEND_SECRET_KEY,
    process.env.INTASEND_TEST_MODE !== 'false'
);

async function triggerStkPush({ phoneNumber, amount, email, firstName, lastName, apiRef }) {
    const collection = intasend.collection();

    try {
        const response = await collection.mpesaStkPush({
            first_name: firstName || 'Payroll',
            last_name: lastName || 'Admin',
            email: email,
            host: process.env.APP_HOST,
            amount: amount,
            phone_number: phoneNumber,
            api_ref: apiRef
        });

        return {
            invoiceId: response?.invoice?.invoice_id || response?.id,
            state: response?.invoice?.state || 'PENDING',
            raw: response
        };
    } catch (rawError) {
        const detail = rawError?.response?.data || rawError?.response?.body || rawError?.message || rawError;
        console.error('--- IntaSend STK push failed ---');
        console.error('Status:', rawError?.response?.status || rawError?.status || 'unknown');
        console.error('Detail:', JSON.stringify(detail, null, 2));
        console.error('---------------------------------');

        const cleanError = new Error(
            `IntaSend rejected the payment request: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
        );
        cleanError.statusCode = 502;
        throw cleanError;
    }
}

/**
 * Actively asks IntaSend "what's the current state of this invoice?" — a
 * fallback for when the webhook hasn't (or can't, e.g. on localhost) reach
 * us yet. Safe to call repeatedly; it's a read-only status check.
 */
async function checkInvoiceStatus(invoiceId) {
    const collection = intasend.collection();
    try {
        const response = await collection.status(invoiceId);
        return response?.invoice?.state || 'PENDING';
    } catch (rawError) {
        const detail = rawError?.response?.data || rawError?.response?.body || rawError?.message || rawError;
        console.error('--- IntaSend status check failed ---');
        console.error('Detail:', JSON.stringify(detail, null, 2));
        console.error('-------------------------------------');
        return 'PENDING';
    }
}

module.exports = { triggerStkPush, checkInvoiceStatus };