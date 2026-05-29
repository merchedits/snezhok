import { db } from "../db/index.js";
import { users, sessions, inviteCodes } from "../db/schema.js";
import { eq, count } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { config } from "../lib/config.js";

const PASTEL_COLORS = ["#FFCFB3", "#B5CDB5", "#C5B8E8", "#F2B8C6", "#F5E6A3"];

export async function checkFirstUser() {
  const result = await db.select({ value: count() }).from(users);
  return result[0].value === 0;
}

export async function registerUser({
  inviteCode,
  username,
  password,
  displayName,
}: any) {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername || !password) {
    throw new Error("Username and password are required.");
  }

  // Check if username already exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.username, normalizedUsername),
  });
  if (existingUser) {
    throw new Error("Username is already taken.");
  }

  const isFirst = await checkFirstUser();
  let codeRecord = null;

  if (isFirst) {
    // First user bootstrap
    if (inviteCode !== config.INITIAL_INVITE_CODE) {
      throw new Error("Invalid bootstrap invite code.");
    }
  } else {
    // Regular registration: check invite code in database
    codeRecord = await db.query.inviteCodes.findFirst({
      where: eq(inviteCodes.code, inviteCode),
    });

    if (!codeRecord) {
      throw new Error("Invite code not found.");
    }
    if (codeRecord.usedBy) {
      throw new Error("Invite code has already been used.");
    }
  }

  const userId = nanoid();
  const passwordHash = await bcrypt.hash(password, 10);
  const avatarColor = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
  const now = Date.now();

  const user = {
    id: userId,
    username: normalizedUsername,
    passwordHash,
    displayName: displayName?.trim() || username.trim(),
    avatarColor,
    avatarUrl: null,
    isAdmin: isFirst, // First user is Admin
    createdAt: now,
    lastSeenAt: now,
  };

  // Perform inside transaction to ensure atomic registration and code burn
  await db.transaction(async (tx) => {
    await tx.insert(users).values(user);

    if (codeRecord) {
      await tx
        .update(inviteCodes)
        .set({
          usedBy: userId,
          usedAt: now,
        })
        .where(eq(inviteCodes.id, codeRecord.id));
    }
  });

  return { id: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin, avatarColor: user.avatarColor, avatarUrl: user.avatarUrl };
}

export async function loginUser(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const user = await db.query.users.findFirst({
    where: eq(users.username, normalizedUsername),
  });

  if (!user) {
    throw new Error("Invalid username or password.");
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    throw new Error("Invalid username or password.");
  }

  // Create session
  const sessionId = nanoid(32);
  const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt: expiry,
    createdAt: Date.now(),
  });

  // Update last seen
  await db
    .update(users)
    .set({ lastSeenAt: Date.now() })
    .where(eq(users.id, user.id));

  return {
    sessionId,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
    },
  };
}

export async function validateSession(sessionId: string) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    // Delete expired session
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) return null;

  // Touch session expiry and user lastSeenAt if more than 1 hour has passed since last touch
  // expiresAt is 30 days from last touch, so if expiresAt - now < 29 days, we touch
  const now = Date.now();
  const maxSessionDuration = 30 * 24 * 60 * 60 * 1000;
  if (session.expiresAt - now < maxSessionDuration - 3600 * 1000) { 
    await db
      .update(sessions)
      .set({ expiresAt: now + maxSessionDuration })
      .where(eq(sessions.id, sessionId));
    await db
      .update(users)
      .set({ lastSeenAt: now })
      .where(eq(users.id, user.id));
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
  };
}

export async function logoutUser(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function createInviteCode(adminUserId: string, code?: string) {
  const codeString = code ? code.trim().toUpperCase() : `COZY_${nanoid(6).toUpperCase()}`;

  // Verify creating user is admin
  const user = await db.query.users.findFirst({
    where: eq(users.id, adminUserId),
  });
  if (!user || !user.isAdmin) {
    throw new Error("Only admins can generate invite codes.");
  }

  // Check if code exists
  const existingCode = await db.query.inviteCodes.findFirst({
    where: eq(inviteCodes.code, codeString),
  });
  if (existingCode) {
    throw new Error("Invite code already exists.");
  }

  const newCode = {
    id: nanoid(),
    code: codeString,
    createdBy: adminUserId,
    createdAt: Date.now(),
  };

  await db.insert(inviteCodes).values(newCode);
  return newCode;
}

export async function getInviteCodes(adminUserId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, adminUserId),
  });
  if (!user || !user.isAdmin) {
    throw new Error("Unauthorized.");
  }
  return await db.query.inviteCodes.findMany({
    orderBy: (ic, { desc }) => [desc(ic.createdAt)],
  });
}
