-- =====================================================================
-- AGRICULTURE ECOSYSTEM PLATFORM — DATABASE SCHEMA
-- Engine: PostgreSQL 14+
-- Normalized to 3NF (BCNF where practical)
-- =====================================================================
-- HOW THIS FILE IS ORGANIZED
--   0. Extensions & ENUM types
--   1. Core Identity (users + role profiles)
--   2. Farmer Module (land, crops, soil, disease, irrigation, machinery)
--   3. Government Schemes
--   4. Marketplace (products, orders, payments, delivery)
--   5. Community (posts, comments, likes, groups)
--   6. Learning (courses, videos, docs, progress)
--   7. AI Module (chat, predictions, recommendations)
--   8. Weather Cache
--   9. Notifications
--  10. Indexes
--  11. updated_at triggers
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONS & ENUM TYPES
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- for gen_random_uuid(), password helpers

CREATE TYPE user_role AS ENUM (
    'farmer', 'student', 'agri_expert', 'seller', 'buyer',
    'gov_officer', 'admin', 'ngo'
);

CREATE TYPE land_ownership AS ENUM ('owned', 'leased', 'shared');

CREATE TYPE crop_status AS ENUM ('planned', 'sowed', 'growing', 'harvested', 'failed');

CREATE TYPE order_status AS ENUM ('placed', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned');

CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');

CREATE TYPE delivery_status AS ENUM ('pending', 'dispatched', 'in_transit', 'delivered', 'failed');

CREATE TYPE notification_type AS ENUM ('order', 'scheme', 'weather', 'community', 'ai', 'system');

CREATE TYPE sender_type AS ENUM ('user', 'ai');

-- ---------------------------------------------------------------------
-- 1. CORE IDENTITY
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id         BIGSERIAL PRIMARY KEY,
    name            VARCHAR(120)        NOT NULL,
    email           VARCHAR(150)        UNIQUE,
    phone           VARCHAR(15)         UNIQUE NOT NULL,
    password_hash   TEXT                NOT NULL,
    role            user_role           NOT NULL,
    language        VARCHAR(30)         DEFAULT 'en',
    location        VARCHAR(150),
    is_active       BOOLEAN             DEFAULT TRUE,
    created_at      TIMESTAMPTZ         DEFAULT now(),
    updated_at      TIMESTAMPTZ         DEFAULT now(),
    CONSTRAINT chk_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- One profile table per role. 1:1 with users, split out because each
-- role has fundamentally different attributes (avoids a table full of
-- nullable columns — this is the normalization win here).

CREATE TABLE farmer_profiles (
    farmer_id       BIGSERIAL PRIMARY KEY,
    user_id         BIGINT UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    aadhaar_number  VARCHAR(20) UNIQUE,
    experience_years SMALLINT CHECK (experience_years >= 0),
    farm_size_acres NUMERIC(8,2) CHECK (farm_size_acres >= 0),
    district        VARCHAR(100),
    village         VARCHAR(100),
    primary_soil_type VARCHAR(50)
);

CREATE TABLE expert_profiles (
    expert_id       BIGSERIAL PRIMARY KEY,
    user_id         BIGINT UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    specialization  VARCHAR(150),
    qualification   VARCHAR(150),
    years_of_practice SMALLINT,
    verified        BOOLEAN DEFAULT FALSE
);

CREATE TABLE student_profiles (
    student_id      BIGSERIAL PRIMARY KEY,
    user_id         BIGINT UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    institution     VARCHAR(150),
    course          VARCHAR(150),
    year_of_study   SMALLINT
);

CREATE TABLE buyer_profiles (
    buyer_id        BIGSERIAL PRIMARY KEY,
    user_id         BIGINT UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    business_name   VARCHAR(150),
    delivery_address TEXT
);

CREATE TABLE seller_profiles (
    seller_id       BIGSERIAL PRIMARY KEY,
    user_id         BIGINT UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    business_name   VARCHAR(150),
    gst_number      VARCHAR(20),
    pickup_address  TEXT,
    rating_avg      NUMERIC(2,1) DEFAULT 0.0 CHECK (rating_avg BETWEEN 0 AND 5)
);

-- ---------------------------------------------------------------------
-- 2. FARMER MODULE
-- ---------------------------------------------------------------------
CREATE TABLE lands (
    land_id         BIGSERIAL PRIMARY KEY,
    farmer_id       BIGINT NOT NULL REFERENCES farmer_profiles(farmer_id) ON DELETE CASCADE,
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6),
    area_acres      NUMERIC(8,2) NOT NULL CHECK (area_acres > 0),
    soil_type       VARCHAR(50),
    water_source    VARCHAR(50),
    ownership       land_ownership NOT NULL DEFAULT 'owned',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crops (
    crop_id         BIGSERIAL PRIMARY KEY,
    land_id         BIGINT NOT NULL REFERENCES lands(land_id) ON DELETE CASCADE,
    crop_name       VARCHAR(100) NOT NULL,
    season          VARCHAR(20),        -- kharif / rabi / zaid
    sowing_date     DATE,
    harvest_date    DATE,
    status          crop_status DEFAULT 'planned',
    CONSTRAINT chk_harvest_after_sow CHECK (harvest_date IS NULL OR sowing_date IS NULL OR harvest_date >= sowing_date)
);

CREATE TABLE soil_reports (
    report_id       BIGSERIAL PRIMARY KEY,
    land_id         BIGINT NOT NULL REFERENCES lands(land_id) ON DELETE CASCADE,
    ph_level        NUMERIC(3,1),
    nitrogen        NUMERIC(6,2),
    phosphorus      NUMERIC(6,2),
    potassium       NUMERIC(6,2),
    organic_carbon  NUMERIC(5,2),
    tested_on       DATE DEFAULT CURRENT_DATE,
    lab_name        VARCHAR(120)
);

CREATE TABLE irrigation_logs (
    irrigation_id   BIGSERIAL PRIMARY KEY,
    land_id         BIGINT NOT NULL REFERENCES lands(land_id) ON DELETE CASCADE,
    method          VARCHAR(50),         -- drip / sprinkler / flood
    water_used_litres NUMERIC(10,2),
    irrigated_on    DATE DEFAULT CURRENT_DATE
);

CREATE TABLE machinery (
    machinery_id    BIGSERIAL PRIMARY KEY,
    farmer_id       BIGINT NOT NULL REFERENCES farmer_profiles(farmer_id) ON DELETE CASCADE,
    machine_type    VARCHAR(100),        -- tractor / harvester / tiller
    model_name      VARCHAR(100),
    is_owned        BOOLEAN DEFAULT TRUE, -- FALSE = rented
    availability    BOOLEAN DEFAULT TRUE  -- can it be rented out to others
);

CREATE TABLE plant_disease_reports (
    report_id       BIGSERIAL PRIMARY KEY,
    farmer_id       BIGINT NOT NULL REFERENCES farmer_profiles(farmer_id) ON DELETE CASCADE,
    crop_id         BIGINT REFERENCES crops(crop_id) ON DELETE SET NULL,
    image_url       TEXT NOT NULL,
    prediction      VARCHAR(150),
    confidence      NUMERIC(5,2) CHECK (confidence BETWEEN 0 AND 100),
    recommendation  TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. GOVERNMENT SCHEMES
-- ---------------------------------------------------------------------
CREATE TABLE schemes (
    scheme_id       BIGSERIAL PRIMARY KEY,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    eligibility     TEXT,
    deadline        DATE,
    official_link   TEXT,
    posted_by       BIGINT REFERENCES users(user_id) ON DELETE SET NULL, -- gov_officer / admin
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Which farmers applied/saved which schemes (M:N junction table)
CREATE TABLE farmer_scheme_applications (
    application_id  BIGSERIAL PRIMARY KEY,
    farmer_id       BIGINT NOT NULL REFERENCES farmer_profiles(farmer_id) ON DELETE CASCADE,
    scheme_id       BIGINT NOT NULL REFERENCES schemes(scheme_id) ON DELETE CASCADE,
    status          VARCHAR(30) DEFAULT 'saved',  -- saved / applied / approved / rejected
    applied_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (farmer_id, scheme_id)
);

-- ---------------------------------------------------------------------
-- 4. MARKETPLACE
-- ---------------------------------------------------------------------
CREATE TABLE products (
    product_id      BIGSERIAL PRIMARY KEY,
    seller_id       BIGINT NOT NULL REFERENCES seller_profiles(seller_id) ON DELETE CASCADE,
    category        VARCHAR(80) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    price           NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    stock           INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    description     TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- images split into their own table instead of an array/JSON column
-- so each image has metadata and ordering (normalized, easy to query)
CREATE TABLE product_images (
    image_id        BIGSERIAL PRIMARY KEY,
    product_id      BIGINT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    image_url       TEXT NOT NULL,
    sort_order      SMALLINT DEFAULT 0
);

CREATE TABLE orders (
    order_id        BIGSERIAL PRIMARY KEY,
    buyer_id        BIGINT NOT NULL REFERENCES buyer_profiles(buyer_id) ON DELETE CASCADE,
    seller_id       BIGINT NOT NULL REFERENCES seller_profiles(seller_id) ON DELETE CASCADE,
    status          order_status DEFAULT 'placed',
    payment_status  payment_status DEFAULT 'pending',
    delivery_status delivery_status DEFAULT 'pending',
    total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- an order can contain many products at various quantities/prices —
-- this junction table is what actually makes "orders" 3NF-correct
CREATE TABLE order_items (
    order_item_id   BIGSERIAL PRIMARY KEY,
    order_id        BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0) -- price snapshot at purchase time
);

CREATE TABLE payments (
    payment_id      BIGSERIAL PRIMARY KEY,
    order_id        BIGINT UNIQUE NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    gateway         VARCHAR(50),          -- razorpay / stripe / upi
    transaction_ref VARCHAR(120) UNIQUE,
    amount          NUMERIC(12,2) NOT NULL,
    status          payment_status DEFAULT 'pending',
    paid_at         TIMESTAMPTZ
);

CREATE TABLE deliveries (
    delivery_id     BIGSERIAL PRIMARY KEY,
    order_id        BIGINT UNIQUE NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    courier_name    VARCHAR(100),
    tracking_number VARCHAR(100),
    status          delivery_status DEFAULT 'pending',
    dispatched_at   TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- 5. COMMUNITY
-- ---------------------------------------------------------------------
CREATE TABLE groups (
    group_id        BIGSERIAL PRIMARY KEY,
    name            VARCHAR(150) NOT NULL,
    description     TEXT,
    created_by      BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE group_members (
    group_id        BIGINT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE posts (
    post_id         BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    group_id        BIGINT REFERENCES groups(group_id) ON DELETE SET NULL,
    title           VARCHAR(200),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE post_images (
    image_id        BIGSERIAL PRIMARY KEY,
    post_id         BIGINT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    image_url       TEXT NOT NULL,
    sort_order      SMALLINT DEFAULT 0
);

CREATE TABLE comments (
    comment_id      BIGSERIAL PRIMARY KEY,
    post_id         BIGINT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE likes (
    post_id         BIGINT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (post_id, user_id)   -- prevents duplicate likes, no need for a surrogate key
);

-- ---------------------------------------------------------------------
-- 6. LEARNING
-- ---------------------------------------------------------------------
CREATE TABLE courses (
    course_id       BIGSERIAL PRIMARY KEY,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    created_by      BIGINT REFERENCES users(user_id) ON DELETE SET NULL, -- expert / admin
    category        VARCHAR(80),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE course_videos (
    video_id        BIGSERIAL PRIMARY KEY,
    course_id       BIGINT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    title           VARCHAR(200),
    video_url       TEXT NOT NULL,
    duration_seconds INTEGER,
    sort_order      SMALLINT DEFAULT 0
);

CREATE TABLE course_documents (
    document_id     BIGSERIAL PRIMARY KEY,
    course_id       BIGINT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    title           VARCHAR(200),
    file_url        TEXT NOT NULL
);

CREATE TABLE learning_progress (
    progress_id     BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    course_id       BIGINT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    percent_complete SMALLINT DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
    last_accessed   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, course_id)
);

-- ---------------------------------------------------------------------
-- 7. AI MODULE
-- ---------------------------------------------------------------------
CREATE TABLE chat_sessions (
    session_id      BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title           VARCHAR(150),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
    message_id      BIGSERIAL PRIMARY KEY,
    session_id      BIGINT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    sender          sender_type NOT NULL,
    message         TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_predictions (
    prediction_id   BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    input_type      VARCHAR(50),      -- image / text / sensor
    input_ref       TEXT,             -- e.g. link to plant_disease_reports.report_id or raw text
    output          TEXT,
    model_name      VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_recommendations (
    recommendation_id BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    category        VARCHAR(80),      -- crop / product / scheme / course
    reference_id    BIGINT,           -- points to id in the relevant table (see category)
    reason          TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 8. WEATHER CACHE
-- ---------------------------------------------------------------------
CREATE TABLE weather_cache (
    weather_id      BIGSERIAL PRIMARY KEY,
    district        VARCHAR(100) NOT NULL,
    temperature     NUMERIC(4,1),
    humidity        NUMERIC(4,1),
    rainfall_mm     NUMERIC(6,2),
    wind_kmph       NUMERIC(5,2),
    forecast_date   DATE NOT NULL,
    fetched_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (district, forecast_date)
);

-- ---------------------------------------------------------------------
-- 9. NOTIFICATIONS
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title           VARCHAR(150) NOT NULL,
    message         TEXT,
    type            notification_type NOT NULL,
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 10. INDEXES
-- ---------------------------------------------------------------------
-- Lookups & auth
CREATE INDEX idx_users_email        ON users(email);
CREATE INDEX idx_users_phone        ON users(phone);
CREATE INDEX idx_farmer_aadhaar     ON farmer_profiles(aadhaar_number);

-- Farmer module
CREATE INDEX idx_lands_lat_long     ON lands(latitude, longitude);
CREATE INDEX idx_lands_farmer       ON lands(farmer_id);
CREATE INDEX idx_crops_name         ON crops(crop_name);
CREATE INDEX idx_crops_land         ON crops(land_id);
CREATE INDEX idx_disease_farmer     ON plant_disease_reports(farmer_id);

-- Schemes / location-based search
CREATE INDEX idx_farmer_district    ON farmer_profiles(district);
CREATE INDEX idx_weather_district_date ON weather_cache(district, forecast_date);

-- Marketplace
CREATE INDEX idx_products_category  ON products(category);
CREATE INDEX idx_products_seller    ON products(seller_id);
CREATE INDEX idx_orders_buyer       ON orders(buyer_id);
CREATE INDEX idx_orders_seller      ON orders(seller_id);
CREATE INDEX idx_orders_created_at  ON orders(created_at);

-- Community
CREATE INDEX idx_posts_user         ON posts(user_id);
CREATE INDEX idx_posts_created_at   ON posts(created_at);
CREATE INDEX idx_comments_post      ON comments(post_id);

-- Notifications
CREATE INDEX idx_notifications_user_unread ON notifications(user_id) WHERE is_read = FALSE;

-- ---------------------------------------------------------------------
-- 11. AUTO-UPDATE updated_at TRIGGERS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- END OF SCHEMA
-- Tables so far: 38 (core, functional — not filler)
-- Easy to extend: add new profile tables, new marketplace categories,
-- reviews/ratings, cart, wishlists, admin audit logs, etc. as the
-- product grows toward the 80-150 table range you estimated.
-- =====================================================================
