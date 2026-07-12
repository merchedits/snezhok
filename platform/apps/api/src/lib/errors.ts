import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export const notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);
export const forbidden = (message = "Forbidden") => new AppError(403, "FORBIDDEN", message);
export const conflict = (message: string) => new AppError(409, "CONFLICT", message);
export const unauthorized = (message = "Authentication required") => new AppError(401, "UNAUTHORIZED", message);

export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const details: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const field = issue.path.join(".") || "form";
        (details[field] ??= []).push(issue.message);
      }
      return send(reply, 400, "VALIDATION_ERROR", "Request validation failed", details);
    }
    if (error instanceof AppError) return send(reply, error.status, error.code, error.message, error.details);
    request.log.error({ err: error }, "unhandled request error");
    return send(reply, 500, "INTERNAL_ERROR", "The request could not be completed");
  });
}

function send(reply: FastifyReply, status: number, code: string, message: string, details?: Record<string, string[]>) {
  return reply.status(status).send(details ? { code, message, details } : { code, message });
}
