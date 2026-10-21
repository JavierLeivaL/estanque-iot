"use client";
import { useEffect, useState } from "react";
import Protegido from "@/components/Protegido";
import { api, fechaHora } from "@/lib/client/api";
import { ROLES } from "@/lib/shared/config";

function Gestion() {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState({ email: "", password: "", role: "consulta" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const cargar = () => api("/users").then((r) => setLista(r.usuarios)).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  async function crear(e) {
    e.preventDefault();
    setError(""); setMsg("");
    try {
      await api("/users", { metodo: "POST", cuerpo: form });
      setMsg(`Usuario ${form.email} creado como ${ROLES[form.role]}.`);
      setForm({ email: "", password: "", role: "consulta" });
      cargar();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Usuarios de la organización</h2>
      <form className="tarjeta form-linea" onSubmit={crear}>
        <input type="email" placeholder="correo@ejemplo.cl" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input type="password" placeholder="Contraseña (mín. 6)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="consulta">Consulta (solo lectura)</option><option value="admin">Administrador</option>
        </select>
        <button>Crear usuario</button>
      </form>
      {msg && <p className="ok-txt">{msg}</p>}
      {error && <p className="error">{error}</p>}
      <table className="tarjeta"><thead><tr><th>Correo</th><th>Rol</th><th>Actualizado</th></tr></thead>
        <tbody>{lista.map((u) => <tr key={u.uid}><td>{u.email}</td><td>{ROLES[u.role] || u.role}</td><td>{fechaHora(u.actualizadoEn)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

export default function Usuarios() {
  return <Protegido soloAdmin><Gestion /></Protegido>;
}
