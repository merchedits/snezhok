import { pool } from "../db/pool.js";

interface IntegrityCounts {
  invalidMessageAttachmentShapes: number;
  readyAttachmentsWithoutBlob: number;
  attachmentBlobByteMismatches: number;
  failedLinkedAttachments: number;
  staleProcessingAttachments: number;
  staleMediaJobs: number;
}

async function count(sql: string): Promise<number> {
  const result = await pool.query<{ count: number }>(sql);
  return result.rows[0]?.count ?? 0;
}

try {
  const [
    invalidMessageAttachmentShapes,
    readyAttachmentsWithoutBlob,
    attachmentBlobByteMismatches,
    failedLinkedAttachments,
    staleProcessingAttachments,
    staleMediaJobs,
  ] = await Promise.all([
    count("SELECT count(*)::integer count FROM invalid_message_attachment_shapes"),
    count("SELECT count(*)::integer count FROM attachments a LEFT JOIN blobs b ON b.id=a.blob_id WHERE a.status='ready' AND b.id IS NULL"),
    count("SELECT count(*)::integer count FROM attachments a JOIN blobs b ON b.id=a.blob_id WHERE a.status='ready' AND a.bytes<>b.bytes"),
    count("SELECT count(*)::integer count FROM message_attachments ma JOIN attachments a ON a.id=ma.attachment_id WHERE a.status='failed'"),
    count("SELECT count(*)::integer count FROM attachments WHERE status='processing' AND updated_at<now()-interval '30 minutes'"),
    count("SELECT count(*)::integer count FROM media_jobs WHERE (status='pending' AND available_at<now()-interval '30 minutes') OR (status='running' AND coalesce(heartbeat_at,updated_at)<now()-interval '10 minutes')"),
  ]);
  const report: IntegrityCounts = {
    invalidMessageAttachmentShapes,
    readyAttachmentsWithoutBlob,
    attachmentBlobByteMismatches,
    failedLinkedAttachments,
    staleProcessingAttachments,
    staleMediaJobs,
  };
  console.log(JSON.stringify(report));
  if (invalidMessageAttachmentShapes > 0 || readyAttachmentsWithoutBlob > 0 || attachmentBlobByteMismatches > 0) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
