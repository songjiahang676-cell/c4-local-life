export function GET(): Response {
  return Response.json({
    status: "ok",
    service: "web",
    checks: { process: "ok" },
  });
}
