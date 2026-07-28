const nodemailer = require('nodemailer');

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be set in .env — check your .env file is loading correctly.');
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendPayslipEmail(toEmail, employeeName, period, pdfBuffer) {
    if (!toEmail) {
        throw new Error('No email address on file for this employee.');
    }

    await transporter.sendMail({
        from: `"Zuvy Payroll" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `Your payslip for ${period}`,
        text: `Hi ${employeeName},\n\nYour payslip for ${period} is attached.\n\n— Zuvy Payroll`,
        attachments: [
            { filename: `Payslip_${period.replace(' ', '_')}.pdf`, content: pdfBuffer }
        ]
    });
}

async function sendOtpEmail(toEmail, fullName, otpCode) {
    if (!toEmail) {
        throw new Error('No email address provided for OTP delivery.');
    }

    await transporter.sendMail({
        from: `"Zuvy Payroll" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `Your Zuvy Payroll verification code: ${otpCode}`,
        text: `Hi ${fullName},\n\nYour verification code is ${otpCode}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.\n\n— Zuvy Payroll`
    });
}

async function sendPasswordResetEmail(toEmail, fullName, otpCode) {
    if (!toEmail) {
        throw new Error('No email address provided for password reset.');
    }

    await transporter.sendMail({
        from: `"Zuvy Payroll" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `Reset your Zuvy Payroll password: ${otpCode}`,
        text: `Hi ${fullName},\n\nUse this code to reset your password: ${otpCode}. It expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email — your password won't change unless someone enters this exact code.\n\n— Zuvy Payroll`
    });
}

async function sendNewAccountEmail(toEmail, fullName, companyName, loginPin) {
    if (!toEmail) {
        throw new Error('No email address provided for the new account.');
    }

    await transporter.sendMail({
        from: `"Zuvy Payroll" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `You've been added to ${companyName} on Zuvy Payroll`,
        text: `Hi ${fullName},\n\nYou've been added as an account holder for ${companyName} on Zuvy Payroll.\n\nLog in with:\nEmail: ${toEmail}\nPIN: ${loginPin}\n\nFor your own security, change this PIN as soon as you log in (Team page → Change your password).\n\n— Zuvy Payroll`
    });
}

module.exports = { sendPayslipEmail, sendOtpEmail, sendPasswordResetEmail, sendNewAccountEmail };