// GET /api/v1/health — verificación pública de que la API está en línea.
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ ok: true, servicio: "estanque-iot", hora: new Date().toISOString() });
}
