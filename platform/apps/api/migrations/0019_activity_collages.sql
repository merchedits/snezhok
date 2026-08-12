ALTER TABLE attachments ALTER COLUMN blob_id DROP NOT NULL;

ALTER TABLE media_jobs
  ADD COLUMN operation text NOT NULL DEFAULT 'standard' CHECK (operation IN ('standard','color-collage')),
  ADD COLUMN source_attachment_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE media_jobs ADD CONSTRAINT media_jobs_operation_sources_check CHECK (
  (operation='standard' AND cardinality(source_attachment_ids)=0)
  OR (operation='color-collage' AND cardinality(source_attachment_ids)=9)
);
