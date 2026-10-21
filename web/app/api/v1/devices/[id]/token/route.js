// POST   /api/v1/devices/{id}/token — (admin) genera un token nuevo (invalida el anterior).
// DELETE /api/v1/devices/{id}/token — (admin) revoca el token: el dispositivo deja de poder enviar.
import { json, manejar, usuarioDesde } from "@/lib/server/http";
import { regenerarToken, revocarToken } from "@/lib/server/services/dispositivos";

export const POST = manejar(async (req, { params }) => {
  const { id } = await params;
  return json(await regenerarToken(await usuarioDesde(req, { soloAdmin: true }), id), 201);
});
export const DELETE = manejar(async (req, { params }) => {
  const { id } = await params;
  await revocarToken(await usuarioDesde(req, { soloAdmin: true }), id);
  return json({ ok: true });
});
