"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, DeslizarParaActualizar, ErrorCarga } from "../../_componentes/comunes";
import { EsqueletoAvisos } from "../../_componentes/esqueletos";
import { apiMovil, SesionExpirada } from "../../_lib/api";
import { fechaCorta, primerNombre, useRefrescoAlAvisar } from "../../_lib/equipo";
import { fechaHora } from "../../_lib/tarea";
import { esMandoSesion } from "../../../../lib/movilSesion";

interface PersonaAviso {
  id: string;
  nombre: string;
  color: string | null;
  avatar_url: string | null;
}

interface DatosAvisos {
  hoy: string;
  personas: PersonaAviso[];
  porRevisar: { tareaId: number; empleadoId: string; fecha: string | null; titulo: string }[];
  nuevas?: { tareaId: number; empleadoId: string; titulo: string; fechaLimite: string | null; creada: string }[];
  porVencer: { tareaId: number; empleadoId: string; titulo: string; fechaLimite: string; avance: number }[];
  reuniones: { id: string; titulo: string; fecha: string; link: string | null; lugar: string | null; tareaId: number | null; participantes: string[] }[];
  recientes: { tareaId: number; empleadoId: string; titulo: string; aprobada: boolean; comentario: string | null; por: string | null; fecha: string }[];
}

function hace(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "Ahora";
  if (min < 60) return `Hace ${min} min`;
  if (min < 24 * 60) return `Hace ${Math.round(min / 60)} h`;
  return fechaHora(iso);
}

export default function AvisosPage() {
  const router = useRouter();
  const [datos, setDatos] = useState<DatosAvisos | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Trabajador: los avisos son de sus propias tareas y reuniones.
  const [mando] = useState(esMandoSesion);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      setDatos(await apiMovil<DatosAvisos>("/api/movil/avisos"));
    } catch (err: any) {
      if (err instanceof SesionExpirada) router.replace("/movil/login");
      else setError(err.message);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  useRefrescoAlAvisar(cargar);

  const persona = useMemo(() => {
    const m: Record<string, PersonaAviso> = {};
    (datos?.personas || []).forEach((p) => (m[p.id] = p));
    return (id: string) => m[id];
  }, [datos]);

  // Lo que espera revisión no es "por atender" para el trabajador: ya entregó.
  const total = datos
    ? (mando ? datos.porRevisar.length : 0) + datos.porVencer.length + datos.reuniones.length + (datos.nuevas?.length || 0)
    : 0;

  return (
    <DeslizarParaActualizar onActualizar={cargar}>
      <header className="bg-white border-b border-slate-200 px-4 pt-5 pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold text-slate-900">Avisos</h1>
          {datos && (
            <span className="text-[13px] text-slate-400">
              {total === 0 ? "todo al día" : `${total} por atender`}
            </span>
          )}
        </div>
      </header>

      {error ? (
        <ErrorCarga mensaje={error} reintentar={cargar} />
      ) : !datos ? (
        <EsqueletoAvisos />
      ) : (
        <div className="px-4 pt-3 flex flex-col gap-2">
          {total === 0 && datos.recientes.length === 0 && (
            <div className="text-center py-14">
              <p className="text-[15px] font-semibold text-slate-700">Todo al día</p>
              <p className="text-sm text-slate-500 mt-1">
                {mando
                  ? "Sin entregas por revisar ni tareas por vencer en tu equipo."
                  : "No tienes tareas por vencer ni reuniones próximas."}
              </p>
            </div>
          )}

          {/* Entregas por revisar */}
          {datos.porRevisar.length > 0 && <Titulo texto={mando ? "Por revisar" : "En revisión"} />}
          {datos.porRevisar.map((a) => {
            const p = persona(a.empleadoId);
            if (!mando) {
              return (
                <Link key={`rev-${a.tareaId}`} href={`/movil/tarea/${a.tareaId}`}>
                  <Tarjeta tono="azul" icono="revision">
                    <p className="text-sm font-semibold text-slate-900 leading-snug">
                      Enviaste esta tarea a revisión
                    </p>
                    <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">{a.titulo}</p>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      Esperando respuesta{a.fecha ? ` · ${hace(a.fecha)}` : ""}
                    </p>
                  </Tarjeta>
                </Link>
              );
            }
            return (
              <Tarjeta key={`rev-${a.tareaId}`} tono="azul" icono="revision">
                <p className="text-sm font-semibold text-slate-900 leading-snug">
                  {p ? primerNombre(p.nombre) : "Alguien"} envió una tarea a revisión
                </p>
                <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">{a.titulo}</p>
                <div className="flex items-center gap-2 mt-2.5">
                  <Link
                    href={`/movil/tarea/${a.tareaId}/revisar`}
                    className="h-9 px-3.5 rounded-[9px] bg-blue-600 text-white text-[13px] font-semibold flex items-center"
                  >
                    Revisar
                  </Link>
                  {a.fecha && <span className="text-[11px] text-slate-400">{hace(a.fecha)}</span>}
                </div>
              </Tarjeta>
            );
          })}

          {/* Tareas asignadas hace poco */}
          {(datos.nuevas?.length || 0) > 0 && <Titulo texto="Tareas nuevas" />}
          {(datos.nuevas || []).map((a) => {
            const p = persona(a.empleadoId);
            return (
              <Link key={`nue-${a.tareaId}`} href={`/movil/tarea/${a.tareaId}`}>
                <Tarjeta tono="azul" icono="revision">
                  <p className="text-sm font-semibold text-slate-900 leading-snug">
                    Tarea nueva asignada
                  </p>
                  <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">
                    {p ? `${primerNombre(p.nombre)} · ` : ""}
                    {a.titulo}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    {a.fechaLimite ? `Entrega ${fechaCorta(a.fechaLimite)} · ` : ""}
                    {hace(a.creada)}
                  </p>
                </Tarjeta>
              </Link>
            );
          })}

          {/* Tareas por vencer */}
          {datos.porVencer.length > 0 && <Titulo texto="Por vencer" />}
          {datos.porVencer.map((a) => {
            const p = persona(a.empleadoId);
            const vencida = a.fechaLimite.slice(0, 10) < datos.hoy;
            const hoy = a.fechaLimite.slice(0, 10) === datos.hoy;
            return (
              <Link key={`ven-${a.tareaId}`} href={`/movil/tarea/${a.tareaId}`}>
                <Tarjeta tono={vencida ? "rojo" : "ambar"} icono="reloj">
                  <p className="text-sm font-semibold text-slate-900 leading-snug">
                    {vencida ? `Venció el ${fechaCorta(a.fechaLimite)}` : hoy ? "Vence hoy" : `Vence el ${fechaCorta(a.fechaLimite)}`}: {a.titulo}
                  </p>
                  <p className="text-[13px] text-slate-500 mt-0.5">
                    {mando ? `${p ? primerNombre(p.nombre) : "El responsable"} va` : "Vas"} en {a.avance}%.
                  </p>
                </Tarjeta>
              </Link>
            );
          })}

          {/* Reuniones */}
          {datos.reuniones.length > 0 && <Titulo texto="Próximas reuniones" />}
          {datos.reuniones.map((r) => (
            <Tarjeta key={`reu-${r.id}`} tono="indigo" icono="reunion">
              <p className="text-sm font-semibold text-slate-900 leading-snug">{r.titulo}</p>
              <p className="text-[13px] text-slate-500 mt-0.5">
                {fechaHora(r.fecha)}
                {r.link ? " · Virtual" : r.lugar ? ` · ${r.lugar}` : ""}
              </p>
              {r.participantes.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  {r.participantes.slice(0, 5).map((id) => {
                    const p = persona(id);
                    return p ? <Avatar key={id} nombre={p.nombre} color={p.color} foto={p.avatar_url} tam={22} /> : null;
                  })}
                  {r.participantes.length > 5 && (
                    <span className="text-[11px] text-slate-400">+{r.participantes.length - 5}</span>
                  )}
                </div>
              )}
              {r.link && (
                <a href={r.link} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[13px] font-semibold text-indigo-600">
                  Abrir enlace
                </a>
              )}
            </Tarjeta>
          ))}

          {/* Decisiones recientes */}
          {datos.recientes.length > 0 && <Titulo texto="Últimos 3 días" />}
          {datos.recientes.map((d) => {
            const p = persona(d.empleadoId);
            return (
              <Link key={`dec-${d.tareaId}-${d.fecha}`} href={`/movil/tarea/${d.tareaId}`} className="opacity-75">
                <Tarjeta tono={d.aprobada ? "verde" : "naranja"} icono={d.aprobada ? "ok" : "corregir"}>
                  <p className="text-sm font-semibold text-slate-900 leading-snug">
                    {d.aprobada ? "Entrega aprobada" : "Se pidieron correcciones"}
                  </p>
                  <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">
                    {mando && p ? `${primerNombre(p.nombre)} · ` : ""}
                    {d.titulo}
                  </p>
                  {d.comentario && (
                    <p className="text-[13px] text-slate-600 mt-1 italic line-clamp-2">“{d.comentario}”</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    {d.por ? `${d.por} · ` : ""}
                    {hace(d.fecha)}
                  </p>
                </Tarjeta>
              </Link>
            );
          })}
        </div>
      )}
    </DeslizarParaActualizar>
  );
}

function Titulo({ texto }: { texto: string }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-2">
      {texto}
    </h2>
  );
}

const TONOS = {
  azul: ["border-slate-200", "bg-blue-50", "#2563eb"],
  ambar: ["border-amber-200", "bg-amber-50", "#d97706"],
  rojo: ["border-red-200", "bg-red-50", "#dc2626"],
  indigo: ["border-slate-200", "bg-indigo-50", "#4f46e5"],
  verde: ["border-slate-200", "bg-emerald-50", "#059669"],
  naranja: ["border-slate-200", "bg-orange-50", "#ea580c"],
} as const;

const ICONOS: Record<string, React.ReactNode> = {
  revision: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 10h6M9 14h6M9 18h4" />
      <rect x="9" y="2" width="6" height="3" rx="1" />
    </>
  ),
  reloj: <path d="M6 3h12M6 21h12M7 3c0 5 4 6 4 9s-4 4-4 9M17 3c0 5-4 6-4 9s4 4 4 9" />,
  reunion: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v3M16 3v3" />
    </>
  ),
  ok: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  corregir: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4" />,
};

function Tarjeta({
  tono,
  icono,
  children,
}: {
  tono: keyof typeof TONOS;
  icono: string;
  children: React.ReactNode;
}) {
  const [borde, fondo, color] = TONOS[tono];
  return (
    <div className={`bg-white border ${borde} rounded-xl p-3.5 flex gap-3`}>
      <span className={`w-[38px] h-[38px] rounded-[10px] ${fondo} flex items-center justify-center shrink-0`}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          {ICONOS[icono]}
        </svg>
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
