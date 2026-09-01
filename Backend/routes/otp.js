const express = require("express");
const router = express.Router();

const pool = require("../config/db");
const { sendSms } = require("../utils/sms");

// =====================================================
// SEND OTP
// POST /api/otp/send
// =====================================================
router.post("/send", async (req, res) => {
    try {
        const { phone, purpose } = req.body;

        if (!phone) {
            return res.status(400).json({
                error: "Phone number required"
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        const expires = new Date(Date.now() + 5 * 60 * 1000);

        await pool.query(
            `INSERT INTO otp_codes
             (phone, code, purpose, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [
                phone,
                otp,
                purpose || "register",
                expires
            ]
        );

        await sendSms(
            phone,
            `Your AgriLearn OTP is ${otp}. It is valid for 5 minutes.`
        );

        // Development mode
        res.json({
            message: "OTP sent successfully",
            devOtp: otp
        });

    } catch (err) {
        console.error("OTP SEND ERROR:", err);

        res.status(500).json({
            error: "Failed to send OTP"
        });
    }
});


// =====================================================
// VERIFY OTP
// POST /api/otp/verify
// =====================================================
router.post("/verify", async (req, res) => {

    try {
        const { phone, code, purpose } = req.body;


        if (!phone || !code) {
            return res.status(400).json({
                error: "Phone number and OTP are required"
            });
        }

        const otpPurpose = purpose || "register";

        const result = await pool.query(
            `SELECT *
             FROM otp_codes
             WHERE phone = $1
             ORDER BY id DESC
             LIMIT 1`,
            [phone]
        );


        if (result.rows.length === 0) {
            return res.status(400).json({
                error: "No OTP found for this phone number"
            });
        }

        const latestOtp = result.rows[0];

        if (latestOtp.code !== code && latestOtp.otp !== code) {
            return res.status(400).json({
                error: "Invalid OTP"
            });
        }

        if (latestOtp.purpose !== otpPurpose) {
            return res.status(400).json({
                error: "OTP purpose mismatch"
            });
        }

        if (new Date(latestOtp.expires_at) <= new Date()) {
            return res.status(400).json({
                error: "OTP expired"
            });
        }

        // OTP is valid — delete it so it cannot be reused
        await pool.query(
            `DELETE FROM otp_codes
             WHERE id = $1`,
            [latestOtp.id]
        );


        res.json({
            message: "OTP verified successfully",
            verified: true
        });

    } catch (err) {
        console.error("OTP VERIFY ERROR:", err);

        res.status(500).json({
            error: "Failed to verify OTP"
        });
    }
});


module.exports = router;