ALTER TABLE global_admin_settings
  ADD COLUMN feature_capabilities jsonb NOT NULL
  DEFAULT '{"uploads":true,"calls":true,"activities":true,"servers":false}'::jsonb
  CHECK (
    jsonb_typeof(feature_capabilities) = 'object'
    AND feature_capabilities ?& ARRAY['uploads','calls','activities','servers']
    AND jsonb_typeof(feature_capabilities->'uploads') = 'boolean'
    AND jsonb_typeof(feature_capabilities->'calls') = 'boolean'
    AND jsonb_typeof(feature_capabilities->'activities') = 'boolean'
    AND jsonb_typeof(feature_capabilities->'servers') = 'boolean'
  );
