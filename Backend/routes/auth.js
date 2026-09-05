const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { sendResetEmail, sendWelcomeEmail } = require('../utils/mailer');

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
            WHERE lower(email) = lower($1)
               OR lower(COALESCE(gmail, '')) = lower($1)
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
            const existingUser = existing.rows[0];
            if (existingUser.is_active === false) {
                // ACCOUNT WAS DELETED: REACTIVATE!
                const hashedPassword = await bcrypt.hash(password, 10);
                const reactivated = await pool.query(
                    `UPDATE users
                     SET is_active = true,
                         password_hash = $1,
                         name = COALESCE(NULLIF($2, ''), name),
                         role = 'farmer',
                         phone = COALESCE(NULLIF($3, ''), phone),
                         location = COALESCE($4, location),
                         updated_at = NOW()
                     WHERE user_id = $5
                     RETURNING user_id, name, email, phone, role, location`,
                    [hashedPassword, name, phone, location || null, existingUser.user_id]
                );
                const user = reactivated.rows[0];
                const token = jwt.sign(
                    {
                        user_id: user.user_id,
                        role: 'farmer'
                    },
                    process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026',
                    {
                        expiresIn: '7d'
                    }
                );

                // Send automated welcome email to Farmer upon re-registration
                sendWelcomeEmail({
                    toEmail: user.email,
                    name: user.name,
                    role: 'farmer'
                }).catch(err => console.error('Failed to send farmer welcome email on reactivation:', err.message));

                return res.status(201).json({
                    message: 'Account reactivated successfully. Welcome back!',
                    token,
                    userId: user.user_id,
                    isNewAccount: false,
                    isReactivated: true,
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
            }

            return res.status(409).json({
                error: 'An account with this Gmail, phone or User ID already exists'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

       const result = await pool.query(
    `
    INSERT INTO users
    (
        name,
        email,
        gmail,
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
        name,
        gmail,
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

        // Send automated welcome email to Farmer upon registration (non-blocking)
        sendWelcomeEmail({
            toEmail: user.email,
            name: user.name,
            role: 'farmer'
        }).catch(err => console.error('Failed to send farmer welcome email:', err.message));

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
            WHERE lower(email) = lower($1)
               OR lower(COALESCE(gmail, '')) = lower($1)
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
            const existingUser = existing.rows[0];
            if (existingUser.is_active === false) {
                // ACCOUNT WAS DELETED: REACTIVATE!
                const hashedPassword = await bcrypt.hash(password, 10);
                const reactivated = await pool.query(
                    `UPDATE users
                     SET is_active = true,
                         password_hash = $1,
                         name = COALESCE(NULLIF($2, ''), name),
                         role = 'student',
                         phone = COALESCE(NULLIF($3, ''), phone),
                         location = COALESCE($4, location),
                         updated_at = NOW()
                     WHERE user_id = $5
                     RETURNING user_id, name, email, phone, role, location`,
                    [hashedPassword, name, phone, homeLocation || collegeLocation || null, existingUser.user_id]
                );
                const user = reactivated.rows[0];
                const token = jwt.sign(
                    {
                        user_id: user.user_id,
                        role: 'student'
                    },
                    process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026',
                    {
                        expiresIn: '7d'
                    }
                );

                // Send automated welcome email to Student upon re-registration / reactivation
                sendWelcomeEmail({
                    toEmail: user.email,
                    name: user.name,
                    role: 'student'
                }).catch(err => console.error('Failed to send student welcome email on reactivation:', err.message));

                return res.status(201).json({
                    message: 'Account reactivated successfully. Welcome back!',
                    token,
                    userId: user.user_id,
                    isNewAccount: false,
                    isReactivated: true,
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
            }

            return res.status(409).json({
                error: 'An account with this Gmail, phone or User ID already exists'
            });
        }


        const hashedPassword = await bcrypt.hash(password, 10);


        const result = await pool.query(
    `
    INSERT INTO users
    (
        name,
        email,
        gmail,
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
        name,
        gmail,
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

        // Send automated welcome email to Student upon registration (non-blocking)
        sendWelcomeEmail({
            toEmail: user.email,
            name: user.name,
            role: 'student'
        }).catch(err => console.error('Failed to send student welcome email:', err.message));

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

        if (user.is_active === false) {
            return res.status(403).json({
                error: 'This account was deleted. Please create an account again with this Gmail to reactivate your account.',
                isInactive: true
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


        const token = signToken(user);


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


        const user = await findAccountByLoginAndRole(userId, 'student');

        if (!user) {
            return res.status(401).json({
                error: 'Invalid User ID or password'
            });
        }

        if (user.is_active === false) {
            return res.status(403).json({
                error: 'This account was deleted. Please create an account again with this Gmail to reactivate your account.',
                isInactive: true
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


        const token = signToken(user);


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
        const { email, password, name, role } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const cleanEmail = email.toLowerCase().trim();
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if user exists
        const existing = await pool.query(
            `SELECT * FROM users WHERE lower(email) = $1 OR lower(COALESCE(gmail, '')) = $1 LIMIT 1`,
            [cleanEmail]
        );

        if (existing.rows.length > 0) {
            const existingUser = existing.rows[0];
            if (existingUser.is_active === false) {
                // ACCOUNT WAS DELETED: REACTIVATE!
                const targetRole = (role === 'student' || role === 'farmer') ? role : (existingUser.role || 'farmer');
                const hashedPassword = await bcrypt.hash(password, 10);
                const displayName = (name || '').trim();

                const reactivated = await pool.query(
                    `UPDATE users
                     SET is_active = true,
                         password_hash = $1,
                         name = COALESCE(NULLIF($2, ''), name),
                         role = $3,
                         updated_at = NOW()
                     WHERE user_id = $4
                     RETURNING user_id, name, email, role, profile_completed`,
                    [hashedPassword, displayName, targetRole, existingUser.user_id]
                );
                const user = reactivated.rows[0];
                const secret = process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026';
                const token = jwt.sign(
                    { user_id: user.user_id, email: user.email, role: user.role },
                    secret,
                    { expiresIn: '7d' }
                );

                // Send automated welcome email to user upon re-registration (non-blocking)
                sendWelcomeEmail({
                    toEmail: user.email,
                    name: user.name || displayName,
                    role: targetRole
                }).catch(err => console.error('Failed to send welcome email on reactivation:', err.message));

                return res.status(201).json({
                    message: 'Account reactivated successfully. Welcome back!',
                    token,
                    userId: user.user_id,
                    profileCompleted: user.profile_completed || false,
                    emailSent: true,
                    isReactivated: true,
                    user: {
                        userId: user.user_id,
                        name: user.name,
                        email: user.email,
                        role: user.role,
                        profileCompleted: user.profile_completed || false
                    }
                });
            }

            return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });
        }

        const targetRole = (role === 'student' || role === 'farmer') ? role : 'farmer';
        const hashedPassword = await bcrypt.hash(password, 10);
        const displayName = (name || '').trim();

        const result = await pool.query(
            `INSERT INTO users
            (name, email, gmail, password_hash, role, auth_provider, profile_completed)
            VALUES ($1, $2, $3, $4, $5, 'local', false)
            RETURNING user_id, name, email, role, profile_completed`,
            [displayName || cleanEmail.split('@')[0], cleanEmail, cleanEmail, hashedPassword, targetRole]
        );

        const user = result.rows[0];
        const secret = process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026';
        const token = jwt.sign(
            { user_id: user.user_id, email: user.email, role: user.role },
            secret,
            { expiresIn: '7d' }
        );

        // Send automated welcome email to user upon registration (non-blocking)
        sendWelcomeEmail({
            toEmail: user.email,
            name: user.name || displayName,
            role: targetRole
        }).catch(err => console.error('Failed to send welcome email:', err.message));

        res.status(201).json({
            message: 'Registration successful',
            token,
            userId: user.user_id,
            profileCompleted: false,
            emailSent: true,
            user: {
                userId: user.user_id,
                name: user.name,
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
             WHERE email = $1 OR gmail = $1 OR user_id::text = $1 OR phone = $1
             LIMIT 1`,
            [loginId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email/User ID or password' });
        }

        const user = result.rows[0];

        if (user.is_active === false) {
            return res.status(403).json({
                error: 'This account was deleted. Please create an account again with this Gmail to reactivate your account.',
                isInactive: true
            });
        }

        if (!user.password_hash) {
            return res.status(401).json({ error: 'This account uses Google Sign-In. Please tap "Continue with Google".' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid email/User ID or password' });
        }

        const token = signToken(user);

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
             WHERE user_id::text = $5 OR email = $5 OR gmail = $5
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
   CHECK ACCOUNT STATUS
   GET /api/account/status?email=...
   Provides instant live database status check for any account
========================================================= */
router.get('/account/status', async (req, res) => {
    try {
        const rawId = (req.query.email || req.query.gmail || req.query.identifier || req.query.userId || req.query.id || '').trim();
        if (!rawId) {
            return res.status(400).json({
                error: 'Email or identifier is required in query parameter (e.g. /api/account/status?email=you@gmail.com)'
            });
        }

        const cleanId = rawId.toLowerCase();
        const result = await pool.query(
            `SELECT user_id, name, email, gmail, role, is_active, updated_at, created_at
             FROM users
             WHERE lower(email) = $1
                OR lower(COALESCE(gmail, '')) = $1
                OR user_id::text = $2
             ORDER BY updated_at DESC
             LIMIT 1`,
            [cleanId, rawId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                exists: false,
                message: `No account found in database for "${rawId}".`
            });
        }

        const u = result.rows[0];
        const isActive = u.is_active !== false;

        res.json({
            exists: true,
            userId: u.user_id,
            name: u.name || '',
            email: u.email || u.gmail,
            role: u.role,
            isActive: isActive,
            status: isActive ? 'ACTIVE' : 'DELETED (INACTIVE)',
            message: isActive
                ? 'Account is active. Normal login and dashboard access are enabled.'
                : 'Account has been deleted. You can reactivate anytime by registering again with this same Gmail.',
            updatedAt: u.updated_at,
            createdAt: u.created_at
        });
    } catch (error) {
        console.error('ACCOUNT STATUS CHECK ERROR:', error);
        res.status(500).json({ error: error.message || 'Failed to check account status' });
    }
});

/* =========================================================
   DELETE ACCOUNT (SOFT DELETE)
   POST /api/account/delete
   Marks user as is_active = false in the database without deleting rows.
========================================================= */
router.post('/account/delete', async (req, res) => {
    try {
        let tokenUserId = null;
        let tokenEmail = null;

        // Extract from authorization token if present
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const secret = process.env.JWT_SECRET || 'agrilearn_jwt_secret_key_2026';
                const decoded = jwt.verify(token, secret);
                tokenUserId = decoded.user_id;
                tokenEmail = decoded.email;
            } catch (jwtErr) {
                // Token error; fall back to body
            }
        }

        const bodyEmail = (req.body && (req.body.email || req.body.gmail) ? String(req.body.email || req.body.gmail) : '').toLowerCase().trim();
        const bodyUserId = req.body && (req.body.userId || req.body.user_id) ? String(req.body.userId || req.body.user_id).trim() : null;

        const cleanEmail = (tokenEmail || bodyEmail || '').toLowerCase().trim();
        const cleanUserId = tokenUserId ? String(tokenUserId).trim() : bodyUserId;

        if (!cleanEmail && !cleanUserId) {
            return res.status(400).json({ error: 'User email or ID required to delete account' });
        }

        let result;
        if (cleanEmail && cleanUserId) {
            result = await pool.query(
                `UPDATE users
                 SET is_active = false, updated_at = NOW()
                 WHERE user_id::text = $1 OR lower(email) = $2 OR lower(COALESCE(gmail, '')) = $2
                 RETURNING user_id, email, role, is_active`,
                [cleanUserId, cleanEmail]
            );
        } else if (cleanEmail) {
            result = await pool.query(
                `UPDATE users
                 SET is_active = false, updated_at = NOW()
                 WHERE lower(email) = $1 OR lower(COALESCE(gmail, '')) = $1
                 RETURNING user_id, email, role, is_active`,
                [cleanEmail]
            );
        } else {
            result = await pool.query(
                `UPDATE users
                 SET is_active = false, updated_at = NOW()
                 WHERE user_id::text = $1
                 RETURNING user_id, email, role, is_active`,
                [cleanUserId]
            );
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found to delete' });
        }

        const deletedUser = result.rows[0];
        console.log(`🗑️ Account soft-deleted (is_active = false): user_id=${deletedUser.user_id}, email=${deletedUser.email}, role=${deletedUser.role}`);

        res.json({
            success: true,
            message: 'Account has been deleted successfully. You can reactivate anytime by creating an account again with this Gmail.',
            user: {
                userId: deletedUser.user_id,
                email: deletedUser.email,
                role: deletedUser.role,
                isActive: deletedUser.is_active
            }
        });
    } catch (error) {
        console.error('DELETE ACCOUNT ERROR:', error);
        res.status(500).json({ error: error.message || 'Failed to delete account' });
    }
});


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

        const targetRole = (role === 'student' || role === 'farmer') ? role : 'farmer';
        const userEmail = email.toLowerCase().trim();

        // Check if user already exists
        let result = await pool.query(
            `SELECT * FROM users WHERE email = $1 OR gmail = $1 LIMIT 1`,
            [userEmail]
        );

        let user;
        const isNew = result.rows.length === 0;
        if (isNew) {
            // Create user
            const newUser = await pool.query(
                `INSERT INTO users
                (name, email, gmail, phone, role, location, auth_provider, google_id)
                VALUES ($1, $2, $3, $4, $5, $6, 'google', $7)
                RETURNING *`,
                [
                    name || 'Google User',
                    userEmail,
                    userEmail,
                    phone || '0000000000',
                    targetRole,
                    location || 'Not Specified',
                    String(googleId || '')
                ]
            );
            user = newUser.rows[0];

            // Optional role profile record
            try {
                if (targetRole === 'farmer') {
                    await pool.query(
                        `INSERT INTO farmer_profiles (user_id)
                         VALUES ($1) ON CONFLICT DO NOTHING`,
                        [user.user_id]
                    );
                } else if (targetRole === 'student') {
                    await pool.query(
                        `INSERT INTO student_profiles (user_id, institution, course)
                         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                        [user.user_id, college || '', branch || '']
                    );
                }
            } catch (profileErr) {
                console.warn('Profile table insert notice:', profileErr.message);
            }

            // Send automated welcome email for NEW Google registrations only (non-blocking)
            sendWelcomeEmail({
                toEmail: userEmail,
                name: user.name,
                role: targetRole
            }).catch(err => console.error('Failed to send Google welcome email:', err.message));
        } else {
            user = result.rows[0];
            if (user.is_active === false) {
                // ACCOUNT WAS DELETED: REACTIVATE!
                await pool.query(
                    `UPDATE users SET is_active = true, updated_at = NOW() WHERE user_id = $1`,
                    [user.user_id]
                );
                user.is_active = true;
                // Send automated welcome email on reactivation
                sendWelcomeEmail({
                    toEmail: userEmail,
                    name: user.name,
                    role: user.role || targetRole
                }).catch(err => console.error('Failed to send Google welcome email on reactivation:', err.message));
            }
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

// =====================================================
// FORGOT PASSWORD - Request OTP Code
// POST /api/forgot-password
// =====================================================
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const clean = String(email || '').toLowerCase().trim();

        if (!clean) {
            return res.status(400).json({ error: 'Email address is required' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        try {
            await pool.query(
                `INSERT INTO otp_codes (phone, code, purpose, expires_at)
                 VALUES ($1, $2, 'password_reset', NOW() + INTERVAL '10 minutes')`,
                [clean, otp]
            );
        } catch (dbErr) {
            console.warn('Could not store reset OTP in db:', dbErr.message);
        }

        console.log(`🔑 Password Reset Code for ${clean}: ${otp}`);

        const resetLink = `http://localhost:4000/login.html?reset_email=${encodeURIComponent(clean)}&code=${otp}`;
        const emailResult = await sendResetEmail(clean, resetLink);

        res.json({
            success: true,
            message: `Reset link sent to ${clean}`,
            devOtp: otp,
            previewUrl: emailResult.previewUrl
        });
    } catch (err) {
        console.error('FORGOT PASSWORD ERROR:', err);
        res.status(500).json({ error: 'Failed to process password reset' });
    }
});

// =====================================================
// RESET PASSWORD - Apply New Password
// POST /api/reset-password
// =====================================================
router.post('/reset-password', async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        const clean = String(email || '').toLowerCase().trim();

        if (!clean || !newPassword) {
            return res.status(400).json({ error: 'Email and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        try {
            await pool.query(
                `UPDATE users SET password = $1, password_hash = $1 WHERE lower(email) = $2 OR lower(COALESCE(gmail, '')) = $2`,
                [hashedPassword, clean]
            );
        } catch (dbErr) {
            console.warn('Database update fallback:', dbErr.message);
        }

        res.json({
            success: true,
            message: 'Password reset successfully. You can now log in.'
        });
    } catch (err) {
        console.error('RESET PASSWORD ERROR:', err);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

console.log('✅ Auth routes registered');

module.exports = router;