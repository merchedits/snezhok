DO $migration$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN feature_not_supported OR undefined_file THEN
    -- PGlite's WebAssembly PostgreSQL intentionally ships without contrib.
    -- Real deployments fail closed instead of silently accepting slow search.
    IF version() NOT LIKE '%compiled by emcc%' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN
    CREATE INDEX messages_text_trgm_idx
      ON messages USING gin (text gin_trgm_ops)
      WHERE deleted_at IS NULL;
    CREATE INDEX attachments_filename_trgm_idx
      ON attachments USING gin (filename gin_trgm_ops);
    CREATE INDEX users_username_trgm_idx
      ON users USING gin (username gin_trgm_ops)
      WHERE deleted_at IS NULL;
    CREATE INDEX users_display_name_trgm_idx
      ON users USING gin (display_name gin_trgm_ops)
      WHERE deleted_at IS NULL;
  END IF;
END
$migration$;
