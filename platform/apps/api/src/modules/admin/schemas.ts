import { z } from "zod";
import { globalPermissionNames } from "./policy.js";

const permissions = Object.fromEntries(globalPermissionNames.map((name) => [name, z.boolean()])) as Record<typeof globalPermissionNames[number], z.ZodBoolean>;
export const fullPermissionsSchema = z.object(permissions).strict();
export const permissionOverridesSchema = z.object(Object.fromEntries(globalPermissionNames.map((name) => [name, z.boolean().nullable().optional()])) as Record<typeof globalPermissionNames[number], z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>).strict();

export const adminSettingsPatchSchema = z.object({
  revision: z.coerce.number().int().positive(),
  defaultPermissions: fullPermissionsSchema.optional(),
  defaultStorageQuotaBytes: z.number().int().min(10 * 1024 * 1024).max(1024 * 1024 * 1024 * 1024).optional(),
  maxUploadBytes: z.number().int().min(1024 * 1024).max(10 * 1024 * 1024 * 1024).optional(),
  messageRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  orphanMediaRetentionDays: z.number().int().min(1).max(3650).optional(),
  eventRetentionDays: z.number().int().min(1).max(3650).optional(),
  featureCapabilities: z.object({ uploads: z.boolean(), calls: z.boolean(), activities: z.boolean(), servers: z.boolean() }).strict().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "revision"), { message: "At least one setting is required" });

export const adminMemberPatchSchema = z.object({
  isAdmin: z.boolean().optional(),
  suspended: z.boolean().optional(),
  permissionOverrides: permissionOverridesSchema.optional(),
  storageQuotaBytes: z.number().int().min(10 * 1024 * 1024).max(1024 * 1024 * 1024 * 1024).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one member setting is required" });

export const adminMembersQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
