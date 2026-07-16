-- Durable delivery and bounded replay/maintenance state.

CREATE TABLE event_retention_watermarks (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  discarded_through_cursor bigint NOT NULL CHECK (discarded_through_cursor >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_delivery_outbox (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  event_name text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','expanded','delivered','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);
CREATE INDEX push_delivery_outbox_ready_idx
  ON push_delivery_outbox(available_at, id) WHERE status = 'pending';
CREATE INDEX push_delivery_outbox_expanded_idx
  ON push_delivery_outbox(id) WHERE status = 'expanded';

CREATE TABLE push_delivery_targets (
  id bigserial PRIMARY KEY,
  outbox_id bigint NOT NULL REFERENCES push_delivery_outbox(id) ON DELETE CASCADE,
  push_device_id uuid REFERENCES push_devices(id) ON DELETE SET NULL,
  expo_push_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','delivered','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, expo_push_token)
);
CREATE INDEX push_delivery_targets_ready_idx
  ON push_delivery_targets(available_at, id) WHERE status = 'pending';
CREATE INDEX push_delivery_targets_outbox_idx ON push_delivery_targets(outbox_id, status);

CREATE TABLE push_receipts (
  ticket_id text PRIMARY KEY,
  target_id bigint NOT NULL REFERENCES push_delivery_targets(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','checked','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  locked_at timestamptz,
  last_error text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_receipts_ready_idx ON push_receipts(available_at, ticket_id) WHERE status = 'pending';

CREATE TABLE stream_notification_settings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_kind text NOT NULL CHECK (stream_kind IN ('conversation','channel')),
  stream_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  show_preview boolean,
  muted_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stream_kind, stream_id)
);
CREATE INDEX stream_notification_settings_user_idx ON stream_notification_settings(user_id, updated_at DESC);
