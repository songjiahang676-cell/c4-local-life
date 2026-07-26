export function GET(): Response {
  return Response.json({
    status: "ok",
    service: "admin",
    checks: { process: "ok" },
  });
}
