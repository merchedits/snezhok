import { FastifyInstance } from "fastify";
import { registerUser, loginUser, logoutUser, checkFirstUser } from "../services/auth.js";
import { requireAuth } from "../lib/middleware.js";

export async function authRoutes(fastify: FastifyInstance) {
  // Check if first user registration (bootstrap mode)
  fastify.get("/api/auth/first", async (request, reply) => {
    const isFirst = await checkFirstUser();
    return { isFirst };
  });

  // Register
  fastify.post(
    "/api/auth/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: {
            inviteCode: { type: "string" },
            username: { type: "string", minLength: 3, maxLength: 30 },
            password: { type: "string", minLength: 6, maxLength: 100 },
            displayName: { type: "string", maxLength: 50 },
          },
        },
      },
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (request: any, reply) => {
      const { inviteCode, username, password, displayName } = request.body;

      try {
        const user = await registerUser({
          inviteCode,
          username,
          password,
          displayName,
        });

        return { success: true, user };
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );

  // Login
  fastify.post(
    "/api/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" },
          },
        },
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request: any, reply) => {
      const { username, password } = request.body;

      try {
        const { sessionId, user } = await loginUser(username, password);

        // Set cookie
        reply.setCookie("sessionId", sessionId, {
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });

        return { success: true, user };
      } catch (error: any) {
        reply.status(401).send({ error: error.message });
      }
    }
  );

  // Logout
  fastify.post("/api/auth/logout", async (request, reply) => {
    const sessionId = request.cookies.sessionId;
    if (sessionId) {
      await logoutUser(sessionId);
    }
    reply.clearCookie("sessionId", { path: "/" });
    return { success: true };
  });

  // Current session info
  fastify.get(
    "/api/auth/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      return { user: request.user };
    }
  );
}
