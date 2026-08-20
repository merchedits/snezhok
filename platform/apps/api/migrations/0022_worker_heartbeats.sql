CREATE TABLE worker_heartbeats (
  worker_name text PRIMARY KEY CHECK (length(worker_name) BETWEEN 1 AND 80),
  instance_id text NOT NULL CHECK (length(instance_id) BETWEEN 1 AND 160),
  source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 64),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
