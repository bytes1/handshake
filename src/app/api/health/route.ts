export const runtime = "nodejs";

export function GET() {
  return Response.json({
    status: "ok",
    service: "peer-midnight",
    timestamp: new Date().toISOString(),
  });
}
