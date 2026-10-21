"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { ROLES } from "@/lib/shared/config";

/** Marco común de las páginas privadas: barra de navegación + control de sesión/rol. */
export default function Protegido({ children, soloAdmin = false }) {
  const { usuario, cargando, salir } = useAuth();
  const ruta = usePathname();
  if (cargando || !usuario) return <main className="centro"><p className="tenue">Cargando…</p></main>;
  if (!usuario.orgId) return <main className="centro"><p>Tu usuario no tiene organización asignada. Pide a un administrador que te agregue.</p><button onClick={salir}>Salir</button></main>;

  const enlaces = [["/dashboard", "Panel"], ["/alertas", "Alertas"], ...(usuario.role === "admin" ? [["/usuarios", "Usuarios"]] : [])];
  return (
    <>
      <header className="barra">
        <Link href="/dashboard" className="marca">◉ Estanques IoT</Link>
        <nav>{enlaces.map(([href, txt]) => <Link key={href} href={href} className={ruta.startsWith(href) ? "activo" : ""}>{txt}</Link>)}</nav>
        <div className="sesion">
          <span className="tenue">{usuario.email} · {ROLES[usuario.role] || usuario.role} · org: {usuario.orgId}</span>
          <button className="sec" onClick={salir}>Salir</button>
        </div>
      </header>
      <main className="contenido">
        {soloAdmin && usuario.role !== "admin" ? <p>Esta sección es solo para administradores.</p> : children}
      </main>
    </>
  );
}
