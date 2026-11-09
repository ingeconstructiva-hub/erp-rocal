"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { VerContrasena } from "../../components/VerContrasena";
import { guardarSesion } from "../../lib/movilSesion";

export default function LoginPage() {
  const router = useRouter();
  const [userInput, setUserInput] = useState(""); // Acepta tanto usuario como correo
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      // El inicio de sesión pasa por nuestra propia ruta en vez de llamar a
      // `supabase.auth.signInWithPassword` desde el navegador: así el servidor
      // puede limitar los intentos fallidos (el rate limit de Supabase Auth no
      // frena el grant de contraseña). La ruta resuelve usuario→correo, valida
      // el rol y deja la sesión en cookies.
      const res = await fetch("/api/auth/web-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Los administradores entran al panel; los demás integrantes (trabajadores,
        // practicantes…) entran a su panel con el login de la extensión/app móvil
        // (JWT). Solo se intenta si el motivo fue "no es administrador" o "no hay
        // cuenta web", nunca si está bloqueado por intentos.
        if (res.status === 401 || res.status === 403) {
          const alt = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userInput.trim(), password }),
          });
          const sesion = await alt.json().catch(() => ({}));
          const rol = String(sesion?.employee?.rol || "")
            .toLowerCase()
            .trim();
          const esAdmin = rol === "admin" || rol === "administrador";
          if (alt.ok && sesion?.token && !esAdmin) {
            guardarSesion(sesion.token, sesion.employee);
            router.push("/trabajador");
            return;
          }
        }
        throw new Error(data.error || "No se pudo iniciar sesión.");
      }

      // Refrescar para que el proxy vea las cookies recién puestas y redirigir.
      router.refresh();
      router.push("/");
    } catch (error: any) {
      console.error("Error durante inicio de sesión:", error);
      setErrorMessage(error.message || "Error al iniciar sesión.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#e94f1b] to-[#21388e] flex flex-col justify-center py-6 sm:px-3 lg:px-4 px-2 font-sans">
      {/* Encabezado e Isotipo */}
      <div className="sm:mx-auto w-full sm:max-w-md text-center">
        <img
          src="/logo_rocal_bl.png"
          alt="Logo Rocal"
          className="mx-auto h-50 w-100 object-contain"
        />

        <p className="mt-1.5 text-center text-sm font-medium text-white tracking-wide">
          ERP Empresarial - Rocal S.A. de C.V.
        </p>
      </div>

      <div className="mt-4 sm:mx-auto w-full sm:max-w-md">
        <div className="bg-white py-4 px-2 shadow-xl border border-slate-100 rounded-2xl sm:px-6">
          {/* Alerta de Error */}
          {errorMessage && (
            <div className="mb-2 p-1.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center gap-1">
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          <form className="space-y-3" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="userInput"
                className="block text-sm font-medium text-slate-700"
              >
                Usuario o Correo electrónico
              </label>
              <div className="mt-1">
                <input
                  id="userInput"
                  name="userInput"
                  type="text"
                  autoComplete="username"
                  required
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  className="appearance-none block w-full px-1.5 py-1.5 border border-slate-200 rounded-xl shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black text-sm transition-all"
                  placeholder="usuario o tu@empresa.com"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700"
              >
                Contraseña
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  name="password"
                  type={verPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full pl-1.5 pr-10 py-1.5 border border-slate-200 rounded-xl shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black text-sm transition-all"
                  placeholder="••••••••"
                />
                <VerContrasena
                  visible={verPassword}
                  onClick={() => setVerPassword((v) => !v)}
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-snug">
              Por seguridad, la sesión se cierra al cerrar el navegador.
            </p>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-1.5 px-2 border border-transparent rounded-xl shadow-md text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isLoading ? (
                  <span className="flex items-center gap-1">
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Validando credenciales...
                  </span>
                ) : (
                  "Ingresar al Panel"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
