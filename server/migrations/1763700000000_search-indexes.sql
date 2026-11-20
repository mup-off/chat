-- Up Migration
-- Trigram indexes so "contains" searches (LIKE '%q%') stay fast as users grow.
CREATE INDEX users_display_name_trgm ON users USING gin (lower(display_name) gin_trgm_ops);
CREATE INDEX users_phone_trgm ON users USING gin (phone gin_trgm_ops);

-- Down Migration
DROP INDEX IF EXISTS users_phone_trgm;
DROP INDEX IF EXISTS users_display_name_trgm;
