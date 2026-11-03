"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { renderRich } from "../../../../../lib/textoRico";
import { Archivo, Avatar, Contactar, DeslizarParaActualizar, ErrorCarga } from "../../../_componentes/comunes";
import { EsqueletoDetalle } from "../../../_componentes/esqueletos";
import { esPorRevisar, fechaCorta, urgencia } from "../../../_lib/equipo";
import { esMandoSesion } from "../../../../../lib/movilSesion";
import {
  especialidadVisible,
  fechaHora,
  useDetalleTarea,
  type DetalleTarea,
  type EventoHilo,
} from "../../../_lib/tarea";

const ESTILO_EVENTO: Record<EventoHilo["tipo"], { color: string; icono: React.ReactNode }> = {
  revision: {
    color: "#2563eb",
    icono: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />,
  },
  reunion: {
    color: "#4f46e5",
    icono: (
      <>
        <rect x="3" y="4.5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v3M16 3v3" />
      </>
    ),
  },
  decision: { color: "#059669", icono: <path d="M20 6 9 17l-5-5" /> },
  minuta: {
    color: "#64748b",
    icono: (
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
        <path d="M14 3v6h6M8 13h8M8 17h5" />
      </>
    ),
  },
};

export default function SeguimientoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { datos, error, cargar } = useDetalleTarea(id);

  const volver = () =>
    window.history.length > 1 ? router.back() : router.push("/movil");

  return (
    <DeslizarParaActualizar onActualizar={cargar}>
      <header className="bg-white border-b border-slate-200 px-4 pt-5 pb-3.5 flex items-center gap-3 sticky top-0 z-10">
        <button
          type="button"
          onClick={volver}
          aria-label="Volver"
          className="w-10 h-10 -ml-2 flex items-center justify-center cursor-pointer"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-slate-900">Seguimiento de actividad</h1>
      </header>

      {error ? (
        <ErrorCarga mensaje={error} reintentar={cargar} />
      ) : !datos ? (
        <EsqueletoDetalle />
      ) : (
        <>
          <Contenido tarea={datos.tarea} hilo={datos.hilo} />
          {esPorRevisar(datos.tarea) && esMandoSesion() && (
            <>
              {/* Espacio para que la barra no tape el final del hilo */}
              <div className="h-20" />
              <div className="fixed inset-x-0 bottom-[76px] z-10 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3">
                <Link
                  href={`/movil/tarea/${datos.tarea.id}/revisar`}
                  className="h-[50px] rounded-xl bg-blue-600 text-white text-[15px] font-semibold flex items-center justify-center gap-2"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="4" width="12" height="17" rx="2" />
                    <path d="M9 10h6M9 14h6M9 18h4" />
                    <rect x="9" y="2" width="6" height="3" rx="1" />
                  </svg>
                  Revisar entrega
                </Link>
              </div>
            </>
          )}
        </>
      )}
    </DeslizarParaActualizar>
  );
}

function Contenido({ tarea: t, hilo }: { tarea: DetalleTarea; hilo: EventoHilo[] }) {
  const avance = Math.max(0, Math.min(100, t.porcentaje_avance ?? 0));
  const urg = urgencia(t);
  const r = t.responsable;
  const especialidad = especialidadVisible(r);

  return (
    <div className="px-4 py-3 flex flex-col gap-2.5">
      {/* Título */}
      <section className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-100 px-[7px] py-[3px] rounded-md">
            {t.proyecto || "Sin proyecto"}
          </span>
          {t.prioridad && (
            <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-[7px] py-[3px] rounded-md">
              {t.prioridad}
            </span>
          )}
          <span className="text-[10px] font-semibold text-white bg-blue-600 px-2 py-1 rounded-md">
            {t.estado}
          </span>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 leading-snug mt-2.5">{t.titulo}</h2>
        {t.descripcion && (
          <p className="text-[13px] text-slate-600 leading-relaxed mt-1.5 whitespace-pre-wrap">
            {t.descripcion}
          </p>
        )}
      </section>

      {/* Responsable */}
      {r && (
        <section className="bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar nombre={r.nombre} color={r.color} foto={r.avatar_url} tam={42} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{r.nombre}</p>
              <p className="text-xs text-slate-400">
                Responsable{especialidad ? ` · ${especialidad}` : ""}
              </p>
            </div>
            <Contactar telefono={r.celular} compacto />
          </div>
          {(t.colaboradores.length > 0 || t.asignadaPor) && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
              {t.colaboradores.length > 0 ? (
                <span className="flex items-center gap-2 min-w-0">
                  <span className="flex">
                    {t.colaboradores.map((c, i) => (
                      <span key={c.id} className={i ? "-ml-2" : ""}>
                        <Avatar nombre={c.nombre} color={c.color} foto={c.avatar_url} tam={26} />
                      </span>
                    ))}
                  </span>
                  <span className="truncate">
                    {t.colaboradores.map((c) => c.nombre.split(" ")[0]).join(", ")}
                  </span>
                </span>
              ) : (
                <span />
              )}
              {t.asignadaPor && <span className="shrink-0">Asignó: {t.asignadaPor.split(" ")[0]}</span>}
            </div>
          )}
        </section>
      )}

      {/* Avance */}
      <section className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
        <div className="flex justify-between items-baseline">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Avance reportado
          </span>
          <span className="text-xl font-semibold text-slate-900 tabular-nums">{avance}%</span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-2.5">
          <div
            className={`h-full rounded-full ${urg ? "bg-rose-600" : "bg-blue-600"}`}
            style={{ width: `${avance}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-2.5">
          <span className="text-slate-400">
            {t.fecha_asignada ? `Asignada ${fechaCorta(t.fecha_asignada)}` : ""}
          </span>
          <span className={urg ? "text-red-600 font-semibold" : "text-slate-600"}>
            {t.fecha_limite
              ? `${urg === "vencida" ? "Venció" : urg === "hoy" ? "Vence hoy ·" : "Vence"} ${fechaCorta(t.fecha_limite)}`
              : "Sin fecha límite"}
          </span>
        </div>
        {t.revision_resultado === "Rechazado" && t.revision_comentario && (
          <div className="mt-3 bg-orange-50 border-l-[3px] border-orange-500 rounded-md px-3 py-2">
            <p className="text-[11px] font-semibold text-orange-700">
              En corrección{t.revision_por ? ` · pidió ${t.revision_por.split(" ")[0]}` : ""}
            </p>
            <p className="text-[13px] text-slate-700 mt-0.5 whitespace-pre-wrap">
              {t.revision_comentario}
            </p>
          </div>
        )}
      </section>

      {/* Hilo de seguimiento */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-1 mb-2">
          Seguimiento · {hilo.length}
        </h3>
        {hilo.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-5 text-center">
            Todavía no hay envíos, reuniones ni minutas en esta tarea.
          </p>
        ) : (
          <ol className="relative ml-3 border-l border-slate-200">
            {hilo.map((ev) => {
              const estilo = ESTILO_EVENTO[ev.tipo];
              const color = ev.tipo === "decision" && !ev.aprobada ? "#ea580c" : estilo.color;
              return (
                <li key={ev.clave} className="relative pl-6 pb-3 last:pb-0">
                  <span
                    className="absolute -left-[13px] top-0.5 w-[26px] h-[26px] rounded-full bg-white border-2 flex items-center justify-center"
                    style={{ borderColor: color }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {ev.tipo === "decision" && !ev.aprobada ? <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4" /> : estilo.icono}
                    </svg>
                  </span>
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-semibold text-slate-900 leading-snug">{ev.titulo}</p>
                      <span className="text-[11px] text-slate-400 shrink-0">{fechaHora(ev.fecha)}</span>
                    </div>
                    {ev.detalle && <p className="text-[11px] text-slate-500 mt-0.5">{ev.detalle}</p>}
                    {ev.cuerpo && (
                      <p
                        className="text-[13px] text-slate-600 mt-1 whitespace-pre-wrap break-words [&_a]:break-all"
                        dangerouslySetInnerHTML={renderRich(ev.cuerpo)}
                      />
                    )}
                    {ev.archivo?.url && <Archivo nombre={ev.archivo.nombre} url={ev.archivo.url} />}
                    {ev.enlace && (
                      <a
                        href={ev.enlace}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-block text-[13px] font-medium text-blue-600"
                      >
                        Abrir enlace de la reunión
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
