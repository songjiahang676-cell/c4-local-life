import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

type ProblemFields = Record<string, string[]>;

const statusTitles: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function statusFromException(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  if (
    isRecord(exception) &&
    typeof exception.statusCode === "number" &&
    exception.statusCode >= 400 &&
    exception.statusCode <= 599
  ) {
    return exception.statusCode;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function fieldErrorsFromResponse(raw: unknown): ProblemFields | undefined {
  if (!isRecord(raw) || !isRecord(raw.errors)) return undefined;
  const entries = Object.entries(raw.errors).flatMap(([field, messages]) =>
    Array.isArray(messages) && messages.every((message) => typeof message === "string")
      ? [[field, messages] as const]
      : [],
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const status = statusFromException(exception);
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const errors = fieldErrorsFromResponse(raw);
    const detail =
      status === 500
        ? "An unexpected error occurred."
        : status === 404
          ? "The requested resource was not found."
          : typeof raw === "string"
            ? raw
            : isRecord(raw) && "message" in raw
              ? Array.isArray(raw.message)
                ? raw.message.join("; ")
                : String(raw.message)
              : (statusTitles[status] ?? "The request could not be completed.");

    void reply
      .status(status)
      .type("application/problem+json")
      .header("cache-control", "no-store")
      .send({
        type: `https://api.socal.local/problems/${errors ? "validation" : status}`,
        title: statusTitles[status] ?? "Request Failed",
        status,
        detail,
        instance: request.url.split("?")[0],
        requestId: request.id,
        ...(errors ? { errors } : {}),
      });
  }
}
