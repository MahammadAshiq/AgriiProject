-- AgriLearn database schema
-- Run with: psql -U youruser -d agrilearn -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  gmail         TEXT UNIQUE NOT NULL,
  user_id       TEXT UNIQUE NOT NULL,
  phone         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS farmer_profiles (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  gender      TEXT NOT NULL,
  location    TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS student_profiles (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  age               INTEGER,
  dob               DATE,
  gender            TEXT NOT NULL,
  college           TEXT NOT NULL,
  branch            TEXT NOT NULL,
  year              TEXT NOT NULL,
  present_studies   TEXT,
  home_location     TEXT NOT NULL,
  college_location  TEXT NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(user_id)
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
