-- Up Migration
ALTER TABLE users
  ADD COLUMN avatar_key TEXT,                                          -- avatars/<userId>/<uuid>.webp
  ADD COLUMN about TEXT CHECK (char_length(about) <= 140),
  ADD COLUMN theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  ADD COLUMN wallpaper TEXT NOT NULL DEFAULT 'default'
    CHECK (wallpaper IN ('default', 'mint', 'sky', 'lavender', 'sand', 'slate'));

-- Down Migration
ALTER TABLE users DROP COLUMN wallpaper, DROP COLUMN theme, DROP COLUMN about, DROP COLUMN avatar_key;
