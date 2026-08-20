CREATE TABLE client_diagnostic_events (
  event_hash text PRIMARY KEY CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_diagnostic_events_received_idx
  ON client_diagnostic_events(received_at);

CREATE TABLE client_diagnostic_aggregates (
  bucket_date date NOT NULL,
  app_version varchar(32) NOT NULL,
  version_code integer NOT NULL CHECK (version_code > 0),
  os_version varchar(32) NOT NULL,
  device varchar(80) NOT NULL,
  category varchar(48) NOT NULL,
  level varchar(8) NOT NULL CHECK (level IN ('debug','info','warn','error')),
  event_name varchar(240) NOT NULL,
  signature text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$'),
  occurrences bigint NOT NULL DEFAULT 0 CHECK (occurrences >= 0),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  max_duration_ms double precision,
  PRIMARY KEY (bucket_date,app_version,version_code,os_version,device,signature)
);

CREATE INDEX client_diagnostic_aggregates_recent_idx
  ON client_diagnostic_aggregates(last_seen_at DESC)
  WHERE level IN ('warn','error');
