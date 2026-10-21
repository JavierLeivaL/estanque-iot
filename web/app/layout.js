import "./globals.css";
import AuthProvider from "@/components/AuthProvider";

export const metadata = {
  title: "Estanques IoT",
  description: "Monitoreo de nivel y temperatura de estanques y contenedores con Raspberry Pi",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
