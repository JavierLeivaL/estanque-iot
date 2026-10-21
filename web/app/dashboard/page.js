"use client";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Protegido from "@/components/Protegido";
import { api, fmt, haceCuanto } from "@/lib/client/api";
import { fbDb } from "@/lib/client/firebase";
import { ESTADOS } from "@/lib/shared/config";
import { enLinea } from "@/lib/client/estado";
import TokenGenerado from "@/components/TokenGenerado";

function Tarjeta({ d }) {
  const l = d.ultimaLectura || {};
  const est = ESTADOS[l.e] || ESTADOS.normal;
  const online = enLinea(d);
  const pct = typeof l.p === "number" ? l.p : null;
  return (
    <Link href={`/dispositivos/${d.id}`} className="tarjeta disp">
      <div className="fila-sep">
        <strong>{d.nombre}</strong>
        <span className={`pastilla ${online ? "ok" : "off"}`}>{online ? "En línea" : "Sin conexión"}</span>
      </div>
      <p className="tenue">{d.ubicacion || d.tipo}</p>
      <div className="estanque"><div className={`agua ${est.clase}`} style={{ height: `${pct ?? 0}%` }} /><span>{fmt(pct, 0, " %")}</span></div>
      <div className="metricas">
        <div><small>Temperatura</small><b>{fmt(l.tc, 1, " °C")}</b></div>
        <div><small>Humedad</small><b>{fmt(l.hr, 0, " %")}</b></div>
        <div><small>Lleno en</small><b>{typeof l.hl === "number" ? `${l.hl} h` : "—"}</b></div>
      </div>
      <div className="fila-sep">
        <span className={`pastilla ${est.clase}`}>{est.texto}</span>
        <small className="tenue">{haceCuanto(d.ultimoContacto?.toMillis?.())}</small>
      </div>
    </Link>
  );
}

function NuevoDispositivo({ alCrear }) {
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({ nombre: "", ubicacion: "", tipo: "estanque" });
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");
  async function crear(e) {
    e.preventDefault();
    setError("");
    try {
      setResultado(await api("/devices", { metodo: "POST", cuerpo: form }));
      alCrear?.();
    } catch (err) { setError(err.message); }
  }
  if (!abierto) return <button onClick={() => setAbierto(true)}>+ Nuevo dispositivo</button>;
  if (resultado) return <TokenGenerado token={resultado.token} alCerrar={() => { setResultado(null); setAbierto(false); }} />;
  return (
    <form className="tarjeta form-linea" onSubmit={crear}>
      <input placeholder="Nombre (ej. Estanque patio)" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
      <input placeholder="Ubicación" value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value })} />
      <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option value="estanque">Estanque de agua</option><option value="basurero">Contenedor de basura</option></select>
      <button>Crear</button><button type="button" className="sec" onClick={() => setAbierto(false)}>Cancelar</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function Panel() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState(null);
  const [error, setError] = useState("");
  const [, setTic] = useState(0);

  useEffect(() => {
    // Tiempo real: Firestore notifica cada vez que un dispositivo envía un lote.
    const q = query(collection(fbDb(), "devices"), where("orgId", "==", usuario.orgId));
    return onSnapshot(q, (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre))),
      (e) => setError(e.message));
  }, [usuario.orgId]);
  useEffect(() => { const i = setInterval(() => setTic((t) => t + 1), 15000); return () => clearInterval(i); }, []);

  return (
    <>
      <div className="fila-sep"><h2>Dispositivos</h2>{usuario.role === "admin" && <NuevoDispositivo />}</div>
      {error && <p className="error">{error}</p>}
      {lista === null ? <p className="tenue">Cargando…</p> : lista.length === 0 ? <p className="tenue">No hay dispositivos todavía.</p> : (
        <div className="grilla-disp">{lista.map((d) => <Tarjeta key={d.id} d={d} />)}</div>
      )}
    </>
  );
}

export default function Dashboard() {
  return <Protegido><Panel /></Protegido>;
}
