"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarSesion } from "../../../lib/movilSesion";
import { VerContrasena } from "../../../components/VerContrasena";

// Login de la PWA — pasa por /api/auth/login, el mismo endpoint que ya usa la
// extensión de Chrome (JWT propio). Entra cualquier integrante; lo que ve cada
// quien lo decide el servidor según su nivel.
export default function MovilLoginPage() {
  const router = useRouter();
  const [userInput, setUserInput] = useState("");
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userInput.trim(),
          password,
          app: "movil",
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.token) {
        throw new Error(data?.error || "No se pudo iniciar sesión.");
      }

      guardarSesion(data.token, data.employee);
      router.push("/movil");
    } catch (err: any) {
      setError(err.message || "Error al iniciar sesión.");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col justify-center px-6 py-10"
      style={{
        background: "linear-gradient(150deg, #e94f1b 0%, #21388e 100%)",
      }}
    >
      <div className="text-center mb-7">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_rocal_bl.png" alt="Rocal" className="w-40 mx-auto" />
        <p className="mt-2.5 text-[13px] font-medium text-white/90">
          ERP Empresarial · Rocal S.A. de C.V.
        </p>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full mx-auto">
        <h1 className="text-lg font-semibold text-slate-900">Iniciar sesión</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          Consulta tus tareas y reuniones y recibe recordatorios en el celular.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Usuario o correo
            </label>
            <input
              type="text"
              required
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="usuario o tu@empresa.com"
              autoComplete="username"
              className="w-full h-[50px] px-3.5 rounded-xl border border-slate-200 text-[15px] text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <input
                type={verPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full h-[50px] pl-3.5 pr-12 rounded-xl border border-slate-200 text-[15px] text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <VerContrasena
                visible={verPassword}
                onClick={() => setVerPassword((v) => !v)}
                className="px-3.5"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={cargando}
            className="h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[16px] font-semibold disabled:opacity-50 cursor-pointer transition-colors"
          >
            {cargando ? "Entrando…" : "Ingresar"}
          </button>
        </form>
      </div>

      <p className="text-center mt-5 text-xs text-white/80">
        ¿Olvidaste tu contraseña? Contacta a tu administrador.
      </p>
    </div>
  );
}
