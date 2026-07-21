import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("media mirror retention starts when an object disappears", async () => {
  const script = await read("./sync-encrypted-media.sh");
  assert.match(script, /MEDIA_MIRROR_DELETE_GRACE_DAYS[^\n]+52/);
  assert.match(script, /missing_since="\$archived\.missing-since"/);
  assert.match(script, /MISSING_SINCE=/);
  assert.match(script, /-mtime "\+\$MEDIA_MIRROR_DELETE_GRACE_DAYS"/);
  assert.doesNotMatch(script, /retention-cutoff/);
});

test("backup cleanup stays bounded without deleting the newest complete points", async () => {
  const script = await read("./prune-backups.sh");
  assert.match(script, /UNVERIFIED_BACKUP_RETENTION_DAYS[^\n]+35/);
  assert.match(script, /INCOMPLETE_BACKUP_RETENTION_DAYS[^\n]+7/);
  assert.match(script, /index >= BACKUP_KEEP_COUNT/);
  assert.match(script, /\$\{#backups\[@\]\} >= 2/);
  assert.match(script, /name '\.incomplete-\*'/);
});

test("off-site replication copies encrypted recovery artifacts only and verifies them", async () => {
  const script = await read("./replicate-encrypted-backups.sh");
  assert.match(script, /SNEZHOK_OFFSITE_REMOTE must name a configured rclone remote/);
  assert.match(script, /payload_filter_args=\(/);
  assert.match(script, /completion_filter_args=\(/);
  assert.match(script, /--include '\/snezhok-\*\/database\.dump\.age'/);
  assert.match(script, /mutable_filter_args=\(/);
  assert.match(script, /--include '\/snezhok-\*\/\.verified'/);
  assert.match(script, /--include '\/pitr-base\/\*\.tar\.gz\.age\.verified\.restored'/);
  assert.match(script, /--include '\/media-objects\/\*\*\/\*\.age'/);
  assert.match(script, /--exclude '\*\*'/);
  assert.match(script, /--immutable/);
  assert.match(script, /rclone[^\n]+check/);
  assert.ok(
    script.indexOf('"${payload_filter_args[@]}"') < script.indexOf('"${completion_filter_args[@]}"'),
    "encrypted payloads must be copied before remote completion markers",
  );
  assert.match(script, /offsite-replication\.status/);
  assert.doesNotMatch(script, /database\.dump(?!\.age)/);
});

test("in-host monitoring uses local TLS and keeps public transport probes opt-in", async () => {
  const script = await read("../monitoring/production-health.sh");
  assert.match(script, /--resolve "\$\{LOCAL_TLS_HOST\}:443:\$\{LOCAL_TLS_ADDRESS\}"/);
  assert.match(script, /RUN_EXTERNAL_CONNECTIVITY_CHECK[^\n]+0/);
  assert.match(script, /MAX_UNVERIFIED_BACKUP_AGE_HOURS/);
  assert.match(script, /alert-delivery-failed/);
});

test("maintenance installer protects credentials and exact provenance", async () => {
  const script = await read("../deploy/install-maintenance.sh");
  assert.match(script, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(script, /chmod 0600 "\$environment_tmp"/);
  assert.match(script, /apt-get install[^\n]+age coreutils curl openssl python3 rclone zstd/);
  assert.match(script, /systemd units require the canonical production PLATFORM_ROOT/);
  assert.match(script, /verify-public-source\.mjs/);
  assert.match(script, /ensure_environment_default SNEZHOK_OFFSITE_REMOTE/);
  assert.match(script, /systemd-analyze verify/);
  assert.match(script, /effective_require_offsite/);
  assert.match(script, /systemctl enable --now snezhok-offsite-backup\.timer/);
});

test("Android publication moves the channel manifest last", async () => {
  const script = await read("../deploy/publish-android-release.sh");
  const apkMove = script.indexOf('mv -f -- "$current_apk_temporary"');
  const manifestMove = script.indexOf('mv -f -- "$current_manifest_temporary"');
  assert.ok(apkMove > 0);
  assert.ok(manifestMove > apkMove);
  assert.match(script, /sourceRevision must be an exact 40-character commit/);
  assert.match(script, /verify-public-source\.mjs/);
  assert.match(script, /runtime\/releases/);
});

test("production deployment binds backup and image provenance to real commits", async () => {
  const script = await read("../deploy/deploy-production.sh");
  assert.match(script, /status --porcelain --untracked-files=normal/);
  assert.match(script, /verify-public-source\.mjs/);
  assert.match(script, /maintenance provenance does not match the currently running release/);
  assert.match(script, /configured_revision" == "\$current_revision/);
  assert.ok(script.indexOf("systemctl start snezhok-backup.service") < script.indexOf('set_image_tag "$REVISION"'));
  assert.match(script, /trap rollback_tag EXIT/);
  assert.match(script, /install-maintenance\.sh" "\$REVISION" --enable/);
  const verifier = await read("../deploy/verify-production-release.sh");
  assert.match(verifier, /android_source_revision/);
  assert.match(verifier, /verify-public-source\.mjs/);
  assert.doesNotMatch(verifier, /body\.sourceRevision!==process\.argv\[2\]/);
});

test("every maintenance unit requires the protected environment", async () => {
  for (const name of [
    "snezhok-backup.service",
    "snezhok-media-mirror.service",
    "snezhok-monitor.service",
    "snezhok-offsite-backup.service",
    "snezhok-pitr-base.service",
    "snezhok-pitr-restore-verify.service",
    "snezhok-restore-verify.service",
    "snezhok-retention.service",
  ]) {
    const unit = await read(`../../infra/systemd/${name}`);
    assert.match(unit, /^EnvironmentFile=\/etc\/snezhok\/maintenance\.env$/m, name);
    assert.doesNotMatch(unit, /^EnvironmentFile=-/m, name);
  }
});
