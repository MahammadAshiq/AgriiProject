-- AgriLearn database schema
-- Run with: psql -U youruser -d agrilearn -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  user_id           TEXT UNIQUE NOT NULL,
  name              TEXT,
  email             TEXT NOT NULL,
  gmail             TEXT,
  phone             TEXT,
  password_hash     TEXT,
  role              TEXT DEFAULT 'pending',
  location          TEXT,
  auth_provider     TEXT DEFAULT 'local',
  google_id         TEXT,
  profile_completed BOOLEAN DEFAULT false,
  created_at        TIMESTAMP NOT NULL DEFAULT now()
);

-- Same Gmail may have one farmer row and one student row
CREATE UNIQUE INDEX IF NOT EXISTS users_email_role_uidx
  ON users (lower(email), COALESCE(role, 'pending'));

CREATE TABLE IF NOT EXISTS farmer_profiles (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user_code   TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  gender      TEXT,
  location    TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_profiles (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user_code         TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  age               INTEGER,
  dob               DATE,
  gender            TEXT,
  college           TEXT,
  branch            TEXT,
  year              TEXT,
  present_studies   TEXT,
  home_location     TEXT,
  college_location  TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT now()
);

-- One-time codes used for both registration verification and password reset
CREATE TABLE IF NOT EXISTS otp_codes (
  id          SERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('register', 'reset')),
  verified    BOOLEAN NOT NULL DEFAULT false,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_codes(phone, purpose);

-- Simple admin accounts (kept separate from farmer/student users on purpose)
CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

