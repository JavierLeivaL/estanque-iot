"use client";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { fbAuth } from "@/lib/client/firebase";

const Ctx = createContext({ usuario: null, cargando: true });
export const useAuth = () => useContext(Ctx);

export default function AuthProvider({ children }) {
  const [estado, setEstado] = useState({ usuario: null, cargando: true });
  const router = useRouter();
  const ruta = usePathname();

  useEffect(() => onAuthStateChanged(fbAuth(), async (u) => {
    if (!u) return setEstado({ usuario: null, cargando: false });
    const tok = await u.getIdTokenResult(true); // fuerza leer los claims más recientes
    setEstado({
      usuario: { uid: u.uid, email: u.email, orgId: tok.claims.orgId || null, role: tok.claims.role || null },
      cargando: false,
    });
  }), []);

  useEffect(() => {
    if (!estado.cargando && !estado.usuario && ruta !== "/login") router.replace("/login");
  }, [estado, ruta, router]);

  return <Ctx.Provider value={{ ...estado, salir: () => signOut(fbAuth()) }}>{children}</Ctx.Provider>;
}
