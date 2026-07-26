export function GET(): Response {
  return Response.json({
    status: "ok",
    service: "admin",
    timestamp: new Date().toISOString(),
  });
}
