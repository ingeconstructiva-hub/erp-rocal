"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../components/icons";
import { ModalOverlay } from "../../components/ModalOverlay";
import { llevaHoras } from "../../lib/convenios";
import { hoyMx } from "../../lib/enObra";
import { formatFechaLimite } from "../../lib/dates";
import { cerrarSesion, leerSesion } from "../../lib/movilSesion";
import { apiMovil, SesionExpirada } from "../movil/_lib/api";

// Panel del trabajador en el ERP web: solo SUS tareas (y las que colabora).
// Usa el mismo JWT y las mismas rutas /api que la extensión y la app móvil;
// el servidor es quien limita lo que puede ver y hacer (nada de datos de otros).

interface Tarea {
  id: number | string;
  titulo: string | null;
  descripcion: string | null;
  estado: string | null;
  fecha_limite: string | null;
  porcentaje_avance: number | null;
  revision_resultado: string | null;
  revision_comentario: string | null;
  revision_por: string | null;
  revision_fecha: string | null;
  depende_de_tarea_id: number | null;
  proyectos?: { nombre: string } | null;
}

interface Reunion {
  id: number | string;
  titulo: string;
  proyecto_nombre: string;
  fecha: string;
  hora: string;
  link: string | null;
  estado: string;
}

interface Recompensas {
  puntosRecompensa: number;
  historial: {
    id: string | number;
    puntos: number;
    motivo: string;
    created_at: string;
  }[];
}

type Seccion = "tareas" | "reuniones" | "recompensas" | "horas";
type Filtro = "activas" | "revision" | "completadas";

const MAX_EVIDENCIA_BYTES = 3 * 1024 * 1024; // el envío es JSON/base64: más pesado no cabe en la petición

const NIVELES = [
  { min: 0, label: "Bronce" },
  { min: 300, label: "Plata" },
  { min: 800, label: "Oro" },
  { min: 1500, label: "Diamante" },
];

const tipoTarea = (t: Tarea) => {
  const st = (t.estado || "").toLowerCase();
  if (st.includes("completa")) return "completada" as const;
  if (st.includes("revisi")) return "revision" as const;
  if (st === "pendiente") return "bloqueada" as const;
  return "activa" as const;
};
const porCorregir = (t: Tarea) =>
  t.revision_resultado === "Rechazado" && tipoTarea(t) === "activa";
const vencida = (t: Tarea) =>
  tipoTarea(t) === "activa" &&
  !!t.fecha_limite &&
  t.fecha_limite.slice(0, 10) < hoyMx();

const aBase64 = (archivo: File) =>
  new Promise<string>((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1] || "");
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });

const fechaHoraCorta = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleString("es-MX", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
};

export default function TrabajadorPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<ReturnType<typeof leerSesion>>(null);
  const [listo, setListo] = useState(false);
  const [seccion, setSeccion] = useState<Seccion>("tareas");

  const [tareas, setTareas] = useState<Tarea[] | null>(null);
  const [reuniones, setReuniones] = useState<Reunion[] | null>(null);
  const [recompensas, setRecompensas] = useState<Recompensas | null>(null);
  const [error, setError] = useState<string | null>(null);

  const salir = useCallback(() => {
    cerrarSesion();
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const s = leerSesion();
    if (!s) {
      router.replace("/login");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSesion(s);
    setListo(true);
  }, [router]);

  const empleadoId = sesion?.employee.id;

  const cargar = useCallback(async () => {
    if (!empleadoId) return;
    try {
      setError(null);
      const [t, r, p] = await Promise.all([
        apiMovil<{ tareas: Tarea[] }>(`/api/tareas?employeeId=${empleadoId}`),
        apiMovil<Reunion[]>(`/api/reuniones?employeeId=${empleadoId}`),
        apiMovil<Recompensas>(`/api/recompensas?employeeId=${empleadoId}`),
      ]);
      setTareas(t.tareas || []);
      setReuniones(Array.isArray(r) ? r : []);
      setRecompensas(p);
    } catch (e) {
      if (e instanceof SesionExpirada) return salir();
      setError((e as Error).message);
    }
  }, [empleadoId, salir]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  // Se refresca solo: un coordinador puede asignar o decidir una revisión en cualquier momento.
  useEffect(() => {
    const id = setInterval(cargar, 60_000);
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargar]);

  if (!listo || !sesion) return null;
  const emp = sesion.employee;
  const conHoras = llevaHoras(emp.rol);

  const secciones: {
    clave: Seccion;
    texto: string;
    icono: React.ComponentProps<typeof Icon>["name"];
  }[] = [
    { clave: "tareas", texto: "Mis tareas", icono: "clipboard" },
    { clave: "reuniones", texto: "Reuniones", icono: "calendar" },
    { clave: "recompensas", texto: "Recompensas", icono: "award" },
    ...(conHoras
      ? [{ clave: "horas" as const, texto: "Horas", icono: "timer" as const }]
      : []),
  ];

  const porCorregirN = (tareas || []).filter(porCorregir).length;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold truncate">{emp.nombre}</h1>
            <p className="text-xs text-slate-500">
              {emp.rol} · Panel del trabajador
            </p>
          </div>
          <button
            type="button"
            onClick={salir}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-lg px-2.5 py-1.5 cursor-pointer"
          >
            <Icon name="log-out" size={14} /> Cerrar sesión
          </button>
        </div>
        <nav className="max-w-5xl mx-auto px-4 flex gap-1">
          {secciones.map((s) => (
            <button
              key={s.clave}
              type="button"
              onClick={() => setSeccion(s.clave)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 cursor-pointer ${
                seccion === s.clave
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon name={s.icono} size={14} />
              {s.texto}
              {s.clave === "tareas" && porCorregirN > 0 && (
                <span className="bg-rose-600 text-white text-[10px] rounded-full px-1.5">
                  {porCorregirN}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4">
        {error && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={cargar}
              className="font-semibold underline cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        )}

        {seccion === "tareas" && (
          <SeccionTareas tareas={tareas} onCambio={cargar} onSalir={salir} />
        )}
        {seccion === "reuniones" && <SeccionReuniones reuniones={reuniones} />}
        {seccion === "recompensas" && (
          <SeccionRecompensas datos={recompensas} />
        )}
        {seccion === "horas" && conHoras && (
          <SeccionHoras empleadoId={emp.id} onSalir={salir} />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- Tareas

function SeccionTareas({
  tareas,
  onCambio,
  onSalir,
}: {
  tareas: Tarea[] | null;
  onCambio: () => void;
  onSalir: () => void;
}) {
  const [filtro, setFiltro] = useState<Filtro>("activas");
  const [enviando, setEnviando] = useState<Tarea | null>(null);

  const lista = useMemo(() => {
    const base = (tareas || []).filter((t) => {
      const tipo = tipoTarea(t);
      if (filtro === "completadas") return tipo === "completada";
      if (filtro === "revision") return tipo === "revision";
      return tipo === "activa" || tipo === "bloqueada";
    });
    const peso = (t: Tarea) => (porCorregir(t) ? 0 : vencida(t) ? 1 : 2);
    return base.sort(
      (a, b) =>
        peso(a) - peso(b) ||
        (a.fecha_limite || "9999").localeCompare(b.fecha_limite || "9999"),
    );
  }, [tareas, filtro]);

  const cuenta = (f: Filtro) =>
    (tareas || []).filter((t) => {
      const tipo = tipoTarea(t);
      return f === "completadas"
        ? tipo === "completada"
        : f === "revision"
          ? tipo === "revision"
          : tipo === "activa" || tipo === "bloqueada";
    }).length;

  return (
    <>
      <div className="flex gap-1.5 mb-3">
        {(
          [
            ["activas", "Por hacer"],
            ["revision", "En revisión"],
            ["completadas", "Completadas"],
          ] as const
        ).map(([clave, texto]) => (
          <button
            key={clave}
            type="button"
            onClick={() => setFiltro(clave)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border cursor-pointer ${
              filtro === clave
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {texto} <span className="opacity-70">({cuenta(clave)})</span>
          </button>
        ))}
      </div>

      {!tareas ? (
        <p className="text-sm text-slate-400 text-center py-10">
          Cargando tus tareas…
        </p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">
          {filtro === "activas"
            ? "No tienes tareas pendientes."
            : filtro === "revision"
              ? "No tienes tareas en revisión."
              : "Aún no has completado tareas."}
        </p>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {lista.map((t) => (
            <TarjetaTarea
              key={t.id}
              tarea={t}
              onEnviar={() => setEnviando(t)}
              onAvance={onCambio}
              onSalir={onSalir}
            />
          ))}
        </div>
      )}

      {enviando && (
        <ModalEnviar
          tarea={enviando}
          onClose={() => setEnviando(null)}
          onEnviada={() => {
            setEnviando(null);
            onCambio();
          }}
          onSalir={onSalir}
        />
      )}
    </>
  );
}

function TarjetaTarea({
  tarea: t,
  onEnviar,
  onAvance,
  onSalir,
}: {
  tarea: Tarea;
  onEnviar: () => void;
  onAvance: () => void;
  onSalir: () => void;
}) {
  const tipo = tipoTarea(t);
  const corregir = porCorregir(t);
  const venc = vencida(t);
  const [avance, setAvance] = useState(t.porcentaje_avance ?? 0);
  const [guardando, setGuardando] = useState(false);
  const [errorAvance, setErrorAvance] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvance(t.porcentaje_avance ?? 0);
  }, [t.porcentaje_avance]);

  const guardarAvance = async () => {
    setGuardando(true);
    setErrorAvance(null);
    try {
      await apiMovil("/api/tareas", {
        method: "PATCH",
        body: JSON.stringify({ taskId: t.id, porcentajeAvance: avance }),
      });
      onAvance();
    } catch (e) {
      if (e instanceof SesionExpirada) return onSalir();
      setErrorAvance((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const insignia = corregir
    ? { texto: "Corregir", clase: "bg-rose-50 text-rose-700 border-rose-200" }
    : tipo === "completada"
      ? {
          texto: "Completada",
          clase: "bg-emerald-50 text-emerald-700 border-emerald-200",
        }
      : tipo === "revision"
        ? {
            texto: "En revisión",
            clase: "bg-blue-50 text-blue-700 border-blue-200",
          }
        : tipo === "bloqueada"
          ? {
              texto: "Espera otra tarea",
              clase: "bg-slate-100 text-slate-600 border-slate-200",
            }
          : venc
            ? {
                texto: "Vencida",
                clase: "bg-rose-50 text-rose-700 border-rose-200",
              }
            : {
                texto: "En proceso",
                clase: "bg-amber-50 text-amber-700 border-amber-200",
              };

  return (
    <div
      className={`bg-white border rounded-xl p-3 space-y-2 ${
        corregir || venc ? "border-rose-300" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md uppercase tracking-wide">
            <Icon name="folder" size={10} /> {t.proyectos?.nombre || "General"}
          </span>
          <h3 className="font-semibold text-[14px] mt-1 leading-snug">
            {t.titulo || "Tarea sin título"}
          </h3>
        </div>
        <span
          className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${insignia.clase}`}
        >
          {insignia.texto}
        </span>
      </div>

      {t.descripcion && (
        <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-100 rounded-lg p-2 whitespace-pre-wrap">
          {t.descripcion}
        </p>
      )}

      {corregir && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-2">
          <p className="text-[11px] font-semibold text-rose-800 flex items-center gap-1">
            <Icon name="message-square" size={12} /> Correcciones de{" "}
            {t.revision_por || "tu coordinador"}
            {t.revision_fecha && (
              <span className="font-normal text-rose-600">
                {" "}
                · {fechaHoraCorta(t.revision_fecha)}
              </span>
            )}
          </p>
          <p className="text-xs text-rose-900 mt-0.5 whitespace-pre-wrap">
            {t.revision_comentario || "Revisa la tarea y vuelve a enviarla."}
          </p>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Icon name="calendar" size={12} />
        <span className={venc ? "text-rose-700 font-semibold" : ""}>
          {t.fecha_limite
            ? formatFechaLimite(t.fecha_limite)
            : "Sin fecha límite"}
        </span>
      </div>

      {tipo === "activa" && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Avance</span>
            <span className="font-mono text-slate-800">{avance}%</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={avance}
              onChange={(e) => setAvance(Number(e.target.value))}
              className="flex-1 accent-blue-600"
            />
            {avance !== (t.porcentaje_avance ?? 0) && (
              <button
                type="button"
                disabled={guardando}
                onClick={guardarAvance}
                className="text-[11px] font-semibold text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md px-2 py-1 disabled:opacity-50 cursor-pointer"
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            )}
          </div>
          {errorAvance && (
            <p className="text-[11px] text-red-600">{errorAvance}</p>
          )}
        </div>
      )}

      {tipo === "activa" && (
        <button
          type="button"
          onClick={onEnviar}
          className="w-full inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg py-2 cursor-pointer"
        >
          <Icon name="send" size={13} />
          {corregir ? "Reenviar a revisión" : "Enviar a revisión"}
        </button>
      )}
      {tipo === "revision" && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1">
          <Icon name="hourglass" size={12} /> Esperando la respuesta de tu
          coordinador.
        </p>
      )}
    </div>
  );
}

function ModalEnviar({
  tarea,
  onClose,
  onEnviada,
  onSalir,
}: {
  tarea: Tarea;
  onClose: () => void;
  onEnviada: () => void;
  onSalir: () => void;
}) {
  const [comentarios, setComentarios] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yaEnvio = useRef(false);

  const elegir = (f: File | null) => {
    setError(null);
    if (f && f.size > MAX_EVIDENCIA_BYTES) {
      setError("El archivo supera los 3 MB. Comprímelo o súbelo en partes.");
      return;
    }
    setArchivo(f);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    // Un doble clic no debe crear dos revisiones.
    if (yaEnvio.current) return;
    yaEnvio.current = true;
    setEnviando(true);
    setError(null);
    try {
      await apiMovil("/api/revisiones", {
        method: "POST",
        body: JSON.stringify({
          taskId: tarea.id,
          taskTitle: tarea.titulo || "Tarea",
          comentarios: comentarios.trim() || undefined,
          ...(archivo
            ? {
                evidenciaBase64: await aBase64(archivo),
                evidenciaNombre: archivo.name,
                evidenciaTipo: archivo.type,
              }
            : {}),
        }),
      });
      onEnviada();
    } catch (err) {
      yaEnvio.current = false;
      if (err instanceof SesionExpirada) return onSalir();
      setError((err as Error).message);
      setEnviando(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 p-4 space-y-3">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold">Enviar a revisión</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <form onSubmit={enviar} className="space-y-3 text-xs">
          <p className="text-slate-600">
            Tu coordinador recibirá{" "}
            <strong className="text-slate-900">“{tarea.titulo}”</strong> para
            revisarla.
          </p>

          <div>
            <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
              Comentarios (opcional)
            </label>
            <textarea
              rows={3}
              value={comentarios}
              onChange={(e) => setComentarios(e.target.value)}
              placeholder="Qué hiciste, qué debe revisar…"
              className="w-full border border-slate-300 rounded-xl p-2 text-slate-900 bg-white outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
              Evidencia (opcional, máx. 3 MB)
            </label>
            <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-xl p-2 cursor-pointer hover:bg-slate-50">
              <Icon name="paperclip" size={14} className="text-slate-400" />
              <span className="truncate text-slate-600">
                {archivo ? archivo.name : "Adjuntar foto, PDF u otro archivo"}
              </span>
              <input
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                className="hidden"
                onChange={(e) => elegir(e.target.files?.[0] || null)}
              />
            </label>
            {archivo && (
              <button
                type="button"
                onClick={() => setArchivo(null)}
                className="text-[11px] text-slate-500 underline mt-1 cursor-pointer"
              >
                Quitar archivo
              </button>
            )}
          </div>

          {error && (
            <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-xl font-bold cursor-pointer"
            >
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}

// ------------------------------------------------------------- Reuniones

function SeccionReuniones({ reuniones }: { reuniones: Reunion[] | null }) {
  if (!reuniones)
    return (
      <p className="text-sm text-slate-400 text-center py-10">Cargando…</p>
    );
  const hoy = hoyMx();
  const proximas = reuniones.filter((r) => (r.fecha || "") >= hoy);
  if (proximas.length === 0)
    return (
      <p className="text-sm text-slate-400 text-center py-10">
        Sin reuniones programadas.
      </p>
    );

  return (
    <div className="grid gap-2.5 md:grid-cols-2">
      {proximas.map((r) => (
        <div
          key={r.id}
          className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5"
        >
          <h3 className="font-semibold text-[14px] leading-snug">{r.titulo}</h3>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <Icon name="calendar" size={12} /> {formatFechaLimite(r.fecha)} ·{" "}
            {r.hora || "Por definir"}
          </p>
          <p className="text-[11px] text-slate-400 flex items-center gap-1">
            <Icon name="folder" size={11} /> {r.proyecto_nombre}
          </p>
          {r.link && (
            <a
              href={r.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-lg px-2.5 py-1.5"
            >
              <Icon name="video" size={13} /> Unirme a la reunión
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------- Recompensas

function SeccionRecompensas({ datos }: { datos: Recompensas | null }) {
  if (!datos)
    return (
      <p className="text-sm text-slate-400 text-center py-10">Cargando…</p>
    );
  const puntos = datos.puntosRecompensa || 0;
  let idx = 0;
  NIVELES.forEach((n, i) => {
    if (puntos >= n.min) idx = i;
  });
  const actual = NIVELES[idx];
  const siguiente = NIVELES[idx + 1] || null;
  const pct = siguiente
    ? Math.min(
        100,
        Math.round(
          ((puntos - actual.min) / (siguiente.min - actual.min)) * 100,
        ),
      )
    : 100;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
          Tus puntos
        </p>
        <p className="text-3xl font-bold">{puntos}</p>
        <p className="text-xs text-slate-500">
          Nivel <strong className="text-slate-800">{actual.label}</strong>
          {siguiente &&
            ` · faltan ${siguiente.min - puntos} para ${siguiente.label}`}
        </p>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[11px] text-slate-400">
          Ganas puntos cuando tus tareas se aprueban a tiempo.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">
          Historial
        </p>
        {datos.historial.length === 0 ? (
          <p className="text-xs text-slate-400">
            Todavía no tienes movimientos.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {datos.historial.map((h) => (
              <li
                key={h.id}
                className="py-1.5 flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-slate-700">{h.motivo}</span>
                <span
                  className={`font-semibold shrink-0 ${h.puntos >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                >
                  {h.puntos >= 0 ? "+" : ""}
                  {h.puntos}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Horas

// Practicantes y servicio social: las horas cuentan mientras esta página está
// abierta con la jornada iniciada (como antes con la extensión). Si se cierra la
// pestaña con el reloj corriendo, solo se abona hasta el último latido.
const CLAVE_RELOJ = "trabajador_reloj";
interface Reloj {
  sincronizado: number; // ms: hasta aquí ya está abonado en el servidor
  latido: number; // ms: última vez que la página estuvo abierta
}
const leerReloj = (): Reloj | null => {
  try {
    const r = localStorage.getItem(CLAVE_RELOJ);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
};
const guardarReloj = (r: Reloj | null) => {
  try {
    if (r) localStorage.setItem(CLAVE_RELOJ, JSON.stringify(r));
    else localStorage.removeItem(CLAVE_RELOJ);
  } catch {
    /* sin almacenamiento: el reloj no sobrevive a recargar */
  }
};

function SeccionHoras({
  empleadoId,
  onSalir,
}: {
  empleadoId: string;
  onSalir: () => void;
}) {
  const [horas, setHoras] = useState<number | null>(null);
  const [objetivo, setObjetivo] = useState(480);
  const [corriendo, setCorriendo] = useState(false);
  const [sesionSeg, setSesionSeg] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reloj = useRef<Reloj | null>(null);
  const inicioSesion = useRef(0);
  const sincronizando = useRef(false);

  const abonar = useCallback(
    async (hasta: number) => {
      const r = reloj.current;
      if (!r || sincronizando.current) return;
      const horasDelta = (hasta - r.sincronizado) / 3_600_000;
      if (horasDelta <= 0.0005) return; // menos de ~2 s
      sincronizando.current = true;
      try {
        const res = await apiMovil<{ horas_acumuladas: number }>(
          "/api/empleados/horas",
          {
            method: "PATCH",
            body: JSON.stringify({
              employeeId: empleadoId,
              deltaHoras: Number(horasDelta.toFixed(6)),
            }),
          },
        );
        if (typeof res.horas_acumuladas === "number")
          setHoras(res.horas_acumuladas);
        reloj.current = { ...r, sincronizado: hasta };
        guardarReloj(reloj.current);
      } catch (e) {
        if (e instanceof SesionExpirada) return onSalir();
        setError("No se pudieron guardar las horas; se reintentará.");
      } finally {
        sincronizando.current = false;
      }
    },
    [empleadoId, onSalir],
  );

  // Carga el acumulado y cierra un reloj que se quedó abierto con la pestaña cerrada.
  useEffect(() => {
    (async () => {
      try {
        const r = await apiMovil<{
          employee: {
            horas_acumuladas: number;
            horas_totales_objetivo: number | null;
          };
        }>(`/api/empleados/horas?employeeId=${empleadoId}`);
        setHoras(Number(r.employee.horas_acumuladas) || 0);
        setObjetivo(r.employee.horas_totales_objetivo || 480);
      } catch (e) {
        if (e instanceof SesionExpirada) return onSalir();
        setError((e as Error).message);
      }
      const previo = leerReloj();
      if (previo) {
        reloj.current = previo;
        if (Date.now() - previo.latido > 5 * 60_000) {
          await abonar(previo.latido);
          reloj.current = null;
          guardarReloj(null);
        } else {
          inicioSesion.current = previo.sincronizado;
          setCorriendo(true);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empleadoId]);

  useEffect(() => {
    if (!corriendo) return;
    let ultimoAbono = Date.now();
    const id = setInterval(() => {
      const ahora = Date.now();
      setSesionSeg(Math.floor((ahora - inicioSesion.current) / 1000));
      if (reloj.current) {
        reloj.current = { ...reloj.current, latido: ahora };
        guardarReloj(reloj.current);
      }
      if (ahora - ultimoAbono >= 5 * 60_000) {
        ultimoAbono = ahora;
        abonar(ahora);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [corriendo, abonar]);

  const iniciar = () => {
    const ahora = Date.now();
    reloj.current = { sincronizado: ahora, latido: ahora };
    guardarReloj(reloj.current);
    inicioSesion.current = ahora;
    setSesionSeg(0);
    setError(null);
    setCorriendo(true);
  };

  const detener = async () => {
    setCorriendo(false);
    await abonar(Date.now());
    reloj.current = null;
    guardarReloj(null);
    setSesionSeg(0);
  };

  const pct =
    horas === null ? 0 : Math.min(100, Math.round((horas / objetivo) * 100));
  const hms = (s: number) =>
    [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-md space-y-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
        Horas acumuladas
      </p>
      <p className="text-3xl font-bold">
        {horas === null ? "—" : horas.toFixed(1)}
        <span className="text-base font-medium text-slate-400">
          {" "}
          / {objetivo} h
        </span>
      </p>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="pt-3 border-t border-slate-100 space-y-2">
        <p className="font-mono text-2xl text-slate-800">
          {hms(corriendo ? sesionSeg : 0)}
        </p>
        {corriendo ? (
          <button
            type="button"
            onClick={detener}
            className="w-full bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg py-2 cursor-pointer"
          >
            Terminar jornada
          </button>
        ) : (
          <button
            type="button"
            onClick={iniciar}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg py-2 cursor-pointer"
          >
            Iniciar jornada
          </button>
        )}
        <p className="text-[11px] text-slate-400">
          Las horas cuentan mientras esta página esté abierta con la jornada
          iniciada. Máximo 5 horas por día.
        </p>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}
