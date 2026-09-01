const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026';

function signToken(user) {
    return jwt.sign(
        {
            user_id: user.user_id,
            role: user.role,
            email: user.email || user.gmail
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function publicProfile(user) {
    return {
        userId: user.user_id,
        name: user.name || '',
        gmail: user.email || user.gmail,
        email: user.email || user.gmail,
        phone: user.phone || '',
        location: user.location || '',
        role: user.role,
        profileCompleted: !!user.profile_completed
    };
}

async function findAccountsByEmail(email) {
    const clean = String(email || '').toLowerCase().trim();
    if (!clean) return [];
    const result = await pool.query(
        `SELECT * FROM users
         WHERE lower(email) = $1 OR lower(COALESCE(gmail, '')) = $1`,
        [clean]
    );
    return result.rows;
}

async function findAccountByLoginAndRole(loginId, role) {
    const clean = String(loginId || '').toLowerCase().trim();
    const result = await pool.query(
        `SELECT * FROM users
         WHERE role = $2
           AND (
             lower(email) = $1
             OR lower(COALESCE(gmail, '')) = $1
             OR user_id::text = $1
             OR phone = $1
           )
         LIMIT 1`,
        [clean, role]
    );
    return result.rows[0] || null;
}

function newUserCode(role) {
    const prefix = role === 'student' ? 'S' : role === 'farmer' ? 'F' : 'U';
    return prefix + '-' + Math.floor(100000 + Math.random() * 900000);
}

/* =========================================================
   TEST DATABASE
========================================================= */

router.get('/test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');

        res.json({
            message: 'Auth route working',
            databaseTime: result.rows[0].now
        });

    } catch (error) {
        console.error('AUTH TEST ERROR:', error);

        res.status(500).json({
            error: 'Database connection failed'
        });
    }
});


/* =========================================================
   CHECK GMAIL
   Frontend calls:
   GET /api/check-gmail?gmail=...
========================================================= */

router.get('/check-gmail', async (req, res) => {
    try {

        const gmail = (req.query.gmail || '').trim().toLowerCase();

        if (!gmail) {
            return res.status(400).json({
                error: 'Gmail required'
            });
        }

        const result = await pool.query(
            `SELECT user_id FROM users WHERE email = $1 LIMIT 1`,
            [gmail]
        );

        res.json({
            exists: result.rows.length > 0
        });

    } catch (error) {

        console.error('CHECK GMAIL ERROR:', error);

        res.status(500).json({
            error: 'Could not check account'
        });
    }
});


/* =========================================================
   REGISTER FARMER
   Frontend calls:
   POST /api/register/farmer
========================================================= */

router.post('/register/farmer', async (req, res) => {

    try {
        const {
            name,
            gender,
            phone,
            gmail,
            userId,
            password,
            location
        } = req.body;

        if (
            !name ||
            !phone ||
            !gmail ||
            !userId ||
            !password
        ) {
            return res.status(400).json({
                error: 'Required farmer fields are missing'
            });
        }

        const existing = await pool.query(
            `
            SELECT *
            FROM users
            WHERE email = $1
               OR phone = $2
               OR user_id::text = $3
            `,
            [
                gmail,
                phone,
                userId
            ]
        );

        if (existing.rows.length > 0) {

            return res.status(409).json({
                error: 'An account with this Gmail, phone or User ID already exists'
            });

        }

        const hashedPassword = await bcrypt.hash(password, 10);

       const result = await pool.query(
    `
    INSERT INTO users
    (
        user_id,
        name,
        email,
        phone,
        password_hash,
        role,
        location
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,$7)
    RETURNING user_id,name,email,phone,role,location
    `,
    [
        userId,
        name,
        gmail,
        phone,
        hashedPassword,
        'farmer',
        location || null
    ]
);

        const user = result.rows[0];

        const token = jwt.sign(
            {
                user_id: user.user_id,
                role: 'farmer'
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '7d'
            }
        );

        res.status(201).json({

            message: 'Farmer registration successful',

            token,

            userId: user.user_id,

            isNewAccount: true,

            profile: {
                userId: user.user_id,
                name: user.name,
                gmail: user.email,
                phone: user.phone,
                gender: gender || '',
                location: user.location || '',
                role: 'farmer'
            }

        });

    } catch (error) {

        console.error('FARMER REGISTER ERROR:', error);

        res.status(500).json({
            error: error.message
        });

    }

});


/* =========================================================
   REGISTER STUDENT
   Frontend calls:
   POST /api/register/student
========================================================= */

router.post('/register/student', async (req, res) => {

    try {
        const {
            name,
            gender,
            phone,
            gmail,
            userId,
            password,

            age,
            dob,
            college,
            branch,
            year,
            presentStudies,
            homeLocation,
            collegeLocation
        } = req.body;


        if (
            !name ||
            !phone ||
            !gmail ||
            !userId ||
            !password
        ) {

            return res.status(400).json({
                error: 'Required student fields are missing'
            });

        }


        const existing = await pool.query(
            `
            SELECT *
            FROM users
            WHERE email = $1
               OR phone = $2
               OR user_id::text = $3
            `,
            [
                gmail,
                phone,
                userId
            ]
        );


        if (existing.rows.length > 0) {

            return res.status(409).json({
                error: 'An account with this Gmail, phone or User ID already exists'
            });

        }


        const hashedPassword = await bcrypt.hash(password, 10);


        const result = await pool.query(
    `
    INSERT INTO users
    (
        user_id,
        name,
        email,
        phone,
        password_hash,
        role,
        location
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,$7)
    RETURNING user_id,name,email,phone,role,location
    `,
    [
        userId,
        name,
        gmail,
        phone,
        hashedPassword,
        'student',
        homeLocation || collegeLocation || null
    ]
);


        const user = result.rows[0];


        const token = jwt.sign(
            {
                user_id: user.user_id,
                role: 'student'
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '7d'
            }
        );


        res.status(201).json({

            message: 'Student registration successful',

            token,

            userId: user.user_id,

            isNewAccount: true,

            profile: {

                userId: user.user_id,

                name: user.name,

                gmail: user.email,

                phone: user.phone,

                gender: gender || '',

                age: age || '',

                dob: dob || '',

                college: college || '',

                branch: branch || '',

                year: year || '',

                presentStudies: presentStudies || '',

                homeLocation: homeLocation || '',

                collegeLocation: collegeLocation || '',

                location: user.location || '',

                role: 'student'

            }

        });

    } catch (error) {

        console.error('STUDENT REGISTER ERROR:', error);

        res.status(500).json({
            error: error.message
        });

    }

});


/* =========================================================
   FARMER LOGIN
   Frontend calls:
   POST /api/login/farmer
========================================================= */

router.post('/login/farmer', async (req, res) => {

    try {

        const {
            userId,
            password
        } = req.body;


        if (!userId || !password) {

            return res.status(400).json({
                error: 'User ID and password required'
            });

        }


        const user = await findAccountByLoginAndRole(userId, 'farmer');

        if (!user) {
            return res.status(401).json({
                error: 'No farmer account for this email. Create one after sign-up, or switch the login toggle to Student.'
            });
        }


        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );


        if (!passwordMatch) {

            return res.status(401).json({
                error: 'Invalid User ID or password'
            });

        }


        const token = jwt.sign(
            {
                user_id: user.user_id,
                role: 'farmer'
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '7d'
            }
        );


        res.json({

            message: 'Farmer login successful',

            token,

            profile: {
                userId: user.user_id,
                name: user.name,
                gmail: user.email,
                phone: user.phone,
                location: user.location || '',
                role: 'farmer'
            }

        });

    } catch (error) {

        console.error('FARMER LOGIN ERROR:', error);

        res.status(500).json({
            error: error.message
        });

    }

});


/* =========================================================
   STUDENT LOGIN
   Frontend calls:
   POST /api/login/student
========================================================= */

router.post('/login/student', async (req, res) => {

    try {

        const {
            userId,
            password
        } = req.body;


        if (!userId || !password) {

            return res.status(400).json({
                error: 'User ID and password required'
            });

        }


        const result = await pool.query(
            `
            SELECT *
            FROM users
            WHERE user_id::text = $1
              AND role = 'student'
            `,
            [userId]
        );


        if (result.rows.length === 0) {

            return res.status(401).json({
                error: 'Invalid User ID or password'
            });

        }


        const user = result.rows[0];


        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );


        if (!passwordMatch) {

            return res.status(401).json({
                error: 'Invalid User ID or password'
            });

        }


        const token = jwt.sign(
            {
                user_id: user.user_id,
                role: 'student'
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '7d'
            }
        );


        res.json({

            message: 'Student login successful',

            token,

            profile: {
                userId: user.user_id,
                name: user.name,
                gmail: user.email,
                phone: user.phone,
                location: user.location || '',
                role: 'student'
            }

        });

    } catch (error) {

        console.error('STUDENT LOGIN ERROR:', error);

        res.status(500).json({
            error: error.message
        });

    }

});


/* =========================================================
   UNIFIED SIGN UP (OPTION 1: Email & Password)
   POST /api/register
========================================================= */
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const cleanEmail = email.toLowerCase().trim();
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if user exists
        const existing = await pool.query(
            `SELECT * FROM users WHERE email = $1 OR gmail = $1 LIMIT 1`,
            [cleanEmail]
        );

        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = 'U-' + Math.floor(100000 + Math.random() * 900000);

        const result = await pool.query(
            `INSERT INTO users
            (user_id, email, gmail, password_hash, auth_provider, profile_completed)
            VALUES ($1, $2, $3, $4, 'local', false)
            RETURNING user_id, email, role, profile_completed`,
            [userId, cleanEmail, cleanEmail, hashedPassword]
        );

        const user = result.rows[0];
        const secret = process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026';
        const token = jwt.sign(
            { user_id: user.user_id, email: user.email },
            secret,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Registration successful',
            token,
            userId: user.user_id,
            profileCompleted: false,
            user: {
                userId: user.user_id,
                email: user.email,
                role: user.role,
                profileCompleted: false
            }
        });
    } catch (error) {
        console.error('REGISTER ERROR:', error);
        res.status(500).json({ error: error.message || 'Registration failed' });
    }
});

/* =========================================================
   UNIFIED LOGIN (OPTION 1: Email & Password)
   POST /api/login
========================================================= */
router.post('/login', async (req, res) => {
    try {
        const { email, phone, userId: inputUserId, password } = req.body;
        const loginId = (email || inputUserId || phone || '').toLowerCase().trim();

        if (!loginId || !password) {
            return res.status(400).json({ error: 'Email/User ID and password are required' });
        }

        const result = await pool.query(
            `SELECT * FROM users
             WHERE email = $1 OR gmail = $1 OR user_id = $1 OR phone = $1
             LIMIT 1`,
            [loginId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email/User ID or password' });
        }

        const user = result.rows[0];
        if (!user.password_hash) {
            return res.status(401).json({ error: 'This account uses Google Sign-In. Please tap "Continue with Google".' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid email/User ID or password' });
        }

        const secret = process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026';
        const token = jwt.sign(
            { user_id: user.user_id, role: user.role },
            secret,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            profileCompleted: user.profile_completed || false,
            profile: {
                userId: user.user_id,
                name: user.name || '',
                gmail: user.email || user.gmail,
                email: user.email || user.gmail,
                phone: user.phone || '',
                role: user.role || 'pending',
                location: user.location || '',
                profileCompleted: user.profile_completed || false
            }
        });
    } catch (error) {
        console.error('LOGIN ERROR:', error);
        res.status(500).json({ error: error.message || 'Login failed' });
    }
});

/* =========================================================
   POST-REGISTRATION PROFILE SETUP
   POST /api/profile/setup
========================================================= */
router.post('/profile/setup', async (req, res) => {
    try {
        const {
            userId,
            email,
            role,
            name,
            phone,
            gender,
            location,
            age,
            dob,
            college,
            branch,
            year,
            presentStudies,
            homeLocation,
            collegeLocation
        } = req.body;

        const targetUser = userId || email;
        if (!targetUser || !role || !name || !phone) {
            return res.status(400).json({ error: 'Role, Name, and Phone are required to complete profile setup' });
        }

        // Update main users record
        const userRes = await pool.query(
            `UPDATE users
             SET name = $1, phone = $2, role = $3, location = $4, profile_completed = true
             WHERE user_id = $5 OR email = $5 OR gmail = $5
             RETURNING *`,
            [name, phone, role, location || homeLocation || collegeLocation || '', targetUser]
        );

        if (userRes.rows.length === 0) {
            return res.status(444).json({ error: 'User account not found' });
        }

        const updatedUser = userRes.rows[0];

        // Insert into role profile table
        if (role === 'farmer') {
            await pool.query(
                `INSERT INTO farmer_profiles (user_id, user_code, name, gender, location)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location`,
                [updatedUser.id, updatedUser.user_id, name, gender || '', location || '']
            );
        } else if (role === 'student') {
            await pool.query(
                `INSERT INTO student_profiles
                 (user_id, user_code, name, age, dob, gender, college, branch, year, present_studies, home_location, college_location)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, college = EXCLUDED.college`,
                [
                    updatedUser.id,
                    updatedUser.user_id,
                    name,
                    age ? parseInt(age) : null,
                    dob || null,
                    gender || '',
                    college || '',
                    branch || '',
                    year || '',
                    presentStudies || '',
                    homeLocation || '',
                    collegeLocation || ''
                ]
            );
        }

        const secret = process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026';
        const token = jwt.sign(
            { user_id: updatedUser.user_id, role: updatedUser.role },
            secret,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Profile setup completed successfully',
            token,
            profileCompleted: true,
            profile: {
                userId: updatedUser.user_id,
                name: updatedUser.name,
                email: updatedUser.email || updatedUser.gmail,
                gmail: updatedUser.email || updatedUser.gmail,
                phone: updatedUser.phone,
                role: updatedUser.role,
                location: updatedUser.location,
                profileCompleted: true
            }
        });
    } catch (error) {
        console.error('PROFILE SETUP ERROR:', error);
        res.status(500).json({ error: error.message || 'Profile setup failed' });
    }
});


/* =========================================================
   PROTECTED PROFILE
========================================================= */

router.get(
    '/profile',
    requireAuth,
    (req, res) => {

        res.json({
            message: 'Protected route accessed successfully',
            loggedInUser: req.user
        });

    }
);


/* =========================================================
   STUDENT DASHBOARD TEST
========================================================= */

router.get(
    '/student/dashboard',
    requireAuth,
    requireRole('student'),
    (req, res) => {

        res.json({
            message: 'Welcome Student!',
            user: req.user
        });

    }
);


/* =========================================================
   GOOGLE AUTH & PASSKEY REGISTRATION
   Frontend calls:
   POST /api/auth/google
========================================================= */
router.post('/auth/google', async (req, res) => {
    try {
        const {
            email,
            name,
            googleId,
            role,
            location,
            phone,
            college,
            branch,
            year
        } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Google email is required' });
        }

        const targetRole = role || 'farmer';
        const userId = 'G-' + (googleId || Math.floor(100000 + Math.random() * 900000));
        const userEmail = email.toLowerCase().trim();

        // Check if user already exists
        let result = await pool.query(
            `SELECT * FROM users WHERE email = $1 OR gmail = $1 LIMIT 1`,
            [userEmail]
        );

        let user;
        if (result.rows.length === 0) {
            // Create user
            const newUser = await pool.query(
                `INSERT INTO users
                (user_id, name, email, gmail, phone, role, location, auth_provider, google_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'google', $8)
                RETURNING *`,
                [
                    userId,
                    name || 'Google User',
                    userEmail,
                    userEmail,
                    phone || '0000000000',
                    targetRole,
                    location || 'Not Specified',
                    googleId || userId
                ]
            );
            user = newUser.rows[0];

            // Insert into role profile table
            if (targetRole === 'farmer') {
                await pool.query(
                    `INSERT INTO farmer_profiles (user_id, name, location)
                     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                    [user.id, user.name, user.location]
                );
            } else if (targetRole === 'student') {
                await pool.query(
                    `INSERT INTO student_profiles (user_id, name, college, branch, year)
                     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
                    [user.id, user.name, college || '', branch || '', year || '']
                );
            }
        } else {
            user = result.rows[0];
        }

        const secret = process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026';
        const token = jwt.sign(
            { user_id: user.user_id, role: user.role || targetRole },
            secret,
            { expiresIn: '7d' }
        );

        res.status(200).json({
            message: 'Google Sign-In successful',
            token,
            userId: user.user_id,
            isNewAccount: result.rows.length === 0,
            profile: {
                userId: user.user_id,
                name: user.name,
                gmail: user.email || user.gmail,
                email: user.email || user.gmail,
                phone: user.phone,
                location: user.location,
                role: user.role || targetRole,
                authProvider: 'google'
            }
        });
    } catch (error) {
        console.error('GOOGLE AUTH ERROR:', error);
        res.status(500).json({ error: error.message || 'Google Auth failed' });
    }
});

console.log('✅ Auth routes registered');

module.exports = router;