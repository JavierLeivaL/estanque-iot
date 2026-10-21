"use client";
// Firebase en el navegador: solo usa la configuración PÚBLICA del proyecto.
// Todo lo que el usuario puede leer lo controlan las Security Rules de Firestore.
// La inicialización es diferida (lazy) para que no se ejecute durante el build en Vercel.
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = () => (getApps().length ? getApp() : initializeApp(config));
export const fbAuth = () => getAuth(app());
export const fbDb = () => getFirestore(app());
