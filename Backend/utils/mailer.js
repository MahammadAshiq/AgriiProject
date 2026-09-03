const nodemailer = require('nodemailer');

let testTransporter = null;

async function getTransporter() {
    // If Gmail / SMTP environment variables exist, use them to deliver real emails
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    // Fallback to Ethereal Test SMTP for development
    if (!testTransporter) {
        try {
            const testAccount = await nodemailer.createTestAccount();
            testTransporter = nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass,
                },
            });
            console.log('📧 Created Ethereal Test Mailer Account:', testAccount.user);
        } catch (err) {
            console.warn('Could not create test mail account:', err.message);
            return null;
        }
    }
    return testTransporter;
}

async function sendResetEmail(toEmail, resetLinkOrCode) {
    try {
        const transporter = await getTransporter();
        if (!transporter) return { success: false, error: 'No mail transporter configured' };

        const mailOptions = {
            from: '"AgriLearn Security" <no-reply@agrilearn.app>',
            to: toEmail,
            subject: '🔒 Reset Your AgriLearn Password',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #FAF8F5;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #1E3A2B; margin: 0;">🌱 AgriLearn</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Password Reset Request</p>
                    </div>
                    <div style="background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #cbd5e1;">
                        <p style="font-size: 15px; color: #1e293b;">Hello,</p>
                        <p style="font-size: 14.5px; color: #334155; line-height: 1.5;">We received a request to reset the password for your AgriLearn account (<strong>${toEmail}</strong>).</p>
                        <div style="text-align: center; margin: 24px 0;">
                            <a href="${resetLinkOrCode}" style="background: #1E3A2B; color: #ffffff; text-decoration: none; padding: 12px 28px; font-weight: bold; border-radius: 8px; display: inline-block;">Reset Password Now</a>
                        </div>
                        <p style="font-size: 13px; color: #64748b;">If the button above does not work, copy and paste this link into your browser:<br/><a href="${resetLinkOrCode}" style="color: #2A4D69;">${resetLinkOrCode}</a></p>
                    </div>
                    <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 20px;">If you did not request a password reset, you can safely ignore this email.</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
            console.log('✉️ REAL EMAIL PREVIEW URL:', previewUrl);
        }
        return { success: true, previewUrl, messageId: info.messageId };
    } catch (err) {
        console.error('FAILED TO SEND EMAIL:', err);
        return { success: false, error: err.message };
    }
}

module.exports = { sendResetEmail };
