// PUT /api/v1/devices/{id}/config — (admin) actualiza la configuración remota.
// El dispositivo la recibe en la respuesta de su siguiente envío y la aplica sin reiniciarse.
import { json, leerJson, manejar, usuarioDesde } from "@/lib/server/http";
import { actualizarConfig } from "@/lib/server/services/dispositivos";

export const PUT = manejar(async (req, { params }) => {
  const { id } = await params;
  return json(await actualizarConfig(await usuarioDesde(req, { soloAdmin: true }), id, await leerJson(req)));
});
