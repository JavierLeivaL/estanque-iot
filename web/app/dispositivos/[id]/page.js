"use client";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import Grafico from "@/components/Grafico";
import Protegido from "@/components/Protegido";
import TokenGenerado from "@/components/TokenGenerado";
import { api, fechaHora, fmt, haceCuanto } from "@/lib/client/api";
import { enLinea } from "@/lib/client/estado";
import { fbDb } from "@/lib/client/firebase";
import { CAMPOS_CONFIG, ESTADOS, configPorDefecto, validarConfig } from "@/lib/shared/config";

const RANGOS = [["1 h", 1], ["6 h", 6], ["24 h", 24], ["7 días", 168], ["30 días", 720]];
const aLocal = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function Historico({ id, ultimaLectura }) {
  const [desde, setDesde] = useState(aLocal(Date.now() - 24 * 3600e3));
  const [hasta, setHasta] = useState("");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async (d = desde, h = hasta) => {
    setError("");
    try {
      const q = new URLSearchParams({ desde: new Date(d).toISOString(), ...(h ? { hasta: new Date(h).toISOString() } : {}) });
      setDatos(await api(`/devices/${id}/readings?${q}`));
    } catch (e) { setError(e.message); }
  }, [id, desde, hasta]);

  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tiempo real: si el rango termina "ahora", se agrega cada nueva lectura que llega.
  useEffect(() => {
    if (!ultimaLectura || hasta) return;
    setDatos((prev) => prev && (!prev.puntos.length || ultimaLectura.t > prev.puntos[prev.puntos.length - 1].t)
      ? { ...prev, puntos: [...prev.puntos, ultimaLectura] } : prev);
  }, [ultimaLectura, hasta]);

  const rapido = (h) => { const d = aLocal(Date.now() - h * 3600e3); setDesde(d); setHasta(""); cargar(d, ""); };

  return (
    <section className="tarjeta">
      <div className="fila-sep"><h3>Histórico</h3>
        <div className="fila">{RANGOS.map(([t, h]) => <button key={t} className="sec chico" onClick={() => rapido(h)}>{t}</button>)}</div>
      </div>
      <div className="fila">
        <label>Desde <input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta <input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} placeholder="ahora" /></label>
        <button onClick={() => cargar()}>Consultar</button>
      </div>
      {error && <p className="error">{error}</p>}
      {datos && <>
        <h4>Llenado (%)</h4>
        <Grafico puntos={datos.puntos} series={[{ clave: "p", nombre: "Llenado %", color: "#1f7a8c", min: 0, max: 100 }]} />
        <h4>Ambiente</h4>
        <Grafico puntos={datos.puntos} series={[
          { clave: "tc", nombre: "Temperatura °C", color: "#d1495b" },
          { clave: "hr", nombre: "Humedad %", color: "#edae49", eje: "der" }]} />
        <p className="tenue">{datos.puntosTotales} resúmenes por minuto · {datos.documentosLeidos} documentos leídos en Firestore</p>
      </>}
    </section>
  );
}

function Configuracion({ d, esAdmin }) {
  const [form, setForm] = useState({ ...configPorDefecto(), ...d.config });
  const [msg, setMsg] = useState("");
  const [errores, setErrores] = useState([]);
  useEffect(() => { setForm({ ...configPorDefecto(), ...d.config }); }, [d.configVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar(e) {
    e.preventDefault();
    setMsg("");
    const { config, errores: errs } = validarConfig(form);
    if (errs.length) return setErrores(errs);
    setErrores([]);
    try {
      const r = await api(`/devices/${d.id}/config`, { metodo: "PUT", cuerpo: config });
      setMsg(`Guardada (versión ${r.configVersion}). El dispositivo la aplicará en su próximo envío (≤ ${config.envioSeg} s).`);
    } catch (err) { setErrores(err.detalles || [err.message]); }
  }

  return (
    <section className="tarjeta">
      <h3>Configuración remota <small className="tenue">v{d.configVersion}</small></h3>
      <form onSubmit={guardar} className="grilla-form">
        {Object.entries(CAMPOS_CONFIG).map(([k, c]) => (
          <label key={k} title={c.ayuda}>
            {c.etiqueta}
            {c.tipo === "bool"
              ? <input type="checkbox" checked={!!form[k]} disabled={!esAdmin} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
              : <input type="number" step={c.tipo === "int" ? 1 : 0.1} min={c.min} max={c.max} value={form[k]} disabled={!esAdmin}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value === "" ? "" : Number(e.target.value) })} />}
          </label>
        ))}
        {esAdmin && <div><button>Guardar configuración</button></div>}
      </form>
      {errores.map((e) => <p key={e} className="error">{e}</p>)}
      {msg && <p className="ok-txt">{msg}</p>}
      {!esAdmin && <p className="tenue">Solo un administrador puede modificar la configuración.</p>}
    </section>
  );
}

function Token({ d }) {
  const [token, setToken] = useState(null);
  const [error, setError] = useState("");
  async function regenerar() {
    if (!confirm("El token actual dejará de funcionar. ¿Continuar?")) return;
    try { setToken((await api(`/devices/${d.id}/token`, { metodo: "POST" })).token); } catch (e) { setError(e.message); }
  }
  async function revocar() {
    if (!confirm("El dispositivo no podrá enviar datos hasta generar un token nuevo. ¿Revocar?")) return;
    try { await api(`/devices/${d.id}/token`, { metodo: "DELETE" }); } catch (e) { setError(e.message); }
  }
  return (
    <section className="tarjeta">
      <h3>Token del dispositivo</h3>
      <p>Estado: <span className={`pastilla ${d.tieneToken ?? (d.tokenHash && !d.tokenRevocado) ? "ok" : "off"}`}>
        {d.tokenRevocado ? "Revocado" : d.tokenHash ? "Activo" : "Sin token"}</span>
        {d.tokenCreadoEn && <span className="tenue"> · generado {fechaHora(d.tokenCreadoEn.toMillis?.() ?? d.tokenCreadoEn)}</span>}</p>
      <div className="fila"><button onClick={regenerar}>Generar token nuevo</button><button className="peligro" onClick={revocar}>Revocar token</button></div>
      {token && <TokenGenerado token={token} alCerrar={() => setToken(null)} />}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Salud({ salud }) {
  if (!salud) return <section className="tarjeta"><h3>Microservicios</h3><p className="tenue">Sin información todavía.</p></section>;
  return (
    <section className="tarjeta">
      <h3>Microservicios y placa</h3>
      <div className="metricas">
        <div><small>CPU</small><b>{fmt(salud.cpu_pct, 0, " %")}</b></div>
        <div><small>Memoria</small><b>{fmt(salud.mem_pct, 0, " %")}</b></div>
        <div><small>Temp. placa</small><b>{fmt(salud.temp_placa_c, 1, " °C")}</b></div>
        <div><small>Disco</small><b>{fmt(salud.disco_pct, 0, " %")}</b></div>
      </div>
      <table><thead><tr><th>Servicio</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>
        {Object.entries(salud.servicios || {}).map(([n, s]) => (
          <tr key={n}><td>{n}</td><td><span className={`pastilla ${s.ok ? "ok" : "alerta"}`}>{s.ok ? "OK" : "Falla"}</span></td><td className="tenue">{s.detalle}</td></tr>
        ))}
      </tbody></table>
      <p className="tenue">Reportado {haceCuanto(salud.ts * 1000)} · encendida hace {Math.round((salud.uptime_s || 0) / 3600)} h</p>
    </section>
  );
}

function AlertasDispositivo({ orgId, id }) {
  const [lista, setLista] = useState([]);
  useEffect(() => {
    const q = query(collection(fbDb(), "orgs", orgId, "alertas"), orderBy("ts", "desc"), limit(50));
    return onSnapshot(q, (s) => setLista(s.docs.map((x) => ({ id: x.id, ...x.data() })).filter((a) => a.deviceId === id).slice(0, 10)));
  }, [orgId, id]);
  return (
    <section className="tarjeta">
      <h3>Últimas alertas</h3>
      {lista.length === 0 ? <p className="tenue">Sin alertas.</p> : <ul className="lista">{lista.map((a) => (
        <li key={a.id}><span className={`pastilla ${a.tipo === "normalizado" ? "ok" : "alerta"}`}>{a.tipo}</span> {a.mensaje} <small className="tenue">{fechaHora(a.ts?.toMillis?.())}</small></li>
      ))}</ul>}
    </section>
  );
}

function Detalle({ id }) {
  const { usuario } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [, setTic] = useState(0);

  useEffect(() => onSnapshot(doc(fbDb(), "devices", id),
    (s) => s.exists() ? setD({ id: s.id, ...s.data() }) : setError("Dispositivo no encontrado"),
    () => setError("No tienes acceso a este dispositivo (pertenece a otra organización o no existe).")), [id]);
  useEffect(() => { const i = setInterval(() => setTic((t) => t + 1), 15000); return () => clearInterval(i); }, []);

  if (error) return <><p className="error">{error}</p><Link href="/dashboard">← Volver</Link></>;
  if (!d) return <p className="tenue">Cargando…</p>;
  const l = d.ultimaLectura || {};
  const est = ESTADOS[l.e] || ESTADOS.normal;
  const online = enLinea(d);
  const esAdmin = usuario.role === "admin";

  return (
    <>
      <Link href="/dashboard" className="tenue">← Dispositivos</Link>
      <div className="fila-sep">
        <h2>{d.nombre} <small className="tenue">{d.ubicacion}</small></h2>
        <span className={`pastilla ${online ? "ok" : "off"}`}>{online ? "En línea" : "Sin conexión"} · {haceCuanto(d.ultimoContacto?.toMillis?.())}</span>
      </div>
      <section className="tarjeta">
        <div className="metricas grande">
          <div><small>Llenado</small><b>{fmt(l.p, 1, " %")}</b></div>
          <div><small>Altura del contenido</small><b>{fmt(l.nv, 1, " cm")}</b></div>
          <div><small>Temperatura</small><b>{fmt(l.tc, 1, " °C")}</b></div>
          <div><small>Humedad</small><b>{fmt(l.hr, 0, " %")}</b></div>
          <div><small>Se llenará en</small><b>{typeof l.hl === "number" ? `${l.hl} h` : "—"}</b></div>
          <div><small>Estado</small><b><span className={`pastilla ${est.clase}`}>{est.texto}</span></b></div>
        </div>
        <p className="tenue">Última lectura: {l.t ? fechaHora(l.t * 1000) : "—"} · Datos pendientes en la Raspberry: {d.pendientes ?? 0}</p>
      </section>
      <Historico id={id} ultimaLectura={d.ultimaLectura} />
      <div className="dos-col">
        <Salud salud={d.salud} />
        <AlertasDispositivo orgId={usuario.orgId} id={id} />
      </div>
      <Configuracion d={d} esAdmin={esAdmin} />
      {esAdmin && <Token d={d} />}
    </>
  );
}

export default function PaginaDispositivo({ params }) {
  const { id } = use(params);
  return <Protegido><Detalle id={id} /></Protegido>;
}
