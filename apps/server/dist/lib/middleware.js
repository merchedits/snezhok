import { validateSession } from "../services/auth.js";
export async function requireAuth(request, reply) {
    const sessionId = request.cookies.sessionId;
    if (!sessionId) {
        reply.status(401).send({ error: "Unauthorized. Session cookie missing." });
        return;
    }
    const user = await validateSession(sessionId);
    if (!user) {
        // Clear invalid session cookie
        reply.clearCookie("sessionId", { path: "/" });
        reply.status(401).send({ error: "Unauthorized. Session invalid or expired." });
        return;
    }
    request.user = user;
}
export async function requireAdmin(request, reply) {
    await requireAuth(request, reply);
    if (reply.sent)
        return;
    if (!request.user?.isAdmin) {
        reply.status(403).send({ error: "Forbidden. Admin privileges required." });
    }
}
