"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { esMandoSesion } from "../../../lib/movilSesion";
import { useConteoAvisos } from "../_lib/conteoAvisos";
import { iniciales } from "../_lib/equipo";

export function Avatar({
  nombre,
  color,
  foto,
  tam = 40,
}: {
  nombre: string;
  color?: string | null;
  foto?: string | null;
  tam?: number;
}) {
  const estilo = { width: tam, height: tam, fontSize: Math.round(tam * 0.36) };
  if (foto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={foto}
        alt={nombre}
        style={estilo}
        className="rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <span
      style={{ ...estilo, background: color || "#64748b" }}
      className="rounded-full text-white font-semibold flex items-center justify-center shrink-0"
    >
      {iniciales(nombre)}
    </span>
  );
}

export function Cargando() {
  return (
    <div className="flex-1 flex items-center justify-center py-16">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <span className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
        Cargando…
      </div>
    </div>
  );
}

export function ErrorCarga({
  mensaje,
  reintentar,
}: {
  mensaje: string;
  reintentar: () => void;
}) {
  return (
    <div className="mx-4 mt-6 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
      <p>{mensaje}</p>
      <button
        type="button"
        onClick={reintentar}
        className="mt-3 h-10 px-4 rounded-lg bg-white border border-red-200 font-semibold cursor-pointer"
      >
        Reintentar
      </button>
    </div>
  );
}

// ---------- barra de navegación inferior ----------

const ICONOS: Record<string, React.ReactNode> = {
  tareas: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 10h6M9 14h6M9 18h4" />
      <rect x="9" y="2" width="6" height="3" rx="1" />
    </>
  ),
  avisos: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9Z" />
      <path d="M10.5 20a2 2 0 0 0 3 0" />
    </>
  ),
  equipo: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.3 2.9-5 6.5-5s6.5 1.7 6.5 5" />
      <path d="M16 5.5a3.5 3.5 0 0 1 0 6.9M21.5 20c0-2.6-1.6-4.2-4-4.7" />
    </>
  ),
  perfil: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </>
  ),
};

const PESTANAS = [
  { href: "/movil", clave: "tareas", texto: "Tareas" },
  { href: "/movil/avisos", clave: "avisos", texto: "Avisos" },
  { href: "/movil/equipo", clave: "equipo", texto: "Equipo" },
  { href: "/movil/perfil", clave: "perfil", texto: "Perfil" },
];

export function NavInferior() {
  const ruta = usePathname();
  const sinAtender = useConteoAvisos(ruta);
  // Equipo es de supervisión: un trabajador no lo ve.
  const pestanas = esMandoSesion() ? PESTANAS : PESTANAS.filter((p) => p.clave !== "equipo");
  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex px-2 pt-2.5 z-20"
      style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}
    >
      {pestanas.map((p) => {
        const activa =
          p.href === "/movil" ? ruta === "/movil" : ruta.startsWith(p.href);
        const color = activa ? "#2563eb" : "#94a3b8";
        return (
          <Link
            key={p.href}
            href={p.href}
            className="relative flex-1 flex flex-col items-center gap-1 min-h-11"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={color}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {ICONOS[p.clave]}
            </svg>
            <span
              className="text-[11px]"
              style={{ color, fontWeight: activa ? 600 : 500 }}
            >
              {p.texto}
            </span>
            {p.clave === "avisos" && sinAtender > 0 && (
              <span className="absolute top-[-4px] left-1/2 ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px] font-semibold flex items-center justify-center border-2 border-white">
                {sinAtender > 99 ? "99+" : sinAtender}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------- contactar a una persona ----------

// Número para wa.me: solo dígitos; a uno de 10 dígitos (México) se le antepone 52.
function numeroWhatsApp(tel: string) {
  const d = tel.replace(/\D/g, "");
  return d.length === 10 ? `52${d}` : d;
}

// Botón "Contactar" → menú con Llamar (marcador del teléfono) y WhatsApp.
// No se muestra si la persona no ha capturado su celular.
export function Contactar({
  telefono,
  compacto = false,
}: {
  telefono: string | null | undefined;
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  if (!telefono) return null;
  const opcion =
    "flex items-center gap-2 px-3.5 h-11 text-sm font-medium text-slate-700 active:bg-slate-50";
  return (
    <div className={compacto ? "relative shrink-0" : "relative w-full"}>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className={`font-semibold flex items-center gap-1.5 cursor-pointer ${
          compacto
            ? "h-9 px-3 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-[13px]"
            : "h-[50px] w-full justify-center rounded-[11px] bg-blue-600 text-white text-[15px]"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        </svg>
        Contactar
      </button>
      {abierto && (
        <div className="absolute right-0 top-full mt-1.5 z-20 w-44 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden divide-y divide-slate-100">
          <a href={`tel:${telefono.replace(/[^\d+]/g, "")}`} className={opcion}>
            Llamar
          </a>
          <a
            href={`https://wa.me/${numeroWhatsApp(telefono)}`}
            target="_blank"
            rel="noreferrer"
            className={opcion}
          >
            WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}

// ---------- archivo adjunto (evidencia, minuta) ----------

const EXT_IMAGEN = /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i;
const EXT_PDF = /\.pdf$/i;

// Imagen → vista previa en la misma pantalla (tocar la abre completa).
// PDF y otros → tarjeta que abre el archivo en el visor del teléfono.
// La URL viene firmada por la API (vence en 1 h).
export function Archivo({ nombre, url }: { nombre: string; url: string }) {
  const ruta = url.split("?")[0];
  const esImagen = EXT_IMAGEN.test(nombre) || EXT_IMAGEN.test(ruta);
  const esPdf = EXT_PDF.test(nombre) || EXT_PDF.test(ruta);

  if (esImagen) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mt-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={nombre}
          loading="lazy"
          className="w-full max-h-64 object-contain rounded-lg border border-slate-200 bg-slate-50"
        />
        <span className="block text-[11px] text-slate-400 mt-1 truncate">{nombre} · tocar para ampliar</span>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 active:bg-slate-50"
    >
      <span
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold ${
          esPdf ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"
        }`}
      >
        {esPdf ? "PDF" : (nombre.split(".").pop() || "").slice(0, 4).toUpperCase() || "DOC"}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-semibold text-slate-700 truncate">{nombre}</span>
        <span className="block text-[11px] text-blue-600">Abrir documento</span>
      </span>
    </a>
  );
}

// ---------- deslizar para actualizar ("pull to refresh") ----------

const UMBRAL = 64; // px (ya amortiguados) para que al soltar se actualice
const MAXIMO = 96;

// Envuelve el contenido de una pantalla de consulta. Estando hasta arriba,
// jalar hacia abajo muestra el indicador; al soltar pasado el umbral llama a
// `onActualizar` (los datos actuales siguen visibles mientras recarga).
export function DeslizarParaActualizar({
  onActualizar,
  children,
}: {
  onActualizar: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const [distancia, setDistancia] = useState(0);
  const [actualizando, setActualizando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const inicioY = useRef<number | null>(null);

  const alTocar = (e: React.TouchEvent) => {
    if (actualizando || window.scrollY > 0) return;
    inicioY.current = e.touches[0].clientY;
  };

  const alMover = (e: React.TouchEvent) => {
    if (inicioY.current === null) return;
    const d = e.touches[0].clientY - inicioY.current;
    if (d <= 0 || window.scrollY > 0) {
      setDistancia(0);
      return;
    }
    setArrastrando(true);
    // Amortiguado: cuesta más jalar entre más se baja.
    setDistancia(Math.min(MAXIMO, d * 0.5));
  };

  const alSoltar = async () => {
    if (inicioY.current === null) return;
    inicioY.current = null;
    setArrastrando(false);
    if (distancia < UMBRAL) {
      setDistancia(0);
      return;
    }
    setActualizando(true);
    setDistancia(48);
    try {
      await onActualizar();
    } finally {
      setActualizando(false);
      setDistancia(0);
    }
  };

  const listo = distancia >= UMBRAL;

  return (
    <div onTouchStart={alTocar} onTouchMove={alMover} onTouchEnd={alSoltar} onTouchCancel={alSoltar}>
      <div
        aria-hidden={!actualizando}
        className={`flex items-end justify-center overflow-hidden ${arrastrando ? "" : "transition-[height] duration-200"}`}
        style={{ height: distancia }}
      >
        <span className="mb-2 w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center">
          {actualizando ? (
            <span className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={listo ? "#2563eb" : "#94a3b8"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: `rotate(${listo ? 180 : (distancia / UMBRAL) * 180}deg)` }}
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          )}
        </span>
      </div>
      {actualizando && <span className="sr-only" role="status">Actualizando…</span>}
      {children}
    </div>
  );
}
