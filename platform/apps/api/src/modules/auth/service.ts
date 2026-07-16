import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { UserSummary } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool, transaction } from "../../db/pool.js";
import { config } from "../../config.js";
import { conflict, forbidden, unauthorized } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { defaultSettings } from "../settings/defaults.js";

const jwtKey = new TextEncoder().encode(config.JWT_SECRET);

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  bio: string;
  statusText: string;
  isAdmin: boolean;
  platform: "web" | "android";
}

interface LoginInput {
  username: string;
  password: string;
  deviceName: string;
  platform: "web" | "android";
  ipAddress: string;
  userAgent: string;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_attachment_id: string | null;
  avatar_color: string;
  bio: string;
  status_text: string;
  is_admin: boolean;
  last_seen_at_ms: number;
  password_hash: string;
  algorithm: "argon2id" | "bcrypt";
}

export function hashOpaqueToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function register(input: LoginInput & { email: string }) {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [492_001_731]);
    const existing = await client.query<{ username_taken: boolean; email_taken: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM users WHERE username=$1) AS username_taken,
              EXISTS(SELECT 1 FROM users WHERE email=$2) AS email_taken`,
      [input.username, input.email],
    );
    if (existing.rows[0]?.username_taken) throw conflict("Username is already in use");
    if (existing.rows[0]?.email_taken) throw conflict("Email is already in use");

    const userId = newId();
    const isFirst = (await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE deleted_at IS NULL")).rows[0]?.count === "0";
    await client.query(
      `INSERT INTO users(id, email, username, display_name, avatar_color, is_admin)
       VALUES ($1,$2,$3,$3,$4,$5)`,
      [userId, input.email, input.username, avatarColor(userId), isFirst],
    );
    await client.query(
      "INSERT INTO credentials(user_id, password_hash, algorithm) VALUES ($1,$2,'argon2id')",
      [userId, await argon2.hash(input.password, { type: argon2.argon2id })],
    );
    await client.query("INSERT INTO user_settings(user_id, settings) VALUES ($1,$2)", [userId, defaultSettings]);
    await client.query("INSERT INTO user_privacy_settings(user_id) VALUES ($1)", [userId]);
    const savedConversationId = newId();
    await client.query(
      "INSERT INTO conversations(id,kind,title,owner_id,saved_owner_id) VALUES ($1,'direct','',$2,$2)",
      [savedConversationId, userId],
    );
    await client.query(
      "INSERT INTO conversation_members(conversation_id,user_id,role,pinned_at) VALUES ($1,$2,'owner',now())",
      [savedConversationId, userId],
    );
    const row = await getUserWithCredential(client, input.username);
    return createSession(client, row!, input);
  });
}

export async function login(input: LoginInput) {
  return transaction(async (client) => {
    const row = await getUserWithCredential(client, input.username);
    if (!row || !(await verifyPassword(row, input.password))) throw unauthorized("Invalid username or password");
    if (row.algorithm === "bcrypt") {
      await client.query(
        "UPDATE credentials SET password_hash=$2, algorithm='argon2id', password_changed_at=now() WHERE user_id=$1",
        [row.id, await argon2.hash(input.password, { type: argon2.argon2id })],
      );
    }
    return createSession(client, row, input);
  });
}

async function verifyPassword(row: Pick<UserRow, "algorithm" | "password_hash">, password: string) {
  return row.algorithm === "bcrypt" ? bcrypt.compare(password, row.password_hash) : argon2.verify(row.password_hash, password);
}

async function getUserWithCredential(client: DbClient, username: string) {
  const result = await client.query<UserRow>(
    `SELECT u.id,u.username,u.display_name,u.avatar_attachment_id,u.avatar_color,u.bio,u.status_text,u.is_admin,
            (extract(epoch from u.last_seen_at)*1000)::bigint::float8 AS last_seen_at_ms,
            c.password_hash,c.algorithm
     FROM users u JOIN credentials c ON c.user_id=u.id WHERE u.username=$1 AND u.deleted_at IS NULL`,
    [username],
  );
  return result.rows[0];
}

async function createSession(client: DbClient, row: UserRow, input: LoginInput) {
  const sessionId = newId();
  const refreshToken = randomBytes(32).toString("base64url");
  await client.query(
    `INSERT INTO device_sessions(id,user_id,label,platform,refresh_token_hash,ip_address,user_agent,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now()+($8::text || ' days')::interval)`,
    [sessionId, row.id, input.deviceName, input.platform, hashOpaqueToken(refreshToken), input.ipAddress || null, input.userAgent, config.REFRESH_TOKEN_TTL_DAYS],
  );
  await client.query("UPDATE users SET last_seen_at=now() WHERE id=$1", [row.id]);
  return {
    accessToken: await signAccessToken({ userId: row.id, sessionId, platform: input.platform }),
    refreshToken,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    user: toSummary(row),
    platform: input.platform,
  };
}

export async function refresh(refreshToken: string) {
  return transaction(async (client) => {
    const result = await client.query<{
      id: string; user_id: string; platform: "web" | "android"; username: string; display_name: string;
      avatar_attachment_id: string | null; avatar_color: string; bio: string; status_text: string; is_admin: boolean; last_seen_at_ms: number;
    }>(
      `SELECT s.id,s.user_id,s.platform,u.username,u.display_name,u.avatar_attachment_id,u.avatar_color,u.bio,u.status_text,u.is_admin,
              (extract(epoch from u.last_seen_at)*1000)::bigint::float8 AS last_seen_at_ms
       FROM device_sessions s JOIN users u ON u.id=s.user_id
       WHERE s.refresh_token_hash=$1 AND u.deleted_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > now() FOR UPDATE`,
      [hashOpaqueToken(refreshToken)],
    );
    const row = result.rows[0];
    if (!row) throw unauthorized("Refresh token is invalid or expired");
    const nextRefreshToken = randomBytes(32).toString("base64url");
    await client.query(
      "UPDATE device_sessions SET refresh_token_hash=$2,last_used_at=now(),expires_at=now()+($3::text || ' days')::interval WHERE id=$1",
      [row.id, hashOpaqueToken(nextRefreshToken), config.REFRESH_TOKEN_TTL_DAYS],
    );
    return {
      accessToken: await signAccessToken({ userId: row.user_id, sessionId: row.id, platform: row.platform }),
      refreshToken: nextRefreshToken,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      user: toSummary({ ...row, id: row.user_id }),
      platform: row.platform,
    };
  });
}

async function signAccessToken(input: { userId: string; sessionId: string; platform: "web" | "android" }) {
  return new SignJWT({ sid: input.sessionId, platform: input.platform })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(jwtKey);
}

export async function authenticateAccessToken(token: string): Promise<AuthenticatedUser> {
  try {
    const { payload } = await jwtVerify(token, jwtKey, { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string" || (payload.platform !== "web" && payload.platform !== "android")) throw new Error("invalid claims");
    const result = await pool.query<{
      id: string; username: string; display_name: string; avatar_color: string; bio: string; status_text: string; is_admin: boolean;
      avatar_attachment_id: string | null;
    }>(
      `SELECT u.id,u.username,u.display_name,u.avatar_attachment_id,u.avatar_color,u.bio,u.status_text,u.is_admin
       FROM users u JOIN device_sessions s ON s.user_id=u.id
       WHERE u.id=$1 AND u.deleted_at IS NULL AND s.id=$2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [payload.sub, payload.sid],
    );
    const user = result.rows[0];
    if (!user) throw new Error("session revoked");
    return {
      id: user.id, sessionId: payload.sid, username: user.username, displayName: user.display_name,
      avatarUrl: avatarUrl(user.avatar_attachment_id), avatarColor: user.avatar_color, bio: user.bio, statusText: user.status_text,
      isAdmin: user.is_admin, platform: payload.platform,
    };
  } catch {
    throw unauthorized();
  }
}

export async function revokeSession(userId: string, sessionId: string) {
  const result = await pool.query("UPDATE device_sessions SET revoked_at=now(),revoked_reason='user_requested' WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [sessionId, userId]);
  if (!result.rowCount) throw forbidden("Session does not belong to this account");
}

export async function revokeOtherSessions(userId: string, currentSessionId: string) {
  const result = await pool.query(
    "UPDATE device_sessions SET revoked_at=now(),revoked_reason='revoked_from_device' WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL RETURNING id",
    [userId, currentSessionId],
  );
  return result.rowCount ?? 0;
}

export async function listSessions(user: AuthenticatedUser) {
  const result = await pool.query<{
    id: string; label: string; platform: "web" | "android"; ip_address: string | null; user_agent: string;
    last_used_at_ms: number; created_at_ms: number; expires_at_ms: number;
  }>(
    `SELECT id,label,platform,coalesce(host(ip_address),'') AS ip_address,user_agent,
            (extract(epoch from last_used_at)*1000)::bigint::float8 AS last_used_at_ms,
            (extract(epoch from created_at)*1000)::bigint::float8 AS created_at_ms,
            (extract(epoch from expires_at)*1000)::bigint::float8 AS expires_at_ms
     FROM device_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_used_at DESC`,
    [user.id],
  );
  return result.rows.map((row) => ({
    id: row.id, label: row.label, platform: row.platform, ipAddress: row.ip_address ?? "", userAgent: row.user_agent,
    lastUsedAt: row.last_used_at_ms, createdAt: row.created_at_ms, expiresAt: row.expires_at_ms, current: row.id === user.sessionId,
  }));
}

export async function verifyCurrentPassword(userId: string, password: string, client: DbClient) {
  const result = await client.query<Pick<UserRow, "password_hash" | "algorithm">>(
    "SELECT password_hash,algorithm FROM credentials WHERE user_id=$1 FOR UPDATE",
    [userId],
  );
  const row = result.rows[0];
  return row ? verifyPassword(row, password) : false;
}

function avatarColor(seed: string) {
  const colors = ["#5b8def", "#26a69a", "#8e6cef", "#ed6a5a", "#d9922e"];
  return colors[parseInt(seed.slice(0, 2), 16) % colors.length]!;
}

function toSummary(row: Pick<UserRow, "id" | "username" | "display_name" | "avatar_attachment_id" | "avatar_color" | "bio" | "status_text" | "last_seen_at_ms">): UserSummary {
  return {
    id: row.id, username: row.username, displayName: row.display_name, avatarUrl: avatarUrl(row.avatar_attachment_id),
    avatarColor: row.avatar_color, bio: row.bio, statusText: row.status_text,
    presence: "online", lastSeenAt: Number(row.last_seen_at_ms),
  };
}

function avatarUrl(attachmentId: string | null) { return attachmentId ? `/api/v1/files/${attachmentId}` : null; }
