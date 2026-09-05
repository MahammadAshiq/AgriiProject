require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const otpRoutes = require("./routes/otp");
const db = require('./config/db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../Frontend')));

async function ensureDualRoleSchema() {
    try {
        await db.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key');
        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS users_email_role_uidx
            ON users (lower(email), role)
        `);
        console.log('Dual-role accounts enabled (same email, farmer + student).');
    } catch (err) {
        console.warn('Could not apply dual-role schema (database may be offline):', err.message);
    }
}

ensureDualRoleSchema();


// Health check
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        message: 'AgriLearn backend is running.'
    });
});


// Auth routes
app.use('/api', authRoutes);


// Admin routes
app.use('/api/admin', adminRoutes);

// OTP routes
app.use('/api/otp', otpRoutes);


// Database test route
app.get('/api/db-test', async (req, res) => {

    try {

        const result = await db.query('SELECT NOW()');

        res.json({
            success: true,
            databaseTime: result.rows[0].now
        });

    } catch(err) {

        console.error(err);

        res.status(500).json({
            success:false,
            error:err.message
        });

    }

});


// Error handler
app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).json({
        error:'Something went wrong on the server.'
    });

});



const PORT = process.env.PORT || 4000;

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`AgriiLearn backend running on http://localhost:${PORT}`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
}

module.exports = app;