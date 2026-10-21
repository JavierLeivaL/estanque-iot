"use client";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Protegido from "@/components/Protegido";
import { api, fechaHora, fmt } from "@/lib/client/api";
import { fbDb } from "@/lib/client/firebase";

function Lista() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState(null);
  const [soloPendientes, setSoloPendientes] = useState(false);

  useEffect(() => {
    const q = query(collection(fbDb(), "orgs", usuario.orgId, "alertas"), orderBy("ts", "desc"), limit(100));
    return onSnapshot(q, (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [usuario.orgId]);

  const visibles = (lista || []).filter((a) => !soloPendientes || (!a.reconocida && a.tipo !== "normalizado"));
  return (
    <>
      <div className="fila-sep"><h2>Alertas</h2>
        <label className="fila"><input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> Solo sin reconocer</label>
      </div>
      {lista === null ? <p className="tenue">Cargando…</p> : (
        <table className="tarjeta"><thead><tr><th>Fecha</th><th>Dispositivo</th><th>Tipo</th><th>Detalle</th><th>Valor / umbral</th><th></th></tr></thead>
          <tbody>{visibles.map((a) => (
            <tr key={a.id}>
              <td>{fechaHora(a.ts?.toMillis?.())}</td><td>{a.deviceNombre}</td>
              <td><span className={`pastilla ${a.tipo === "normalizado" ? "ok" : "alerta"}`}>{a.tipo}</span></td>
              <td>{a.mensaje}</td><td>{fmt(a.valor)} / {fmt(a.umbral)}</td>
              <td>{a.tipo !== "normalizado" && (a.reconocida
                ? <small className="tenue">Reconocida por {a.reconocidaPor}</small>
                : <button className="chico" onClick={() => api(`/alerts/${a.id}/ack`, { metodo: "POST" })}>Reconocer</button>)}</td>
            </tr>))}
          </tbody></table>
      )}
    </>
  );
}

export default function Alertas() {
  return <Protegido><Lista /></Protegido>;
}
