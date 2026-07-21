import type { DbClient } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { forbidden } from "../../lib/errors.js";

export const globalPermissionNames = ["createServers", "createGroups", "uploadFiles", "startCalls"] as const;
export type GlobalPermission = typeof globalPermissionNames[number];
export type GlobalPermissions = Record<GlobalPermission, boolean>;

export const defaultGlobalPermissions: GlobalPermissions = {
  createServers: true,
  createGroups: true,
  uploadFiles: true,
  startCalls: true,
};

export interface EffectiveMemberPolicy {
  permissions: GlobalPermissions;
  storageQuotaBytes: number;
  maxUploadBytes: number;
}

interface PolicyRow {
  is_admin: boolean;
  suspended: boolean;
  default_permissions: unknown;
  permission_overrides: unknown;
  default_storage_quota_bytes: string | number;
  storage_quota_bytes: string | number | null;
  max_upload_bytes: string | number;
}

export async function effectiveMemberPolicy(userId: string, client: Pick<DbClient, "query"> = pool): Promise<EffectiveMemberPolicy> {
  const result = await client.query<PolicyRow>(
    `SELECT u.is_admin,u.suspended_at IS NOT NULL suspended,s.default_permissions,
            coalesce(p.permission_overrides,'{}'::jsonb) permission_overrides,
            s.default_storage_quota_bytes,p.storage_quota_bytes,s.max_upload_bytes
       FROM users u CROSS JOIN global_admin_settings s
       LEFT JOIN user_admin_policies p ON p.user_id=u.id
      WHERE u.id=$1 AND u.deleted_at IS NULL AND s.singleton=true`,
    [userId],
  );
  const row = result.rows[0];
  if (!row || row.suspended) throw forbidden("This account is suspended");
  const permissions = row.is_admin
    ? { createServers: true, createGroups: true, uploadFiles: true, startCalls: true }
    : mergePermissions(row.default_permissions, row.permission_overrides);
  return {
    permissions,
    storageQuotaBytes: Number(row.storage_quota_bytes ?? row.default_storage_quota_bytes),
    maxUploadBytes: Number(row.max_upload_bytes),
  };
}

export async function requireGlobalPermission(userId: string, permission: GlobalPermission, client: Pick<DbClient, "query"> = pool) {
  const policy = await effectiveMemberPolicy(userId, client);
  if (!policy.permissions[permission]) throw forbidden("This action is disabled for your account");
  return policy;
}

export function mergePermissions(defaults: unknown, overrides: unknown): GlobalPermissions {
  const defaultRecord = isRecord(defaults) ? defaults : {};
  const overrideRecord = isRecord(overrides) ? overrides : {};
  return Object.fromEntries(globalPermissionNames.map((name) => [
    name,
    typeof overrideRecord[name] === "boolean"
      ? overrideRecord[name]
      : typeof defaultRecord[name] === "boolean"
        ? defaultRecord[name]
        : defaultGlobalPermissions[name],
  ])) as unknown as GlobalPermissions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
