"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, DeslizarParaActualizar, ErrorCarga } from "../_componentes/comunes";
import { EsqueletoTareas } from "../_componentes/esqueletos";
import { useConteoLeer } from "../_lib/conteoAvisos";
import { ProximasReuniones } from "../_componentes/ProximasReuniones";
import { esMandoSesion } from "../../../lib/movilSesion";
import {
  esPorRevisar,
  fechaCorta,
  ordenUrgente,
  primerNombre,
  urgencia,
  useDatosEquipo,
  type EmpleadoMovil,
  type TareaMovil,
} from "../_lib/equipo";

type Vista = "equipo" | "mias";
type Agrupar = "urgentes" | "persona" | "proyecto";

function saludo() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días,";
  if (h < 19) return "Buenas tardes,";
  return "Buenas noches,";
}

export default function TareasEquipoPage() {
  const { datos, error, recargar } = useDatosEquipo();
  const sinAtender = useConteoLeer();
  // Un trabajador solo ve lo suyo: sin "Mi equipo", sin revisar ni asignar.
  const [mando] = useState(esMandoSesion);
  const [vistaElegida, setVista] = useState<Vista>("equipo");
  const vista: Vista = mando ? vistaElegida : "mias";
  const [agrupar, setAgrupar] = useState<Agrupar>("urgentes");

  const porId = useMemo(() => {
    const m: Record<string, EmpleadoMovil> = {};
    (datos?.empleados || []).forEach((e) => (m[e.id] = e));
    return m;
  }, [datos]);

  const tareasEquipo = useMemo(
    () => (datos?.tareas || []).filter((t) => t.empleado_id !== datos?.yo.id),
    [datos],
  );
  const misTareas = useMemo(
    () =>
      (datos?.tareas || []).filter(
        (t) =>
          t.empleado_id === datos?.yo.id ||
          (t.colaboradores_ids || []).includes(datos?.yo.id || ""),
      ),
    [datos],
  );

  const lista = vista === "equipo" ? tareasEquipo : misTareas;

  const grupos = useMemo(() => {
    const ordenadas = [...lista].sort(ordenUrgente);
    if (agrupar === "urgentes") return [{ titulo: null, tareas: ordenadas }];
    const mapa = new Map<string, TareaMovil[]>();
    ordenadas.forEach((t) => {
      const clave =
        agrupar === "persona"
          ? porId[t.empleado_id]?.nombre || "Sin responsable"
          : t.proyecto || "Sin proyecto";
      mapa.set(clave, [...(mapa.get(clave) || []), t]);
    });
    return Array.from(mapa.entries())
      .sort(([a], [b]) => a.localeCompare(b, "es"))
      .map(([titulo, tareas]) => ({ titulo, tareas }));
  }, [lista, agrupar, porId]);

  if (error) return <ErrorCarga mensaje={error} reintentar={recargar} />;
  if (!datos) return <EsqueletoTareas />;

  const yo = porId[datos.yo.id];
  const porRevisar = mando ? tareasEquipo.filter(esPorRevisar).length : 0;
  const vencidas = lista.filter((t) => urgencia(t) === "vencida").length;

  return (
    <DeslizarParaActualizar onActualizar={recargar}>
      {/* Encabezado */}
      <header className="bg-white border-b border-slate-200 px-4 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <Avatar
            nombre={datos.yo.nombre}
            color={yo?.color}
            foto={yo?.avatar_url}
            tam={44}
          />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-slate-500">{saludo()}</p>
            <h1 className="text-[17px] font-semibold text-slate-900 leading-tight truncate">
              {datos.yo.nombre}
            </h1>
          </div>
          <Link
            href="/movil/avisos"
            className="relative w-11 h-11 flex items-center justify-center"
            aria-label="Avisos"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9Z" />
              <path d="M10.5 20a2 2 0 0 0 3 0" />
            </svg>
            {sinAtender > 0 && (
              <span className="absolute top-1 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px] font-semibold flex items-center justify-center border-2 border-white">
                {sinAtender > 99 ? "99+" : sinAtender}
              </span>
            )}
          </Link>
        </div>

        {/* Mi equipo / Mis tareas */}
        {mando && (
        <div className="flex bg-slate-100 rounded-[10px] p-[3px] mt-3">
          {(
            [
              ["equipo", "Mi equipo"],
              ["mias", "Mis tareas"],
            ] as const
          ).map(([clave, texto]) => (
            <button
              key={clave}
              type="button"
              onClick={() => setVista(clave)}
              className={`flex-1 py-[7px] rounded-lg text-[13px] cursor-pointer ${
                vista === clave
                  ? "bg-white shadow-sm font-semibold text-slate-900"
                  : "font-medium text-slate-500"
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
        )}
      </header>

      {/* Resumen */}
      <div className="flex gap-2 px-4 pt-3">
        {vista === "equipo" && (
          <Resumen titulo="Por revisar" valor={porRevisar} tono="azul" />
        )}
        <Resumen titulo="Vencidas" valor={vencidas} tono="rojo" />
        <Resumen titulo="Activas" valor={lista.length} tono="neutro" />
      </div>

      <ProximasReuniones />

      {/* Agrupar */}
      <div className="flex gap-1.5 px-4 pt-3 pb-2 overflow-x-auto [scrollbar-width:none]">
        {(
          [
            ["urgentes", "Urgentes primero"],
            ["persona", "Por persona"],
            ["proyecto", "Por proyecto"],
          ] as const
        )
          .filter(([clave]) => mando || clave !== "persona")
          .map(([clave, texto]) => (
          <button
            key={clave}
            type="button"
            onClick={() => setAgrupar(clave)}
            className={`shrink-0 px-3 py-2 rounded-full text-[13px] cursor-pointer ${
              agrupar === clave
                ? "bg-blue-600 text-white font-semibold"
                : "bg-white border border-slate-200 text-slate-600 font-medium"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="px-4 flex flex-col gap-2.5">
        {lista.length === 0 && (
          <p className="text-center text-sm text-slate-500 py-10">
            {vista === "equipo"
              ? "Tu equipo no tiene tareas activas."
              : "No tienes tareas activas."}
          </p>
        )}
        {grupos.map((g) => (
          <section key={g.titulo || "todas"} className="flex flex-col gap-2.5">
            {g.titulo && (
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-1">
                {g.titulo} · {g.tareas.length}
              </h2>
            )}
            {g.tareas.map((t) => (
              <TarjetaTarea
                key={t.id}
                tarea={t}
                responsable={porId[t.empleado_id]}
                mostrarResponsable={vista === "equipo"}
                puedeRevisar={mando}
              />
            ))}
          </section>
        ))}
      </div>

      {/* Asignar tarea */}
      {mando && (
      <Link
        href="/movil/asignar"
        className="fixed right-4 bottom-24 z-10 h-[52px] pl-3.5 pr-[18px] rounded-full bg-blue-600 text-white text-[15px] font-semibold flex items-center gap-1.5 shadow-[0_8px_20px_rgba(37,99,235,0.35)]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Asignar
      </Link>
      )}
      {/* Espacio para que el botón no tape la última tarjeta */}
      <div className="h-16" />
    </DeslizarParaActualizar>
  );
}

function Resumen({
  titulo,
  valor,
  tono,
}: {
  titulo: string;
  valor: number;
  tono: "azul" | "rojo" | "neutro";
}) {
  const estilos = {
    azul: ["border-blue-200", "text-blue-600", "text-blue-700"],
    rojo: ["border-red-200", "text-red-600", "text-red-600"],
    neutro: ["border-slate-200", "text-slate-400", "text-slate-900"],
  }[tono];
  return (
    <div className={`flex-1 bg-white border rounded-xl px-3 py-2.5 ${estilos[0]}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${estilos[1]}`}>
        {titulo}
      </div>
      <div className={`text-[22px] font-semibold tabular-nums leading-tight ${estilos[2]}`}>
        {valor}
      </div>
    </div>
  );
}

function TarjetaTarea({
  tarea: t,
  responsable,
  mostrarResponsable,
  puedeRevisar,
}: {
  tarea: TareaMovil;
  responsable?: EmpleadoMovil;
  mostrarResponsable: boolean;
  puedeRevisar: boolean;
}) {
  const revisar = esPorRevisar(t);
  // Para el trabajador su tarea "en revisión" solo espera respuesta: se abre
  // el seguimiento, no la pantalla de revisar.
  const abrirRevision = revisar && puedeRevisar;
  const urg = urgencia(t);
  const avance = Math.max(0, Math.min(100, t.porcentaje_avance ?? 0));
  const borde = revisar
    ? "border-blue-300 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
    : urg
      ? "border-rose-300"
      : "border-slate-200";

  return (
    <Link
      href={abrirRevision ? `/movil/tarea/${t.id}/revisar` : `/movil/tarea/${t.id}`}
      className={`block bg-white border rounded-xl px-3.5 py-3 active:bg-slate-50 ${borde}`}
    >
      <div className="flex items-center justify-between gap-2">
        {mostrarResponsable && responsable ? (
          <div className="flex items-center gap-2 min-w-0">
            <Avatar
              nombre={responsable.nombre}
              color={responsable.color}
              foto={responsable.avatar_url}
              tam={26}
            />
            <span className="text-[13px] font-semibold text-slate-700 truncate">
              {primerNombre(responsable.nombre)}
            </span>
          </div>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-100 px-[7px] py-[3px] rounded-md truncate">
            {t.proyecto || "Sin proyecto"}
          </span>
        )}

        {revisar ? (
          <span className="shrink-0 text-[10px] font-semibold text-white bg-blue-600 px-2 py-1 rounded-md">
            {puedeRevisar ? "Por revisar" : "En revisión"}
          </span>
        ) : urg ? (
          <span className="shrink-0 text-[10px] font-semibold text-white bg-rose-600 px-2 py-1 rounded-md">
            {urg === "vencida" ? `Venció ${fechaCorta(t.fecha_limite)}` : "Vence hoy"}
          </span>
        ) : t.revision_resultado === "Rechazado" ? (
          <span className="shrink-0 text-[10px] font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-1 rounded-md">
            En corrección
          </span>
        ) : t.fecha_limite ? (
          <span className="shrink-0 text-xs text-slate-500">
            {fechaCorta(t.fecha_limite)}
          </span>
        ) : null}
      </div>

      <h3 className="text-[15px] font-semibold text-slate-900 leading-snug mt-2">
        {t.titulo}
      </h3>

      <div className="flex justify-between items-center mt-2.5 text-[11px] font-medium text-slate-500">
        <span className="flex items-center gap-2 min-w-0">
          {mostrarResponsable && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-100 px-[7px] py-[3px] rounded-md truncate">
              {t.proyecto || "Sin proyecto"}
            </span>
          )}
          Avance
        </span>
        <span className="text-slate-800 font-semibold tabular-nums">{avance}%</span>
      </div>
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
        <div
          className={`h-full rounded-full ${urg ? "bg-rose-600" : "bg-blue-600"}`}
          style={{ width: `${avance}%` }}
        />
      </div>
    </Link>
  );
}
