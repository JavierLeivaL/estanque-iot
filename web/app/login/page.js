"use client";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { fbAuth } from "@/lib/client/firebase";

export default function Login() {
  const { usuario } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (usuario) router.replace("/dashboard"); }, [usuario, router]);

  async function entrar(e) {
    e.preventDefault();
    setError(""); setEnviando(true);
    try {
      await signInWithEmailAndPassword(fbAuth(), email.trim(), clave);
    } catch {
      setError("Correo o contraseña incorrectos");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="centro">
      <form className="tarjeta login" onSubmit={entrar}>
        <h1>◉ Estanques IoT</h1>
        <p className="tenue">Monitoreo de nivel de estanques y contenedores</p>
        <label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
        <label>Contraseña<input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <button disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}
