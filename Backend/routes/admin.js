const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const ah = (fn) => (req, res, next) =>
    fn(req, res, next).catch(next);


router.post('/login', (req, res) => {

    const { username, password } = req.body;

    if (
        username === process.env.ADMIN_USERNAME &&
        password === process.env.ADMIN_PASSWORD
    ) {

        const token = jwt.sign(
    {
        type: 'admin',
        username,
        role: 'admin'
    },
    process.env.JWT_SECRET,
    {
        expiresIn: '12h'
    }
);

        return res.json({
            ok: true,
            token
        });
    }

    res.status(401).json({
        error: 'Incorrect admin username or password.'
    });

});


router.get('/stats', requireAdmin, ah(async (req, res) => {

    const totalUsers = await db.query(
        'SELECT COUNT(*)::int AS count FROM users'
    );

    const totalFarmers = await db.query(
        'SELECT COUNT(*)::int AS count FROM farmer_profiles'
    );

    const totalStudents = await db.query(
        'SELECT COUNT(*)::int AS count FROM student_profiles'
    );


    const farmersByLocation = await db.query(
    `SELECT district AS location, COUNT(*)::int AS count
     FROM farmer_profiles
     WHERE district IS NOT NULL
     GROUP BY district
     ORDER BY count DESC
     LIMIT 15`
);


    const studentsByLocation = await db.query(
    `SELECT u.location, COUNT(*)::int AS count
     FROM student_profiles s
     JOIN users u ON u.user_id = s.user_id
     WHERE u.location IS NOT NULL
     GROUP BY u.location
     ORDER BY count DESC
     LIMIT 15`
);


    const registrationsByDay = await db.query(
        `SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS count
         FROM users
         WHERE created_at > now() - interval '30 days'
         GROUP BY day
         ORDER BY day ASC`
    );


   const recent = await db.query(
    `SELECT
        u.email,
        u.user_id,
        u.name,
        u.phone,
        u.role,
        u.location,
        u.created_at,
        f.district AS farmer_district,
        f.village AS farmer_village,
        s.institution AS student_institution,
        s.course AS student_course
     FROM users u
     LEFT JOIN farmer_profiles f
        ON f.user_id = u.user_id
     LEFT JOIN student_profiles s
        ON s.user_id = u.user_id
     ORDER BY u.created_at DESC
     LIMIT 20`
);


    res.json({

        totalUsers: totalUsers.rows[0].count,

        totalFarmers: totalFarmers.rows[0].count,

        totalStudents: totalStudents.rows[0].count,

        farmersByLocation: farmersByLocation.rows,

        studentsByLocation: studentsByLocation.rows,

        registrationsByDay: registrationsByDay.rows,

        recent: recent.rows

    });

}));


module.exports = router;