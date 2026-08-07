const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { sendSms } = require('../utils/sms');

const router = express.Router();
const OTP_EXPIRY_MINUTES = 5;
const REGISTER_OTP_VALID_WINDOW_MINUTES = 15;

// Wraps async route handlers so a thrown/rejected error becomes a clean 500
// response instead of crashing the whole Node process (this was a real bug —
// caught it while testing).
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
}

/* ============ Check if a Gmail already has an account (for registration linking UX) ============ */
router.get('/check-gmail', ah(async (req, res) => {
  const gmail = (req.query.gmail || '').toLowerCase();
  if (!gmail) return res.json({ exists: false });
  const { rows } = await pool.query('SELECT 1 FROM users WHERE gmail = $1', [gmail]);
  res.json({ exists: rows.length > 0 });
}));

/* ============ OTP ============ */
router.post('/otp/send', ah(async (req, res) => {
  const { phone, purpose } = req.body;
  if (!phone || !/^[0-9]{10}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit phone number.' });
  if (!['register', 'reset'].includes(purpose)) return res.status(400).json({ error: 'Invalid OTP purpose.' });

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);
  await pool.query(
    'INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES ($1, $2, $3, $4)',
    [phone, code, purpose, expiresAt]
  );

  const message = `Your AgriLearn ${purpose === 'reset' ? 'password reset' : 'verification'} code is ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`;
  const result = await sendSms(phone, message);

  res.json({
    ok: true,
    message: result.sent ? 'OTP sent to your phone.' : 'OTP generated (dev mode — check server console).',
    devOtp: result.devMode ? code : undefined, // only present when no real SMS provider is configured
  });
}));

router.post('/otp/verify', ah(async (req, res) => {
  const { phone, code, purpose } = req.body;
  const { rows } = await pool.query(
    `SELECT * FROM otp_codes
     WHERE phone = $1 AND purpose = $2 AND code = $3 AND expires_at > now() AND verified = false
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose, code]
  );
  if (rows.length === 0) return res.status(400).json({ error: 'Incorrect or expired code.' });

  await pool.query('UPDATE otp_codes SET verified = true WHERE id = $1', [rows[0].id]);
  res.json({ ok: true });
}));

async function phoneRecentlyVerified(phone, purpose, minutes) {
  const { rows } = await pool.query(
    `SELECT 1 FROM otp_codes
     WHERE phone = $1 AND purpose = $2 AND verified = true AND created_at > now() - ($3 || ' minutes')::interval
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose, minutes]
  );
  return rows.length > 0;
}

/* ============ Registration ============ */
router.post('/register/farmer', ah(async (req, res) => {
  const { gmail, name, userId, phone, gender, password, location, existingPassword } = req.body;
  if (!gmail || !name || !phone || !gender || !location) return res.status(400).json({ error: 'Missing required fields.' });

  const verified = await phoneRecentlyVerified(phone, 'register', REGISTER_OTP_VALID_WINDOW_MINUTES);
  if (!verified) return res.status(400).json({ error: 'Please verify your phone number with OTP first.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM users WHERE gmail = $1', [gmail.toLowerCase()]);
    let userRow;

    if (existing.rows.length > 0) {
      userRow = existing.rows[0];
      const match = await bcrypt.compare(existingPassword || '', userRow.password_hash);
      if (!match) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Incorrect password for the existing account on this Gmail.' });
      }
    } else {
      if (!userId || userId.length < 4) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Choose a User ID (min 4 characters).' }); }
      if (!password || password.length < 6) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Password must be at least 6 characters.' }); }
      const userIdTaken = await client.query('SELECT 1 FROM users WHERE user_id = $1', [userId]);
      if (userIdTaken.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That User ID is already taken.' }); }

      const hash = await bcrypt.hash(password, 10);
      const inserted = await client.query(
        'INSERT INTO users (gmail, user_id, phone, password_hash) VALUES ($1,$2,$3,$4) RETURNING *',
        [gmail.toLowerCase(), userId, phone, hash]
      );
      userRow = inserted.rows[0];
    }

    await client.query(
      `INSERT INTO farmer_profiles (user_id, name, gender, location) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET name=$2, gender=$3, location=$4`,
      [userRow.id, name, gender, location]
    );
    await client.query('COMMIT');

    const token = signToken({ sub: userRow.id, role: 'farmer' });
    res.json({ ok: true, token, name, isNewAccount: existing.rows.length === 0, userId: userRow.user_id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  } finally {
    client.release();
  }
}));

router.post('/register/student', ah(async (req, res) => {
  const { gmail, name, userId, phone, gender, password, existingPassword,
    age, dob, college, branch, year, presentStudies, homeLocation, collegeLocation } = req.body;
  if (!gmail || !name || !phone || !gender || !college || !branch || !year || !homeLocation || !collegeLocation) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const verified = await phoneRecentlyVerified(phone, 'register', REGISTER_OTP_VALID_WINDOW_MINUTES);
  if (!verified) return res.status(400).json({ error: 'Please verify your phone number with OTP first.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM users WHERE gmail = $1', [gmail.toLowerCase()]);
    let userRow;

    if (existing.rows.length > 0) {
      userRow = existing.rows[0];
      const match = await bcrypt.compare(existingPassword || '', userRow.password_hash);
      if (!match) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Incorrect password for the existing account on this Gmail.' });
      }
    } else {
      if (!userId || userId.length < 4) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Choose a User ID (min 4 characters).' }); }
      if (!password || password.length < 6) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Password must be at least 6 characters.' }); }
      const userIdTaken = await client.query('SELECT 1 FROM users WHERE user_id = $1', [userId]);
      if (userIdTaken.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That User ID is already taken.' }); }

      const hash = await bcrypt.hash(password, 10);
      const inserted = await client.query(
        'INSERT INTO users (gmail, user_id, phone, password_hash) VALUES ($1,$2,$3,$4) RETURNING *',
        [gmail.toLowerCase(), userId, phone, hash]
      );
      userRow = inserted.rows[0];
    }

    await client.query(
      `INSERT INTO student_profiles (user_id, name, age, dob, gender, college, branch, year, present_studies, home_location, college_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (user_id) DO UPDATE SET name=$2, age=$3, dob=$4, gender=$5, college=$6, branch=$7, year=$8, present_studies=$9, home_location=$10, college_location=$11`,
      [userRow.id, name, age || null, dob || null, gender, college, branch, year, presentStudies || null, homeLocation, collegeLocation]
    );
    await client.query('COMMIT');

    const token = signToken({ sub: userRow.id, role: 'student' });
    res.json({ ok: true, token, name, isNewAccount: existing.rows.length === 0, userId: userRow.user_id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  } finally {
    client.release();
  }
}));

/* ============ Login (role-specific) ============ */
function loginHandler(role) {
  return async (req, res) => {
    const { userId, password } = req.body;
    if (!userId || !password) return res.status(400).json({ error: 'Enter your User ID and Password.' });

    const { rows } = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    if (rows.length === 0) return res.status(401).json({ error: 'Incorrect User ID or Password.' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect User ID or Password.' });

    const table = role === 'farmer' ? 'farmer_profiles' : 'student_profiles';
    const profile = await pool.query(`SELECT * FROM ${table} WHERE user_id = $1`, [user.id]);

    if (profile.rows.length === 0) {
      const otherTable = role === 'farmer' ? 'student_profiles' : 'farmer_profiles';
      const other = await pool.query(`SELECT 1 FROM ${otherTable} WHERE user_id = $1`, [user.id]);
      const otherRole = role === 'farmer' ? 'student' : 'farmer';
      return res.status(404).json({
        error: other.rows.length > 0
          ? `This account doesn't have a ${role} profile yet — it's registered as a ${otherRole}. Register with the same Gmail to add a ${role} profile.`
          : `No ${role} account found for this User ID.`,
      });
    }

    const token = signToken({ sub: user.id, role });
    res.json({ ok: true, token, profile: { ...profile.rows[0], gmail: user.gmail } });
  };
}
router.post('/login/farmer', loginHandler('farmer'));
router.post('/login/student', loginHandler('student'));

/* ============ Forgot password (OTP-based, not literally texting the password — more secure) ============ */
router.post('/forgot-password/request', ah(async (req, res) => {
  const { userId, phone } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE user_id = $1 AND phone = $2', [userId, phone]);
  if (rows.length === 0) {
    // Deliberately generic message — doesn't reveal whether the User ID exists,
    // just whether this exact User ID + phone combination matches.
    return res.status(404).json({ error: 'No account found with that User ID and phone number combination.' });
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);
  await pool.query('INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES ($1,$2,$3,$4)', [phone, code, 'reset', expiresAt]);
  const result = await sendSms(phone, `Your AgriLearn password reset code is ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`);

  res.json({ ok: true, message: 'Reset code sent.', devOtp: result.devMode ? code : undefined });
}));

router.post('/forgot-password/reset', ah(async (req, res) => {
  const { userId, phone, code, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE user_id = $1 AND phone = $2', [userId, phone]);
  if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' });

  const otpRows = await pool.query(
    `SELECT * FROM otp_codes WHERE phone = $1 AND purpose = 'reset' AND code = $2 AND expires_at > now() AND verified = false
     ORDER BY created_at DESC LIMIT 1`,
    [phone, code]
  );
  if (otpRows.rows.length === 0) return res.status(400).json({ error: 'Incorrect or expired reset code.' });

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, rows[0].id]);
  await pool.query('UPDATE otp_codes SET verified = true WHERE id = $1', [otpRows.rows[0].id]);

  res.json({ ok: true, message: 'Password updated. You can log in with your new password now.' });
}));

module.exports = router;
