export function GET(): Response {
  return Response.json({
    status: "ok",
    service: "web",
    timestamp: new Date().toISOString(),
  });
}
