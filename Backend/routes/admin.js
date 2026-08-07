const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  // Simple env-based admin login for now. For multiple admins with their own
  // passwords, use the `admins` table already defined in schema.sql instead.
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ type: 'admin', username }, process.env.JWT_SECRET, { expiresIn: '12h' });
    return res.json({ ok: true, token });
  }
  res.status(401).json({ error: 'Incorrect admin username or password.' });
});

router.get('/stats', requireAdmin, ah(async (req, res) => {
  const totalUsers = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  const totalFarmers = await pool.query('SELECT COUNT(*)::int AS count FROM farmer_profiles');
  const totalStudents = await pool.query('SELECT COUNT(*)::int AS count FROM student_profiles');

  const farmersByLocation = await pool.query(
    'SELECT location, COUNT(*)::int AS count FROM farmer_profiles GROUP BY location ORDER BY count DESC LIMIT 15'
  );
  const studentsByLocation = await pool.query(
    'SELECT home_location AS location, COUNT(*)::int AS count FROM student_profiles GROUP BY home_location ORDER BY count DESC LIMIT 15'
  );
  const registrationsByDay = await pool.query(
    `SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
     FROM users WHERE created_at > now() - interval '30 days'
     GROUP BY day ORDER BY day ASC`
  );
  const recent = await pool.query(
    `SELECT u.gmail, u.user_id, u.created_at,
            f.name AS farmer_name, f.location AS farmer_location,
            s.name AS student_name, s.home_location AS student_location
     FROM users u
     LEFT JOIN farmer_profiles f ON f.user_id = u.id
     LEFT JOIN student_profiles s ON s.user_id = u.id
     ORDER BY u.created_at DESC LIMIT 20`
  );

  res.json({
    totalUsers: totalUsers.rows[0].count,
    totalFarmers: totalFarmers.rows[0].count,
    totalStudents: totalStudents.rows[0].count,
    farmersByLocation: farmersByLocation.rows,
    studentsByLocation: studentsByLocation.rows,
    registrationsByDay: registrationsByDay.rows,
    recent: recent.rows,
  });
}));

module.exports = router;
