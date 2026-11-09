"use client";

import React, { useState, useEffect, useMemo } from "react";
import Sidebar from "../components/Sidebar";
import TaskCard from "../components/Taskcard";
import { Icon } from "../components/icons";
import { formatFechaLimite } from "../lib/dates";
import { supabase } from "../lib/supabaseClient";
import { getCurrentAdminId } from "../lib/currentAdmin";
import { PALETA_EMPLEADOS, colorLibreEmpleado } from "../lib/coloresEmpleados";
import { ModalOverlay } from "../components/ModalOverlay";
import { abrirArchivo } from "../lib/storageUrls";
import { esArquitecto, estaEnObra, hoyMx } from "../lib/enObra";
import { montoMensual } from "../lib/pagos";
import { useNivelAdmin } from "../lib/useNivelAdmin";
import { asegurarSemanasRaya } from "../lib/rayaAuto";
import { EVENTO_NOTIF_RESUELTA } from "../components/CampanaNotificaciones";
import { RestablecerContrasena } from "../components/RestablecerContrasena";
import {
  CONVENIOS_BASE,
  ROL_JCF,
  esConvenio,
  llevaHoras,
} from "../lib/convenios";

// Áreas del organigrama (bajo cada Coordinador) — usadas para agrupar a los
// Trabajadores en el panel "Equipo" del calendario de revisiones y del Panel
// Principal.
const AREAS = [
  "Administrativo y RRHH",
  "Proyectos y Obra",
  "TICs",
  "Financiero-Contable",
  "Ventas",
];
// Gerencia/Dirección no lleva área (ver el modal de alta/edición de integrante);
// a cualquier otro nivel sin área le falta un dato, no es un caso normal.
const SIN_AREA = "Sin área asignada";

// Roles de siempre. Los de convenio (Prácticas, Servicio Social y Jóvenes
// Construyendo el Futuro) tienen trato especial: ver src/lib/convenios.ts.
// Cualquier otro rol (de esta lista o escrito a mano) es personal general.
const ROLES_BASE = [
  "Administrador",
  "Trabajador",
  "Practicante",
  "Servicio Social",
  ROL_JCF,
];

// 🛠️ Funciones para dar formato a fecha y hora
const formatDate = (dateString?: string | null) => {
  if (!dateString) return "Sin fecha";
  const date = new Date(
    dateString.includes("T") ? dateString : `${dateString}T00:00:00`,
  );
  if (isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const formatDateTime = (dateString?: string | null) => {
  if (!dateString) return "Reciente";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;

  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

// 🏆 Niveles de recompensa por puntos acumulados (empleados.puntos_recompensa).
// Los puntos se otorgan automáticamente por trigger en Supabase cuando una tarea
// pasa a "Completada" (10 base + hasta 10 extra por anticipación a la fecha límite).
const NIVELES_RECOMPENSA = [
  { min: 0, label: "Bronce" },
  { min: 300, label: "Plata" },
  { min: 800, label: "Oro" },
  { min: 1500, label: "Diamante" },
];

const getNivelRecompensa = (puntos: number) => {
  let actual = NIVELES_RECOMPENSA[0];
  let siguiente: (typeof NIVELES_RECOMPENSA)[number] | null = null;
  for (let i = 0; i < NIVELES_RECOMPENSA.length; i++) {
    if (puntos >= NIVELES_RECOMPENSA[i].min) {
      actual = NIVELES_RECOMPENSA[i];
      siguiente = NIVELES_RECOMPENSA[i + 1] || null;
    }
  }
  const progresoPct = siguiente
    ? Math.min(
        100,
        Math.round(
          ((puntos - actual.min) / (siguiente.min - actual.min)) * 100,
        ),
      )
    : 100;
  return { actual, siguiente, progresoPct };
};

interface Subtarea {
  id: number | string;
  titulo: string;
  completada: boolean;
}

interface Task {
  id: number | string;
  title: string;
  project: string;
  projectId?: string;
  description?: string;
  priority?: "Baja" | "Media" | "Alta" | "Urgente";
  status: "Completada" | "En Proceso" | "Pendiente" | "Postergada";
  progressPercent?: number;
  date: string;
  dueDate?: string;
  assignedByName?: string;
  isCritical?: boolean;
  slackDays?: number;
  dependsOnTaskId?: number;
  dependsOnTaskTitle?: string;
  collaborators?: { id: string; name: string }[];
  collaboratorsNames?: string[];
  subtareas?: Subtarea[];
}

interface LegalDocument {
  id: string;
  name: string;
  required: boolean;
  status: "Verificado" | "Pendiente" | "Por Vencer";
  expirationDate?: string;
  fileUrl?: string;
}

interface ContractDetails {
  contractType:
    | "Servicio Social"
    | "Prácticas Profesionales"
    | "Tiempo Completo"
    | "Medio Tiempo"
    | "Tiempo Indeterminado";
  startDate: string;
  endDate?: string;
  stipendOrSalary?: string;
  supervisor: string;
  hasTransitioned?: boolean;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  nivel?: string;
  // Un empleado puede pertenecer a más de un área (ej. Ventas y Proyectos y
  // Obra a la vez) — por eso es un arreglo y no un solo texto.
  area?: string[] | null;
  especialidad?: string;
  currentTask: string;
  currentProject: string;
  currentTaskDependency?: string;
  status: "Ocupado" | "Disponible";
  // Arquitectos: solo cuenta el día en que se marca (vuelve solo a oficina).
  enObra?: boolean;
  avatar: string | null;
  color?: string;
  completedTasksCount: number;
  horasAcumuladas?: number;
  horasTotalesObjetivo?: number;
  // Convenio (BUAP, ITP, COBAT, JCF…). Columna `escuela` en la base.
  escuela?: string | null;
  // Líneas de negocio (proyectos) a las que está asignado (proyecto_empleados).
  lineas?: string[];
  puntosRecompensa: number;
  taskHistory: Task[];
  documents: LegalDocument[];
  contract: ContractDetails;
}

interface DbProject {
  id: string;
  nombre: string;
  descripcion?: string;
}

interface DocumentRequirement {
  idTemp: string;
  nombre: string;
  obligatorio: boolean;
  archivo?: File | null;
}

// Selector con alta al vuelo: si lo que se busca no está en la lista,
// "+ Agregar nuevo…" cambia a un campo de texto. Tanto Área como Rol son TEXT
// libre en la base (sin catálogo propio ni constraint de valores), así que lo
// recién escrito queda disponible de inmediato — no hace falta tocar código ni
// SQL cada vez que se suma uno. Usado para Área y para Rol.
// Documentos del expediente que se eligen de la lista; "Otro…" permite escribir uno.
const DOCUMENTOS_CATALOGO = [
  "Identificación Oficial (INE / Pasaporte)",
  "Carta de Confidencialidad (NDA)",
  "Contrato por tiempo definido",
  "Contrato por tiempo indeterminado",
  "Comprobante de domicilio",
];

function ComboConAlta({
  value,
  onChange,
  opciones,
  permitirVacio = false,
  textoVacio = "— Ninguno —",
  textoAgregar = "+ Agregar nuevo…",
  placeholderNuevo = "Escribe el nombre",
}: {
  value: string;
  onChange: (v: string) => void;
  opciones: string[];
  permitirVacio?: boolean;
  textoVacio?: string;
  textoAgregar?: string;
  placeholderNuevo?: string;
}) {
  const [editando, setEditando] = useState(
    value !== "" && !opciones.includes(value),
  );

  if (editando) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          autoFocus
          placeholder={placeholderNuevo}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setEditando(false);
            onChange("");
          }}
          title="Elegir de la lista en vez de escribir"
          className="shrink-0 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === "__nueva__") {
          setEditando(true);
          onChange("");
        } else {
          onChange(e.target.value);
        }
      }}
      className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
    >
      {permitirVacio && <option value="">{textoVacio}</option>}
      {opciones.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value="__nueva__">{textoAgregar}</option>
    </select>
  );
}

// Área puede ser más de una (ej. alguien en Ventas y en Proyectos y Obra a la
// vez) — chips con las ya elegidas + un selector para sumar otra, existente o
// escrita a mano.
// Líneas de negocio (proyectos) de un integrante: etiquetas + selector.
// Solo las que existen; las líneas nuevas se dan de alta en Documentación Interna.
function LineasMultiSelect({
  value,
  onChange,
  opciones,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  opciones: { id: string; nombre: string }[];
}) {
  const nombre = (id: string) =>
    opciones.find((o) => o.id === id)?.nombre || "—";
  const disponibles = opciones.filter((o) => !value.includes(o.id));
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-100 text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
            >
              {nombre(id)}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== id))}
                title="Quitar línea"
                className="hover:text-indigo-900 cursor-pointer"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {disponibles.length > 0 && (
        <select
          value=""
          onChange={(e) =>
            e.target.value && onChange([...value, e.target.value])
          }
          className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
        >
          <option value="">
            {value.length === 0 ? "— Sin línea —" : "+ Agregar otra línea…"}
          </option>
          {disponibles.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function AreasMultiSelect({
  value,
  onChange,
  opciones,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  opciones: string[];
}) {
  const [agregando, setAgregando] = useState(false);
  const [nueva, setNueva] = useState("");
  const disponibles = opciones.filter((o) => !value.includes(o));

  const agregar = (area: string) => {
    const limpio = area.trim();
    if (limpio && !value.includes(limpio)) onChange([...value, limpio]);
    setNueva("");
    setAgregando(false);
  };
  const quitar = (area: string) => onChange(value.filter((a) => a !== area));

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((a) => (
            <span
              key={a}
              className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-100 text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
            >
              {a}
              <button
                type="button"
                onClick={() => quitar(a)}
                title="Quitar área"
                className="hover:text-blue-900 cursor-pointer"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {agregando ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            autoFocus
            placeholder="Nombre del área nueva"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregar(nueva);
              }
            }}
            className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
          />
          <button
            type="button"
            onClick={() => agregar(nueva)}
            title="Agregar"
            className="shrink-0 text-blue-600 hover:text-blue-800 cursor-pointer"
          >
            <Icon name="check" size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              setAgregando(false);
              setNueva("");
            }}
            title="Cancelar"
            className="shrink-0 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      ) : (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value === "__nueva__") setAgregando(true);
            else if (e.target.value) agregar(e.target.value);
          }}
          className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
        >
          <option value="">
            {value.length === 0 ? "— Sin área —" : "+ Agregar otra área…"}
          </option>
          {disponibles.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="__nueva__">+ Agregar nueva área…</option>
        </select>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null,
  );
  // Historial de puntos de recompensa (tabla real `recompensa_historial`, llenada
  // por el trigger de Supabase al completar tareas) — se filtra por empleado en el render.
  const [recompensaHistorial, setRecompensaHistorial] = useState<
    {
      id: string;
      empleado_id: string;
      puntos: number;
      motivo: string;
      created_at: string;
    }[]
  >([]);
  // Modal de "⏱️ Tiempo Extra" / nueva fecha límite (reemplaza el window.prompt nativo).
  const [extendDeadlineTarget, setExtendDeadlineTarget] = useState<{
    id: string | number;
    title: string;
    currentDueDate?: string;
  } | null>(null);
  const [extendDeadlineValue, setExtendDeadlineValue] = useState("");
  const [dbProjects, setDbProjects] = useState<DbProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Tarjeta de la lista de Equipo desplegada (una a la vez).
  const [empDesplegado, setEmpDesplegado] = useState<string | number | null>(
    null,
  );
  const [teamFilter, setTeamFilter] = useState<"trabajadores" | "estudiantes">(
    "trabajadores",
  );
  const [teamAreaFilter, setTeamAreaFilter] = useState<string>("all");
  // Filtro por convenio ("all" = todos).
  const [teamConvenioFilter, setTeamConvenioFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<
    "actividad" | "documentos" | "contrato" | "recompensas"
  >("actividad");

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isNewEmployeeModalOpen, setIsNewEmployeeModalOpen] = useState(false);
  const [isTransformModalOpen, setIsTransformModalOpen] = useState(false);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const [nuevoDoc, setNuevoDoc] = useState({
    nombre: "",
    obligatorio: false,
    archivo: null as File | null,
  });
  const [agregandoDoc, setAgregandoDoc] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeMetricModal, setActiveMetricModal] = useState<
    "totales" | "ocupados" | "disponibles" | "completadas" | null
  >(null);

  // 📌 ESTADOS DE ASIGNACIÓN DE TAREA
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<
    "Baja" | "Media" | "Alta" | "Urgente"
  >("Media");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [dependsOnTaskId, setDependsOnTaskId] = useState<string>("none");

  // 🤝 SELECCIÓN MÚLTIPLE DE COLABORADORES
  const [selectedCollaboratorIds, setSelectedCollaboratorIds] = useState<
    string[]
  >([]);

  const [nuevoDocNombre, setNuevoDocNombre] = useState("");
  const [nuevoDocObligatorio, setNuevoDocObligatorio] = useState(true);

  // 🔑 ID del administrador con sesión iniciada (quien asigna la tarea). Ya no se
  // pregunta por selector: siempre es quien está usando el panel en ese momento.
  const [currentAdminId, setCurrentAdminId] = useState<string>("");
  // Coordinación ve el panel como Gerencia, salvo sueldos, becas y pagos.
  const esCoordinadorWeb = useNivelAdmin() === "Coordinador";

  useEffect(() => {
    getCurrentAdminId().then((id) => {
      if (id) setCurrentAdminId(id);
    });
  }, []);

  const [newEmployeeData, setNewEmployeeData] = useState<{
    nombre: string;
    correo: string;
    password: string;
    rol: string;
    nivel: string;
    area: string[];
    especialidad: string;
    disponibilidad: string;
    horasTotalesObjetivo: string;
    remuneracion: string;
    color: string;
    escuela: string;
    lineas: string[];
    documentos: DocumentRequirement[];
  }>({
    nombre: "",
    correo: "",
    password: "",
    rol: "Practicante",
    nivel: "Trabajador",
    area: [],
    especialidad: "",
    disponibilidad: "Disponible",
    horasTotalesObjetivo: "480",
    remuneracion: "3000",
    color: "#2563eb",
    escuela: "",
    lineas: [],
    documentos: [
      {
        idTemp: "1",
        nombre: "Identificación Oficial (INE / Pasaporte)",
        obligatorio: true,
        archivo: null,
      },
      {
        idTemp: "2",
        nombre: "Carta de Confidencialidad (NDA)",
        obligatorio: true,
        archivo: null,
      },
      {
        idTemp: "3",
        nombre: "Contrato por tiempo definido",
        obligatorio: true,
        archivo: null,
      },
    ],
  });

  const [transformFormData, setTransformFormData] = useState({
    nuevoRol: "Desarrollador Web",
    tipoContrato: "Tiempo Indeterminado" as ContractDetails["contractType"],
    sueldo: "15000",
    supervisor: "Coordinación General",
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  // Integrante al que se le está restableciendo la contraseña (modal aparte).
  const [restablecerPara, setRestablecerPara] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const [editFormData, setEditFormData] = useState({
    nombre: "",
    correo: "",
    rol: "Practicante",
    nivel: "Trabajador",
    area: [] as string[],
    especialidad: "",
    disponibilidad: "Disponible",
    horasTotalesObjetivo: "480",
    remuneracion: "15000",
    pagoDia: "",
    color: "#2563eb",
    escuela: "",
    lineas: [] as string[],
  });
  // Pago por día con el que se abrió el modal (para saber si cambió).
  const [pagoDiaInicial, setPagoDiaInicial] = useState("");

  // Edición de una tarea del historial.
  const [editTarea, setEditTarea] = useState<{
    id: string | number;
    titulo: string;
    descripcion: string;
    prioridad: string;
    fechaLimite: string;
    subtareas: Subtarea[];
  } | null>(null);
  const [nuevaSubtarea, setNuevaSubtarea] = useState("");
  const [guardandoTarea, setGuardandoTarea] = useState(false);

  const getDocFolder = (docName: string): string => {
    const lower = docName.toLowerCase();
    if (
      lower.includes("ine") ||
      lower.includes("identificación") ||
      lower.includes("pasaporte")
    ) {
      return "INES/";
    }
    if (
      lower.includes("nda") ||
      lower.includes("confidencialidad") ||
      lower.includes("carta")
    ) {
      return "cartas_confi/";
    }
    if (lower.includes("contrato")) {
      return "contratos/";
    }
    return "";
  };

  const handleToggleCollaborator = (empId: string) => {
    setSelectedCollaboratorIds((prev) =>
      prev.includes(empId)
        ? prev.filter((id) => id !== empId)
        : [...prev, empId],
    );
  };

  // 🔄 CARGA GENERAL DESDE SUPABASE
  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      // A) Proyectos
      const { data: proyectosData, error: projError } = await supabase
        .from("proyectos")
        .select("*");
      if (projError) console.error("Error proyectos:", projError);

      const proyectosSafe = proyectosData || [];
      setDbProjects(proyectosSafe);
      if (proyectosSafe.length > 0 && !selectedProjectId) {
        setSelectedProjectId(proyectosSafe[0].id);
      }

      // A.1) Asignación a líneas de negocio (proyecto_empleados)
      const { data: asignacionesData } = await supabase
        .from("proyecto_empleados")
        .select("proyecto_id, empleado_id");
      const lineasPorEmpleado: Record<string, string[]> = {};
      (asignacionesData || []).forEach((a: any) => {
        (lineasPorEmpleado[a.empleado_id] ||= []).push(a.proyecto_id);
      });

      // Subtareas (checklist) de las tareas. Sin la tabla todavía, sin subtareas.
      const { data: subtareasData } = await supabase
        .from("tarea_subtareas")
        .select("id, tarea_id, titulo, completada, orden")
        .order("orden")
        .order("id");
      const subtareasPorTarea: Record<string, Subtarea[]> = {};
      (subtareasData || []).forEach((s: any) => {
        (subtareasPorTarea[String(s.tarea_id)] ||= []).push({
          id: s.id,
          titulo: s.titulo,
          completada: !!s.completada,
        });
      });

      // B) Empleados
      const { data: empleadosData, error: empError } = await supabase.from(
        "empleados",
      ).select(`
          *,
          tareas:tareas!tareas_empleado_id_fkey (*),
          contratos (*),
          documentos_legales (*)
        `);

      if (empError) throw new Error(empError.message);

      if (empleadosData) {
        const mappedEmployees: Employee[] = empleadosData.map((emp: any) => {
          const rawTasks = emp.tareas || [];
          const activeTask = rawTasks.find(
            (t: any) => t.estado === "En Proceso" || t.estado === "Pendiente",
          );
          const activeProj = proyectosSafe.find(
            (p: any) => p.id === activeTask?.proyecto_id,
          );
          const contract = emp.contratos?.[0] || {};

          const mappedHistory: Task[] = rawTasks.map((t: any) => {
            const parentTask = rawTasks.find(
              (p: any) => p.id === t.depende_de_tarea_id,
            );
            const proj = proyectosSafe.find((p: any) => p.id === t.proyecto_id);

            const collabIds: string[] = Array.isArray(t.colaboradores_ids)
              ? t.colaboradores_ids
              : [];
            const collabList = collabIds
              .map((id) => {
                const found = empleadosData.find((e: any) => e.id === id);
                return found ? { id: found.id, name: found.nombre } : null;
              })
              .filter(Boolean) as { id: string; name: string }[];

            const collabNames = collabList.map((c) => c.name);

            // Normalizar estado
            let normalizedStatus:
              "Completada" | "En Proceso" | "Pendiente" | "Postergada" =
              "Pendiente";
            const rawStatus = (t.estado || "").toLowerCase();
            if (rawStatus.includes("completa")) normalizedStatus = "Completada";
            else if (rawStatus.includes("proceso"))
              normalizedStatus = "En Proceso";
            else if (
              rawStatus.includes("posterga") ||
              rawStatus.includes("reagenda")
            )
              normalizedStatus = "Postergada";

            return {
              id: t.id,
              title: t.titulo || "Sin título",
              project: proj?.nombre || "General",
              projectId: t.proyecto_id,
              description: t.descripcion || "",
              priority: (t.prioridad as any) || "Media",
              status: normalizedStatus,
              progressPercent:
                t.porcentaje_avance ??
                (normalizedStatus === "Completada" ? 100 : 0),
              date:
                normalizedStatus === "Completada" && t.fecha_completado
                  ? formatDate(t.fecha_completado)
                  : formatDate(t.fecha_asignada),
              dueDate: formatFechaLimite(t.fecha_limite),
              assignedByName:
                empleadosData.find((e: any) => e.id === t.asignada_por)
                  ?.nombre || "Administrador",
              isCritical: Boolean(t.es_critica),
              slackDays: t.holgura_dias ?? 0,
              subtareas: subtareasPorTarea[String(t.id)] || [],
              dependsOnTaskId: t.depende_de_tarea_id,
              dependsOnTaskTitle: parentTask?.titulo,
              collaborators: collabList,
              collaboratorsNames: collabNames,
            };
          });

          const activeParentTask = rawTasks.find(
            (p: any) => p.id === activeTask?.depende_de_tarea_id,
          );

          return {
            id: emp.id,
            name: emp.nombre || "Integrante sin nombre",
            email: emp.username || "correo@empresa.com",
            role: emp.rol || "Practicante",
            nivel: emp.nivel || "Trabajador",
            area: emp.area || null,
            // "General" era el valor por defecto cuando no se capturaba nada; no
            // distingue a nadie, así que no se muestra en la tarjeta.
            especialidad:
              emp.especialidad && emp.especialidad !== "General"
                ? emp.especialidad
                : "",
            currentTask: activeTask
              ? activeTask.titulo
              : "Sin tareas asignadas aún",
            currentProject: activeProj?.nombre || "Sin Proyecto",
            currentTaskDependency: activeParentTask?.titulo,
            status: emp.disponibilidad ? "Disponible" : "Ocupado",
            enObra: estaEnObra(emp.en_obra_fecha),
            avatar: emp.avatar_url || null,
            color: emp.color || "#2563eb",
            completedTasksCount: mappedHistory.filter(
              (t) => t.status === "Completada",
            ).length,
            horasAcumuladas: emp.horas_acumuladas || 0,
            horasTotalesObjetivo: emp.horas_totales_objetivo,
            escuela: emp.escuela || null,
            lineas: lineasPorEmpleado[emp.id] || [],
            puntosRecompensa: emp.puntos_recompensa || 0,
            taskHistory: mappedHistory,
            documents: (emp.documentos_legales || []).map((d: any) => ({
              id: d.id,
              name: d.nombre_documento || "Documento",
              required: d.es_obligatorio ?? true,
              status: d.estado || "Pendiente",
              expirationDate: formatDate(d.fecha_vencimiento),
              fileUrl: d.archivo_path,
            })),
            contract: {
              contractType:
                contract.tipo_contrato || emp.rol || "Tiempo Indeterminado",
              startDate: formatDate(contract.fecha_inicio || "2026-01-01"),
              endDate: formatDate(contract.fecha_fin),
              stipendOrSalary: contract.remuneracion_o_beca || "No asignado",
              supervisor: contract.supervisor || "Coordinación General",
              hasTransitioned: contract.ha_transicionado,
            },
          };
        });

        setEmployees(mappedEmployees);

        if (mappedEmployees.length > 0) {
          setSelectedEmployee((prev) => {
            if (!prev) return mappedEmployees[0];
            return (
              mappedEmployees.find((e) => e.id === prev.id) ||
              mappedEmployees[0]
            );
          });
        } else {
          setSelectedEmployee(null);
        }
      }

      // B.1) Historial de puntos de recompensa — tabla real llenada por el trigger
      // de Supabase (fn_otorgar_puntos_tarea_completada), no por este dashboard.
      const { data: recompensaData, error: recompensaErr } = await supabase
        .from("recompensa_historial")
        .select("id, empleado_id, puntos, motivo, created_at")
        .order("created_at", { ascending: false });
      if (!recompensaErr && recompensaData)
        setRecompensaHistorial(recompensaData as any);
    } catch (error: any) {
      console.error("Error al sincronizar datos con Supabase:", error);
      setErrorMessage(error?.message || "Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // La campana de la barra lateral avisa cuando se aprueba o rechaza una solicitud.
  useEffect(() => {
    const recargar = () => fetchDashboardData();
    window.addEventListener(EVENTO_NOTIF_RESUELTA, recargar);
    return () => window.removeEventListener(EVENTO_NOTIF_RESUELTA, recargar);
  }, []);

  // ⏱️ EXTENDER FECHA LÍMITE. Esta plataforma web es exclusiva para Administradores
  // (ver login/page.tsx) — no hay un flujo de "empleado solicita, admin aprueba" aquí,
  // el admin tiene autoridad directa sobre la tarea que está viendo, así que el botón
  // actualiza la fecha límite de una vez en vez de generar una solicitud pendiente.
  // Solo abre el modal — la actualización real la hace handleConfirmExtendDeadline.
  const handleExtendDeadline = (
    taskId: string | number,
    taskTitle: string,
    currentDueDate?: string,
  ) => {
    setExtendDeadlineValue("");
    setExtendDeadlineTarget({
      id: taskId,
      title: taskTitle,
      currentDueDate,
    });
  };

  const handleConfirmExtendDeadline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendDeadlineTarget || !extendDeadlineValue) return;

    try {
      const { error } = await supabase
        .from("tareas")
        .update({ fecha_limite: extendDeadlineValue })
        .eq("id", extendDeadlineTarget.id);

      if (error) throw error;

      setExtendDeadlineTarget(null);
      await fetchDashboardData();
    } catch (err: any) {
      console.error("Error extendiendo fecha límite:", err);
      alert(
        "No se pudo actualizar la fecha límite: " +
          (err.message || "Error de conexión"),
      );
    }
  };

  // Áreas que existen de verdad (las sugeridas + cualquiera que alguien haya
  // escrito a mano desde el modal de alta/edición) — el filtro y la
  // agrupación del Equipo salen de aquí, nunca de la lista fija, para que un
  // área nueva aparezca sola sin tocar código.
  const areasConocidas = useMemo(() => {
    const vistas = new Set<string>(AREAS);
    employees.forEach((e) => {
      (e.area || []).forEach((a) => vistas.add(a));
    });
    return Array.from(vistas).sort((a, b) => a.localeCompare(b, "es"));
  }, [employees]);

  // Mismo patrón para Rol: los de siempre + cualquiera que ya se haya escrito
  // a mano. "Practicante"/"Servicio Social" siguen siendo los únicos con
  // trato especial en el código (sin raya, por horas); un rol nuevo se
  // comporta como cualquier otro general.
  const rolesConocidos = useMemo(() => {
    const vistos = new Set<string>(ROLES_BASE);
    employees.forEach((e) => {
      if (e.role) vistos.add(e.role);
    });
    return Array.from(vistos).sort((a, b) => a.localeCompare(b, "es"));
  }, [employees]);

  // Convenios: los de siempre + cualquiera ya capturado.
  const conveniosConocidos = useMemo(() => {
    const vistas = new Set<string>(CONVENIOS_BASE);
    employees.forEach((e) => {
      if (e.escuela) vistas.add(e.escuela);
    });
    return Array.from(vistas).sort((a, b) => a.localeCompare(b, "es"));
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const convenio = esConvenio(emp.role);
      if (teamFilter === "trabajadores" && convenio) return false;
      if (teamFilter === "estudiantes" && !convenio) return false;
      if (teamConvenioFilter !== "all" && emp.escuela !== teamConvenioFilter) {
        return false;
      }
      if (teamAreaFilter !== "all") {
        const areasDelEmpleado =
          emp.area && emp.area.length > 0 ? emp.area : [SIN_AREA];
        if (!areasDelEmpleado.includes(teamAreaFilter)) return false;
      }
      return true;
    });
  }, [employees, teamFilter, teamAreaFilter, teamConvenioFilter]);

  // Agrupa el Equipo por área organizacional (Dirección/Gerencia sin área va al
  // final). Cada persona aparece UNA sola vez: en su primera área (o en la del
  // filtro, si se filtró por una); sus otras áreas se ven como etiquetas.
  const equipoPorArea = useMemo(() => {
    const porArea = new Map<string, Employee[]>();
    filteredEmployees.forEach((emp) => {
      const areasDelEmpleado =
        emp.area && emp.area.length > 0 ? emp.area : [SIN_AREA];
      const area =
        teamAreaFilter !== "all" && areasDelEmpleado.includes(teamAreaFilter)
          ? teamAreaFilter
          : areasDelEmpleado[0];
      if (!porArea.has(area)) porArea.set(area, []);
      porArea.get(area)!.push(emp);
    });
    return [...areasConocidas, SIN_AREA]
      .filter((area) => porArea.has(area))
      .map((area) => ({ area, integrantes: porArea.get(area)! }));
  }, [filteredEmployees, areasConocidas, teamAreaFilter]);

  const totalEmployees = employees.length;
  const activeNow = employees.filter((e) => e.status === "Ocupado").length;
  const available = employees.filter((e) => e.status === "Disponible").length;

  const completedTasksCount = employees.reduce((acc, emp) => {
    const historicalCompleted = emp.taskHistory.filter(
      (t) => t.status === "Completada",
    ).length;
    return acc + emp.completedTasksCount + historicalCompleted;
  }, 0);

  const totalTasksCount = employees.reduce((acc, emp) => {
    const activeTaskCount =
      emp.currentTask &&
      emp.currentTask !== "Sin tareas asignadas aún" &&
      !emp.currentTask.startsWith("Ninguna")
        ? 1
        : 0;
    return (
      acc + emp.taskHistory.length + activeTaskCount + emp.completedTasksCount
    );
  }, 0);

  const renderAvatar = (avatarSrc: string | null | undefined, name: string) => {
    if (
      avatarSrc &&
      (avatarSrc.startsWith("http") ||
        avatarSrc.startsWith("data:") ||
        avatarSrc.startsWith("/"))
    ) {
      return (
        <img
          src={avatarSrc}
          alt={name}
          className="w-full h-full object-cover"
        />
      );
    }

    const initials = name
      ? name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      : "";

    return (
      <div className="w-full h-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs">
        {initials}
      </div>
    );
  };

  const handleAddDocumentRequirement = () => {
    if (!nuevoDocNombre.trim()) return;
    setNewEmployeeData((prev) => ({
      ...prev,
      documentos: [
        ...prev.documentos,
        {
          idTemp: Date.now().toString(),
          nombre: nuevoDocNombre.trim(),
          obligatorio: nuevoDocObligatorio,
          archivo: null,
        },
      ],
    }));
    setNuevoDocNombre("");
    setNuevoDocObligatorio(true);
  };

  const handleRemoveDocumentRequirement = (idTemp: string) => {
    setNewEmployeeData((prev) => ({
      ...prev,
      documentos: prev.documentos.filter((d) => d.idTemp !== idTemp),
    }));
  };

  const handleDocFileSelect = (idTemp: string, file: File | null) => {
    setNewEmployeeData((prev) => ({
      ...prev,
      documentos: prev.documentos.map((doc) =>
        doc.idTemp === idTemp ? { ...doc, archivo: file } : doc,
      ),
    }));
  };

  const handleUploadSingleDoc = async (
    docId: string,
    file: File,
    docName: string,
  ) => {
    if (!selectedEmployee) return;
    setUploadingDocId(docId);

    try {
      const fileExt = file.name.split(".").pop();
      const folder = getDocFolder(docName);
      const fileName = `${folder}doc_${selectedEmployee.id}_${Date.now()}.${fileExt}`;

      const { error: uploadErr } = await supabase.storage
        .from("documentacion")
        .upload(fileName, file);

      if (uploadErr) throw uploadErr;

      // Bucket privado: se guarda la ruta, no una URL pública.
      const { error: dbErr } = await supabase
        .from("documentos_legales")
        .update({
          archivo_path: fileName,
          estado: "Verificado",
        })
        .eq("id", docId);

      if (dbErr) throw dbErr;

      // Si reemplaza a un archivo anterior, se borra para no dejarlo huérfano.
      const anterior = selectedEmployee.documents?.find(
        (d) => d.id === docId,
      )?.fileUrl;
      if (anterior && anterior !== fileName) {
        await supabase.storage.from("documentacion").remove([anterior]);
      }

      await fetchDashboardData();
    } catch (err: any) {
      console.error("Error al subir el documento:", err);
      alert(err.message || "Error al subir el documento");
    } finally {
      setUploadingDocId(null);
    }
  };

  const handleEliminarDocumento = async (doc: LegalDocument) => {
    if (!window.confirm(`¿Eliminar "${doc.name}" del expediente?`)) return;
    try {
      const { error: dbErr } = await supabase
        .from("documentos_legales")
        .delete()
        .eq("id", doc.id);
      if (dbErr) throw dbErr;
      if (doc.fileUrl) {
        await supabase.storage.from("documentacion").remove([doc.fileUrl]);
      }
      await fetchDashboardData();
    } catch (err: any) {
      console.error("Error al eliminar el documento:", err);
      alert(err.message || "Error al eliminar el documento");
    }
  };

  // Agrega un documento legal nuevo al expediente de alguien ya registrado.
  const handleAgregarDocumento = async (e: React.FormEvent) => {
    e.preventDefault();
    const nombre = nuevoDoc.nombre.trim();
    if (!selectedEmployee || !nombre) return;
    setAgregandoDoc(true);

    try {
      let archivoPath: string | null = null;
      if (nuevoDoc.archivo) {
        const fileExt = nuevoDoc.archivo.name.split(".").pop();
        const fileName = `${getDocFolder(nombre)}doc_${selectedEmployee.id}_${Date.now()}.${fileExt}`;
        const { error: uploadErr } = await supabase.storage
          .from("documentacion")
          .upload(fileName, nuevoDoc.archivo);
        if (uploadErr) throw uploadErr;
        archivoPath = fileName;
      }

      const { error: dbErr } = await supabase
        .from("documentos_legales")
        .insert({
          empleado_id: selectedEmployee.id,
          nombre_documento: nombre,
          es_obligatorio: nuevoDoc.obligatorio,
          archivo_path: archivoPath,
          estado: archivoPath ? "Verificado" : "Pendiente",
        });
      if (dbErr) throw dbErr;

      setNuevoDoc({ nombre: "", obligatorio: false, archivo: null });
      await fetchDashboardData();
    } catch (err: any) {
      console.error("Error al agregar el documento:", err);
      alert(err.message || "Error al agregar el documento");
    } finally {
      setAgregandoDoc(false);
    }
  };

  // 📌 ASIGNACIÓN DE TAREA
  // Arquitectos que van y vienen de la obra: el estado dura el día (al siguiente
  // vuelve solo a "oficina") y lo cambian administradores y coordinadores.
  const toggleEnObra = async (emp: Employee) => {
    const aplicar = (enObra: boolean) => {
      setEmployees((prev) =>
        prev.map((e) => (e.id === emp.id ? { ...e, enObra } : e)),
      );
      setSelectedEmployee((prev) =>
        prev && prev.id === emp.id ? { ...prev, enObra } : prev,
      );
    };
    const nuevo = !emp.enObra;
    aplicar(nuevo);
    const { error } = await supabase
      .from("empleados")
      .update({ en_obra_fecha: nuevo ? hoyMx() : null })
      .eq("id", emp.id);
    if (error) {
      aplicar(!!emp.enObra);
      alert("No se pudo cambiar el estado de obra: " + error.message);
    }
  };

  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !selectedEmployee) return;

    try {
      const parentTaskIdInt =
        dependsOnTaskId !== "none" ? parseInt(dependsOnTaskId, 10) : null;
      const targetProjectId =
        selectedProjectId || (dbProjects.length > 0 ? dbProjects[0].id : null);

      if (!targetProjectId) {
        alert("Debes seleccionar o tener registrado al menos un proyecto.");
        return;
      }

      const assignedByAdminId = currentAdminId || selectedEmployee.id;

      const taskPayload: any = {
        empleado_id: selectedEmployee.id,
        proyecto_id: targetProjectId,
        titulo: newTaskTitle.trim(),
        descripcion: newTaskDescription.trim() || null,
        estado: dependsOnTaskId !== "none" ? "Pendiente" : "En Proceso",
        prioridad: newTaskPriority,
        asignada_por: assignedByAdminId,
        fecha_asignada: new Date().toISOString().split("T")[0],
        fecha_limite: newTaskDueDate || null,
        depende_de_tarea_id: parentTaskIdInt,
        colaboradores_ids:
          selectedCollaboratorIds.length > 0 ? selectedCollaboratorIds : null,
      };

      const { data: nuevaTarea, error } = await supabase
        .from("tareas")
        .insert(taskPayload)
        .select("id")
        .single();

      if (error) throw error;

      await supabase
        .from("empleados")
        .update({ disponibilidad: false })
        .eq("id", selectedEmployee.id);

      // 📅 Si la tarea tiene fecha límite, se manda automáticamente al calendario
      // como un evento de "Fecha Límite" (distinto de una reunión agendada por revisión).
      if (newTaskDueDate && nuevaTarea?.id) {
        // Ojo: construir el Date así (sin offset) hace que JS lo interprete en hora LOCAL
        // del navegador; luego toISOString() lo convierte a UTC correctamente antes de
        // guardarlo. Mandar el string "YYYY-MM-DDT09:00:00" directo a Supabase lo guarda
        // como si 09:00 fuera UTC, y en zonas horarias negativas el evento cae de madrugada,
        // fuera del rango visible (09:00–18:00) del calendario.
        // Duración de 1 hora completa (igual que una reunión normal) para que el
        // ícono circular del evento no quede más alto que su propia casilla en el
        // calendario y se recorte contra el borde de la cuadrícula.
        const dtInicioLimite = new Date(`${newTaskDueDate}T09:00:00`);
        const dtFinLimite = new Date(`${newTaskDueDate}T10:00:00`);

        const { data: nuevaReunion, error: calErr } = await supabase
          .from("reuniones")
          .insert({
            // Título limpio (solo el nombre de la tarea): el ícono ⏳ y la etiqueta "Fecha
            // Límite" ya se muestran aparte en la UI (badge, encabezado del popover, etc.)
            // según `estado`, así que no hace falta — ni conviene — hornearlos en el texto.
            titulo: newTaskTitle.trim(),
            // Sin descripción: el título, el ícono ⏳ y la etiqueta "Fecha Límite" ya
            // dejan claro de qué se trata — repetirlo en una descripción es redundante.
            descripcion: null,
            fecha_inicio: dtInicioLimite.toISOString(),
            fecha_fin: dtFinLimite.toISOString(),
            fecha: newTaskDueDate,
            hora: "09:00 AM",
            estado: "Fecha Límite",
            empleado_id: selectedEmployee.id,
            proyecto_id: targetProjectId,
            tarea_id: nuevaTarea.id,
            creado_por: currentAdminId || null,
          })
          .select("id")
          .single();

        if (calErr) {
          console.error(
            "No se pudo crear el evento de fecha límite en el calendario:",
            calErr,
          );
          alert(
            `La tarea se asignó, pero no se pudo agregar al calendario: ${calErr.message}`,
          );
        } else if (nuevaReunion?.id) {
          // 📅 Con fecha límite sí hay algo que mostrar en el calendario: mandamos ahí
          // directo, con el evento recién creado ya seleccionado/marcado.
          window.location.href = `/admin/revisiones?highlightEventId=${nuevaReunion.id}`;
          return;
        }
      }

      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskPriority("Media");
      setNewTaskDueDate("");
      setDependsOnTaskId("none");
      setSelectedCollaboratorIds([]);
      setIsAssignModalOpen(false);

      await fetchDashboardData();
    } catch (error: any) {
      console.error("Error insertando tarea en Supabase:", error);
      alert(error.message || "Error al asignar la tarea");
    }
  };

  // 📌 REGISTRO DE NUEVO INTEGRANTE
  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingUpload(true);

    try {
      const cleanEmail = newEmployeeData.correo.trim().toLowerCase();
      const cleanPassword = newEmployeeData.password?.trim() || "";

      if (!cleanEmail || !cleanPassword) {
        throw new Error("Correo y contraseña son obligatorios.");
      }

      // Área obligatoria salvo para Gerencia (Dirección no lleva área) — si no,
      // la persona queda "Sin área asignada" desde el día uno, como le pasó a
      // Dayana antes de este cambio.
      if (
        newEmployeeData.nivel !== "Gerencia" &&
        newEmployeeData.area.length === 0
      ) {
        throw new Error(
          "Selecciona al menos un área del nuevo integrante (solo Gerencia no lleva área).",
        );
      }

      // "Otro..." ya no existe como opción: el propio ComboConAlta deja
      // escribir el rol directamente en newEmployeeData.rol.
      const finalRol = newEmployeeData.rol.trim() || "General";

      const res = await fetch("/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          password: cleanPassword,
          nombre: newEmployeeData.nombre.trim(),
          rol: finalRol,
          nivel: newEmployeeData.nivel,
          area: newEmployeeData.area.length > 0 ? newEmployeeData.area : null,
          especialidad: newEmployeeData.especialidad.trim(),
          disponibilidad: newEmployeeData.disponibilidad,
          horasTotalesObjetivo: llevaHoras(finalRol)
            ? newEmployeeData.horasTotalesObjetivo
            : null,
          escuela: esConvenio(finalRol)
            ? newEmployeeData.escuela.trim() || null
            : null,
          color: newEmployeeData.color || "#2563eb",
          avatarUrl: null,
        }),
      });

      const responseData = await res.json();
      if (!res.ok) throw new Error(responseData.error);

      const newEmp = responseData.employee;

      if (newEmp) {
        const esEstudiante = esConvenio(finalRol);
        const formattedSalary = newEmployeeData.remuneracion
          ? `$${newEmployeeData.remuneracion} MXN / mes`
          : "Sin Apoyo";

        await supabase.from("contratos").insert({
          empleado_id: newEmp.id,
          tipo_contrato: esEstudiante ? finalRol : "Tiempo Indeterminado",
          fecha_inicio: new Date().toISOString().split("T")[0],
          remuneracion_o_beca: formattedSalary,
          supervisor: "Coordinador de Equipo",
        });

        if (newEmployeeData.documentos.length > 0) {
          const docsToInsert = [];
          for (const doc of newEmployeeData.documentos) {
            let filePublicUrl = null;
            let estadoDoc = "Pendiente";

            if (doc.archivo) {
              const fileExt = doc.archivo.name.split(".").pop();
              const folder = getDocFolder(doc.nombre);
              const fileName = `${folder}doc_${newEmp.id}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

              const { error: docUploadErr } = await supabase.storage
                .from("documentacion")
                .upload(fileName, doc.archivo);

              if (!docUploadErr) {
                // Bucket privado: se guarda la ruta, no una URL pública.
                filePublicUrl = fileName;
                estadoDoc = "Verificado";
              }
            }

            docsToInsert.push({
              empleado_id: newEmp.id,
              nombre_documento: doc.nombre,
              es_obligatorio: doc.obligatorio,
              archivo_path: filePublicUrl,
              estado: estadoDoc,
            });
          }

          await supabase.from("documentos_legales").insert(docsToInsert);
        }

        // Líneas de negocio a las que entra (Documentación Interna las usa).
        if (newEmployeeData.lineas.length > 0) {
          await supabase.from("proyecto_empleados").insert(
            newEmployeeData.lineas.map((proyecto_id) => ({
              proyecto_id,
              empleado_id: newEmp.id,
            })),
          );
        }
      }

      setNewEmployeeData({
        nombre: "",
        correo: "",
        password: "",
        rol: "Practicante",
        nivel: "Trabajador",
        area: [],
        especialidad: "",
        disponibilidad: "Disponible",
        horasTotalesObjetivo: "480",
        remuneracion: "3000",
        color: "#2563eb",
        escuela: "",
        lineas: [],
        documentos: [
          {
            idTemp: "1",
            nombre: "Identificación Oficial (INE / Pasaporte)",
            obligatorio: true,
            archivo: null,
          },
          {
            idTemp: "2",
            nombre: "Carta de Confidencialidad (NDA)",
            obligatorio: true,
            archivo: null,
          },
          {
            idTemp: "3",
            nombre: "Contrato por tiempo definido",
            obligatorio: true,
            archivo: null,
          },
        ],
      });
      setIsNewEmployeeModalOpen(false);

      await fetchDashboardData();
    } catch (error: any) {
      console.error("Error al registrar empleado:", error);
      alert(error.message || "Error al registrar");
    } finally {
      setLoadingUpload(false);
    }
  };

  const handleOpenTransformModal = () => {
    if (!selectedEmployee) return;

    const currentSalaryDigits = selectedEmployee.contract?.stipendOrSalary
      ? selectedEmployee.contract.stipendOrSalary.replace(/[^0-9]/g, "")
      : "15000";

    setTransformFormData({
      nuevoRol: esConvenio(selectedEmployee.role)
        ? "Desarrollador Web"
        : selectedEmployee.role,
      tipoContrato: "Tiempo Indeterminado",
      sueldo: currentSalaryDigits || "15000",
      supervisor:
        selectedEmployee.contract?.supervisor || "Coordinación General",
    });
    setIsTransformModalOpen(true);
  };

  const handleTransformEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    try {
      const formattedSalary = transformFormData.sueldo
        ? `$${transformFormData.sueldo} MXN / mes`
        : "Sin Apoyo";

      await supabase
        .from("empleados")
        .update({
          rol: transformFormData.nuevoRol,
          horas_totales_objetivo: null,
        })
        .eq("id", selectedEmployee.id);

      await supabase.from("contratos").upsert(
        {
          empleado_id: selectedEmployee.id,
          tipo_contrato: transformFormData.tipoContrato,
          remuneracion_o_beca: formattedSalary,
          supervisor: transformFormData.supervisor,
          ha_transicionado: true,
          fecha_inicio: new Date().toISOString().split("T")[0],
        },
        { onConflict: "empleado_id" },
      );

      setIsTransformModalOpen(false);
      await fetchDashboardData();
    } catch (error) {
      console.error("Error actualizando contrato en Supabase:", error);
    }
  };

  const handleEditClick = () => {
    if (!selectedEmployee) return;

    const beca = montoMensual(selectedEmployee.contract?.stipendOrSalary);
    const currentSalaryDigits = beca > 0 ? String(beca) : "";

    setPagoDiaInicial("");
    setEditFormData({
      nombre: selectedEmployee.name,
      correo: selectedEmployee.email,
      rol: selectedEmployee.role,
      nivel: selectedEmployee.nivel || "Trabajador",
      area: selectedEmployee.area || [],
      especialidad: selectedEmployee.especialidad || "",
      disponibilidad: selectedEmployee.status,
      horasTotalesObjetivo: String(
        selectedEmployee.horasTotalesObjetivo || 480,
      ),
      remuneracion: currentSalaryDigits,
      pagoDia: "",
      color: selectedEmployee.color || "#2563eb",
      escuela: selectedEmployee.escuela || "",
      lineas: selectedEmployee.lineas || [],
    });
    setIsEditModalOpen(true);

    // Pago por día de la raya semanal: el de su semana más reciente con pago.
    const empId = selectedEmployee.id;
    supabase
      .from("raya_detalle")
      .select("pago_dia, raya_semanas(semana_inicio)")
      .eq("empleado_id", empId)
      .gt("pago_dia", 0)
      .then(({ data }: { data: any[] | null }) => {
        let mejor = { inicio: "", pago: 0 };
        (data || []).forEach((d: any) => {
          const r = Array.isArray(d.raya_semanas)
            ? d.raya_semanas[0]
            : d.raya_semanas;
          const inicio = String(r?.semana_inicio || "").slice(0, 10);
          if (inicio >= mejor.inicio)
            mejor = { inicio, pago: Number(d.pago_dia) };
        });
        const valor = mejor.pago > 0 ? String(mejor.pago) : "";
        setPagoDiaInicial(valor);
        setEditFormData((prev) => ({ ...prev, pagoDia: valor }));
      });
  };

  const abrirEditarTarea = async (taskId: string | number) => {
    const { data, error } = await supabase
      .from("tareas")
      .select("id, titulo, descripcion, prioridad, fecha_limite")
      .eq("id", taskId)
      .single();
    if (error || !data) {
      alert("No se pudo cargar la tarea: " + (error?.message || ""));
      return;
    }
    const { data: subsData } = await supabase
      .from("tarea_subtareas")
      .select("id, titulo, completada")
      .eq("tarea_id", taskId)
      .order("orden")
      .order("id");
    setEditTarea({
      id: data.id,
      titulo: data.titulo || "",
      descripcion: data.descripcion || "",
      prioridad: data.prioridad || "Media",
      fechaLimite: data.fecha_limite
        ? String(data.fecha_limite).slice(0, 10)
        : "",
      subtareas: (subsData || []).map((s: any) => ({
        id: s.id,
        titulo: s.titulo,
        completada: !!s.completada,
      })),
    });
    setNuevaSubtarea("");
  };

  // El avance de una tarea con subtareas sale de cuántas van hechas.
  const sincronizarAvance = async (
    tareaId: string | number,
    subs: Subtarea[],
  ) => {
    if (subs.length === 0) return;
    const avance = Math.round(
      (subs.filter((s) => s.completada).length / subs.length) * 100,
    );
    await supabase
      .from("tareas")
      .update({ porcentaje_avance: avance })
      .eq("id", tareaId);
  };

  // Tarea a marcar como completada (pide confirmación en un modal).
  const [completarTarea, setCompletarTarea] = useState<{
    id: string | number;
    title: string;
  } | null>(null);
  const [completando, setCompletando] = useState(false);

  // Completar a mano (sin pasar por revisión): la tarea sale de las actividades
  // en curso y queda en el Historial general (/admin/historial).
  const handleCompletarTarea = async () => {
    if (!completarTarea || !selectedEmployee) return;
    setCompletando(true);
    try {
      const ahora = new Date().toISOString();
      const { error } = await supabase
        .from("tareas")
        .update({
          estado: "Completada",
          porcentaje_avance: 100,
          fecha_completado: ahora,
        })
        .eq("id", completarTarea.id);
      if (error) throw error;

      // El evento "Fecha Límite" del calendario y la solicitud de revisión
      // pendiente (si la había) se cierran con la tarea.
      await supabase
        .from("reuniones")
        .update({ estado: "Completada" })
        .eq("tarea_id", completarTarea.id)
        .neq("estado", "Completada");
      await supabase
        .from("notificaciones")
        .update({ estado: "Aprobado" })
        .eq("tarea_id", completarTarea.id)
        .eq("estado", "Pendiente");

      // Queda disponible solo si ya no le quedan tareas en curso.
      const { data: pendientes } = await supabase
        .from("tareas")
        .select("id")
        .eq("empleado_id", selectedEmployee.id)
        .in("estado", ["En Proceso", "En Revisión", "Postergada"])
        .neq("id", completarTarea.id);
      if (!pendientes || pendientes.length === 0) {
        await supabase
          .from("empleados")
          .update({ disponibilidad: true })
          .eq("id", selectedEmployee.id);
      }

      setCompletarTarea(null);
      await fetchDashboardData();
    } catch (err: any) {
      alert("No se pudo completar la tarea: " + (err.message || "Error"));
    } finally {
      setCompletando(false);
    }
  };

  const cerrarEditTarea = () => {
    setEditTarea(null);
    fetchDashboardData();
  };

  const agregarSubtarea = async () => {
    const titulo = nuevaSubtarea.trim();
    if (!editTarea || !titulo) return;
    const { data, error } = await supabase
      .from("tarea_subtareas")
      .insert({
        tarea_id: editTarea.id,
        titulo,
        orden: editTarea.subtareas.length,
      })
      .select("id, titulo, completada")
      .single();
    if (error || !data) {
      alert("No se pudo agregar la subtarea: " + (error?.message || ""));
      return;
    }
    const subtareas = [
      ...editTarea.subtareas,
      { id: data.id, titulo: data.titulo, completada: !!data.completada },
    ];
    setEditTarea({ ...editTarea, subtareas });
    setNuevaSubtarea("");
    await sincronizarAvance(editTarea.id, subtareas);
  };

  const alternarSubtarea = async (
    id: string | number,
    completada: boolean,
    enModal: boolean,
  ) => {
    const { error } = await supabase
      .from("tarea_subtareas")
      .update({ completada })
      .eq("id", id);
    if (error) {
      alert("No se pudo actualizar la subtarea: " + error.message);
      return;
    }
    if (enModal && editTarea) {
      const subtareas = editTarea.subtareas.map((s) =>
        s.id === id ? { ...s, completada } : s,
      );
      setEditTarea({ ...editTarea, subtareas });
      await sincronizarAvance(editTarea.id, subtareas);
      return;
    }
    // Desde la tarjeta: se busca la tarea dueña de la subtarea.
    const tarea = selectedEmployee?.taskHistory.find((t) =>
      t.subtareas?.some((s) => s.id === id),
    );
    if (tarea?.subtareas) {
      await sincronizarAvance(
        tarea.id,
        tarea.subtareas.map((s) => (s.id === id ? { ...s, completada } : s)),
      );
    }
    await fetchDashboardData();
  };

  const quitarSubtarea = async (id: string | number) => {
    if (!editTarea) return;
    const { error } = await supabase
      .from("tarea_subtareas")
      .delete()
      .eq("id", id);
    if (error) {
      alert("No se pudo quitar la subtarea: " + error.message);
      return;
    }
    const subtareas = editTarea.subtareas.filter((s) => s.id !== id);
    setEditTarea({ ...editTarea, subtareas });
    await sincronizarAvance(editTarea.id, subtareas);
  };

  const handleGuardarTarea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarea || !editTarea.titulo.trim()) return;
    setGuardandoTarea(true);
    try {
      const { error } = await supabase
        .from("tareas")
        .update({
          titulo: editTarea.titulo.trim(),
          descripcion: editTarea.descripcion.trim() || null,
          prioridad: editTarea.prioridad,
          fecha_limite: editTarea.fechaLimite || null,
        })
        .eq("id", editTarea.id);
      if (error) throw error;

      // El evento "Fecha Límite" del calendario sigue a la tarea.
      if (editTarea.fechaLimite) {
        await supabase
          .from("reuniones")
          .update({
            titulo: editTarea.titulo.trim(),
            fecha: editTarea.fechaLimite,
            fecha_inicio: new Date(
              `${editTarea.fechaLimite}T09:00:00`,
            ).toISOString(),
            fecha_fin: new Date(
              `${editTarea.fechaLimite}T10:00:00`,
            ).toISOString(),
          })
          .eq("tarea_id", editTarea.id)
          .eq("estado", "Fecha Límite");
      }

      setEditTarea(null);
      await fetchDashboardData();
    } catch (err: any) {
      alert("No se pudo guardar la tarea: " + (err.message || "Error"));
    } finally {
      setGuardandoTarea(false);
    }
  };

  const handleUpdateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    try {
      const esEstudiante = llevaHoras(editFormData.rol);
      const formattedSalary = editFormData.remuneracion
        ? `$${editFormData.remuneracion} MXN / mes`
        : "Sin Apoyo";

      await supabase
        .from("empleados")
        .update({
          nombre: editFormData.nombre,
          username: editFormData.correo,
          rol: editFormData.rol,
          nivel: editFormData.nivel,
          area: editFormData.area.length > 0 ? editFormData.area : null,
          especialidad: editFormData.especialidad.trim() || null,
          disponibilidad: editFormData.disponibilidad === "Disponible",
          color: editFormData.color,
          horas_totales_objetivo: esEstudiante
            ? parseInt(editFormData.horasTotalesObjetivo) || 480
            : null,
          escuela: esConvenio(editFormData.rol)
            ? editFormData.escuela.trim() || null
            : null,
        })
        .eq("id", selectedEmployee.id);

      // Sincronizar líneas de negocio: quitar las que ya no y agregar las nuevas.
      const lineasAntes = selectedEmployee.lineas || [];
      const quitar = lineasAntes.filter(
        (l) => !editFormData.lineas.includes(l),
      );
      const agregar = editFormData.lineas.filter(
        (l) => !lineasAntes.includes(l),
      );
      if (quitar.length > 0) {
        await supabase
          .from("proyecto_empleados")
          .delete()
          .eq("empleado_id", selectedEmployee.id)
          .in("proyecto_id", quitar);
      }
      if (agregar.length > 0) {
        await supabase.from("proyecto_empleados").insert(
          agregar.map((proyecto_id) => ({
            proyecto_id,
            empleado_id: selectedEmployee.id,
          })),
        );
      }

      // La beca mensual solo se toca en personal de convenio; a los demás se
      // les paga por día en la raya semanal.
      await supabase.from("contratos").upsert(
        {
          empleado_id: selectedEmployee.id,
          tipo_contrato: editFormData.rol,
          ...(esConvenio(editFormData.rol) && !esCoordinadorWeb
            ? { remuneracion_o_beca: formattedSalary }
            : {}),
        },
        { onConflict: "empleado_id" },
      );

      // Pago por día: se actualiza en las listas de raya sin pagar de la
      // semana anterior en adelante (lo ya pagado no se toca).
      if (
        !esConvenio(editFormData.rol) &&
        editFormData.nivel !== "Gerencia" &&
        !esCoordinadorWeb &&
        editFormData.pagoDia !== pagoDiaInicial
      ) {
        const nuevoPago = Number(editFormData.pagoDia) || 0;
        await asegurarSemanasRaya(true);
        const corte = new Date();
        corte.setDate(corte.getDate() - 13);
        const corteYmd = `${corte.getFullYear()}-${String(corte.getMonth() + 1).padStart(2, "0")}-${String(corte.getDate()).padStart(2, "0")}`;
        const { data: semanas } = await supabase
          .from("raya_semanas")
          .select("id")
          .gte("semana_inicio", corteYmd);
        const ids = (semanas || []).map((x: any) => x.id);
        if (ids.length > 0) {
          const { error: errPago } = await supabase
            .from("raya_detalle")
            .update({ pago_dia: nuevoPago })
            .eq("empleado_id", selectedEmployee.id)
            .in("semana_id", ids)
            .or("pagado.is.null,pagado.eq.false");
          if (errPago)
            alert("No se pudo actualizar el pago por día: " + errPago.message);
        }
      }

      setIsEditModalOpen(false);
      await fetchDashboardData();
    } catch (error) {
      console.error("Error al actualizar empleado:", error);
    }
  };

  const handleDeleteClick = () => {
    if (!selectedEmployee) return;
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedEmployee) return;
    setIsDeleting(true);

    try {
      // El borrado pasa por una ruta con service role: limpia todas las tablas
      // hijas (raya, reuniones, revisiones, notificaciones, recompensas…),
      // borra al empleado y su cuenta de Supabase Auth.
      const res = await fetch("/api/empleados/eliminar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoId: selectedEmployee.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo eliminar.");
      if (data.aviso) alert(data.aviso);

      setIsDeleteModalOpen(false);
      setSelectedEmployee(null);
      await fetchDashboardData();
    } catch (error: any) {
      console.error("Error al eliminar empleado:", error);
      alert(error.message || "Error al eliminar el integrante.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center font-sans p-4">
        <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-xl shadow-sm px-3.5 py-2.5 animate-[fade-slide-in_0.25s_ease-out]">
          <span className="relative flex w-4 h-4 shrink-0">
            <span className="absolute inset-0 rounded-full border-2 border-slate-200" />
            <span className="absolute inset-0 rounded-full border-2 border-blue-600 border-t-transparent border-r-transparent animate-spin" />
          </span>
          <span className="text-[12px] font-medium text-slate-600">
            Sincronizando con Supabase…
          </span>
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center font-sans p-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 max-w-md w-full shadow-sm text-center space-y-2">
          <span className="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
            <Icon name="alert-triangle" size={18} />
          </span>
          <h3 className="text-[13px] font-semibold text-slate-900">
            Error al consultar Supabase
          </h3>
          <p className="text-[11px] text-red-600 bg-red-50 p-2 rounded-lg border border-red-100 font-mono break-words">
            {errorMessage}
          </p>
          <button
            onClick={fetchDashboardData}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-medium py-1.5 rounded-lg cursor-pointer transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const isEstudianteSelected = selectedEmployee
    ? llevaHoras(selectedEmployee.role)
    : false;
  const porcentajeHoras =
    isEstudianteSelected && selectedEmployee?.horasTotalesObjetivo
      ? Math.min(
          Math.round(
            ((selectedEmployee.horasAcumuladas || 0) /
              selectedEmployee.horasTotalesObjetivo) *
              100,
          ),
          100,
        )
      : 0;

  const hasPendingDocsSelected = selectedEmployee?.documents?.some(
    (d) => d.status === "Pendiente" || d.status === "Por Vencer",
  );

  return (
    <div className="h-screen w-screen bg-slate-50 flex font-sans overflow-hidden select-none">
      <Sidebar />

      <main className="flex-1 flex flex-col p-3 overflow-hidden h-full min-w-0">
        {/* ENCABEZADO */}
        <header className="flex justify-between items-center mb-3 shrink-0">
          <div>
            <h1 className="text-[15px] font-semibold text-slate-900 tracking-tight">
              Panel de Control
            </h1>
            <p className="text-[11px] text-slate-500">
              Gestión de equipo, expedientes contractuales y seguimiento de
              actividades
            </p>
          </div>
        </header>

        {/* MÉTRICAS INTERACTIVAS */}
        <div className="grid grid-cols-4 gap-2 mb-3 shrink-0">
          {(
            [
              {
                key: "totales",
                label: "Total integrantes",
                value: `${totalEmployees}`,
                sub: "miembros",
                icon: "users",
                tint: "text-slate-800",
                bg: "bg-slate-100 text-slate-500",
                hover: "hover:border-slate-300",
              },
              {
                key: "ocupados",
                label: "En actividad",
                value: `${activeNow}`,
                sub: "ocupados",
                icon: "zap",
                tint: "text-amber-600",
                bg: "bg-amber-50 text-amber-600",
                hover: "hover:border-amber-300",
              },
              {
                key: "disponibles",
                label: "Disponibles",
                value: `${available}`,
                sub: "libres",
                icon: "hourglass",
                tint: "text-emerald-600",
                bg: "bg-emerald-50 text-emerald-600",
                hover: "hover:border-emerald-300",
              },
              {
                key: "completadas",
                label: "Tareas completadas",
                value: `${completedTasksCount}`,
                sub: `/ ${totalTasksCount} totales`,
                icon: "check-circle",
                tint: "text-emerald-600",
                bg: "bg-emerald-50 text-emerald-600",
                hover: "hover:border-emerald-300",
              },
            ] as const
          ).map((m) => (
            <div
              key={m.key}
              onClick={() => setActiveMetricModal(m.key as any)}
              className={`bg-white p-2.5 rounded-lg border border-slate-200 flex justify-between items-center cursor-pointer transition-colors ${m.hover}`}
            >
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">
                  {m.label}
                </p>
                <h3
                  className={`text-lg font-semibold mt-0.5 tabular-nums ${m.tint}`}
                >
                  {m.value}{" "}
                  <span className="text-[11px] text-slate-400 font-normal">
                    {m.sub}
                  </span>
                </h3>
              </div>
              <span
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.bg}`}
              >
                <Icon name={m.icon} size={16} />
              </span>
            </div>
          ))}
        </div>

        {/* VISTA MAESTRO-DETALLE */}
        <div className="flex-1 grid grid-cols-12 gap-3 min-h-0 overflow-hidden">
          {/* PANEL IZQUIERDO: LISTA DE INTEGRANTES */}
          <div className="col-span-4 flex flex-col min-h-0">
            <div className="mb-1.5 space-y-1.5 shrink-0">
              <div className="flex justify-between items-center">
                <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                  Equipo ({filteredEmployees.length})
                </h3>
                <button
                  onClick={() => {
                    // Pre-asigna un color de la paleta que ningún otro trabajador
                    // use, para que no colisione en el Calendario de Revisiones.
                    setNewEmployeeData((prev) => ({
                      ...prev,
                      color: colorLibreEmpleado(
                        employees.map((e) => e.color),
                        employees.length,
                      ),
                    }));
                    setIsNewEmployeeModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white font-medium px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer"
                >
                  <Icon name="user-plus" size={13} /> Registrar
                </button>
              </div>

              {/* FILTROS DE EQUIPO */}
              <div className="flex bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium text-slate-500">
                {(
                  [
                    { k: "trabajadores", label: "Trabajadores" },
                    { k: "estudiantes", label: "Convenios" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.k}
                    onClick={() => {
                      setTeamFilter(t.k);
                      setTeamConvenioFilter("all");
                    }}
                    className={`flex-1 py-1 text-center rounded-md transition-colors cursor-pointer ${
                      teamFilter === t.k
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "hover:text-slate-800"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div
                className={`grid gap-1 ${teamFilter === "estudiantes" ? "grid-cols-2" : "grid-cols-1"}`}
              >
                <div className="relative">
                  <Icon
                    name="users"
                    size={13}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                  <select
                    value={teamAreaFilter}
                    onChange={(e) => setTeamAreaFilter(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-700 text-[11px] font-medium py-1.5 pl-6 pr-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
                  >
                    <option value="all">Todas las áreas</option>
                    {areasConocidas.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                    <option value={SIN_AREA}>{SIN_AREA}</option>
                  </select>
                </div>

                {teamFilter === "estudiantes" && (
                  <div className="relative">
                    <Icon
                      name="building"
                      size={13}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                    />
                    <select
                      value={teamConvenioFilter}
                      onChange={(e) => setTeamConvenioFilter(e.target.value)}
                      aria-label="Filtrar por convenio"
                      className="w-full bg-white border border-slate-200 text-slate-700 text-[11px] font-medium py-1.5 pl-6 pr-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
                    >
                      <option value="all">Todos los convenios</option>
                      {conveniosConocidos.map((e) => (
                        <option key={e} value={e}>
                          {e} ({employees.filter((x) => x.escuela === e).length}
                          )
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* TARJETAS DE INTEGRANTES */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-1 min-h-0">
              {filteredEmployees.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  No hay integrantes en esta categoría.
                </p>
              ) : (
                equipoPorArea.map((grupo) => (
                  <div key={grupo.area} className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide px-1 pt-1.5 first:pt-0">
                      {grupo.area} ({grupo.integrantes.length})
                    </p>
                    {grupo.integrantes.map((emp) => {
                      const isSelected =
                        selectedEmployee && emp.id === selectedEmployee.id;
                      const esEstudiante = llevaHoras(emp.role);
                      // Otras áreas además de la del grupo (aparece una sola vez).
                      const otrasAreas = (emp.area || []).filter(
                        (a) => a !== grupo.area,
                      );
                      const hasPendingDocs = emp.documents?.some(
                        (d) =>
                          d.status === "Pendiente" || d.status === "Por Vencer",
                      );

                      return (
                        <div
                          key={emp.id}
                          onClick={() => {
                            setSelectedEmployee(emp);
                            setEmpDesplegado((prev) =>
                              prev === emp.id ? null : emp.id,
                            );
                          }}
                          className={`p-2 rounded-lg border transition-colors cursor-pointer relative ${
                            isSelected
                              ? "bg-blue-50/50 border-blue-500 shadow-sm ring-1 ring-blue-500/20"
                              : "bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-xs"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-base shrink-0 shadow-inner overflow-hidden border border-slate-200 relative">
                                {renderAvatar(emp.avatar, emp.name)}
                              </div>
                              <div>
                                <div className="flex items-center gap-1">
                                  <h4 className="font-bold text-slate-900 text-sm leading-tight">
                                    {emp.name}
                                  </h4>

                                  <span
                                    className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-2xs"
                                    style={{
                                      backgroundColor: emp.color || "#2563eb",
                                    }}
                                    title={`Color asignado: ${emp.color || "#2563eb"}`}
                                  />

                                  {hasPendingDocs && (
                                    <span
                                      className="inline-flex items-center text-amber-600"
                                      title="Expediente incompleto"
                                    >
                                      <Icon name="alert-triangle" size={12} />
                                    </span>
                                  )}
                                </div>
                                {emp.enObra && (
                                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1 rounded mt-0.5">
                                    <Icon name="building" size={9} /> En obra
                                    hoy
                                  </span>
                                )}
                              </div>
                            </div>

                            <span
                              className={`inline-flex items-center gap-1 px-1 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                emp.status === "Disponible"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border border-amber-200"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${emp.status === "Disponible" ? "bg-emerald-500" : "bg-amber-500"}`}
                              ></span>
                              {emp.status}
                            </span>
                          </div>

                          {empDesplegado === emp.id && (
                            <div className="mt-1 pt-1 border-t border-slate-100/80 space-y-1 text-[11px] text-slate-500">
                              <p className="text-xs text-slate-600">
                                {emp.role}
                                {emp.escuela ? ` · ${emp.escuela}` : ""}
                                {emp.especialidad
                                  ? ` • ${emp.especialidad}`
                                  : ""}
                              </p>
                              {otrasAreas.length > 0 && (
                                <div className="flex flex-wrap gap-0.5">
                                  {otrasAreas.map((a) => (
                                    <span
                                      key={a}
                                      title="También pertenece a esta área"
                                      className="text-[9px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-1 rounded"
                                    >
                                      + {a}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                {esEstudiante ? (
                                  <span className="inline-flex items-center gap-1 text-blue-700 font-medium bg-blue-50 px-1.5 py-0.5 rounded-md">
                                    <Icon name="clock" size={11} />{" "}
                                    {emp.horasAcumuladas || 0} /{" "}
                                    {emp.horasTotalesObjetivo || 480} hrs
                                  </span>
                                ) : (
                                  <span>
                                    Historial:{" "}
                                    <strong className="text-slate-800">
                                      {emp.taskHistory.length} tareas
                                    </strong>
                                  </span>
                                )}
                                <span className="truncate max-w-[150px] inline-flex items-center gap-1">
                                  <Icon
                                    name="folder"
                                    size={11}
                                    className="shrink-0"
                                  />
                                  <strong className="text-slate-700 font-medium truncate">
                                    {emp.currentProject}
                                  </strong>
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* PANEL DERECHO: DETALLE DEL EMPLEADO SELECCIONADO */}
          {selectedEmployee && (
            <div className="col-span-8 bg-white border border-slate-200 rounded-xl p-3 flex flex-col min-h-0 overflow-hidden">
              <div className="flex justify-between items-start pb-2 border-b border-slate-100 shrink-0 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl shadow-inner overflow-hidden border border-slate-200 shrink-0">
                    {renderAvatar(
                      selectedEmployee.avatar,
                      selectedEmployee.name,
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <h3 className="text-base font-bold text-slate-900 truncate leading-tight">
                        {selectedEmployee.name}
                      </h3>
                      <span
                        className="w-3 h-3 rounded-full shrink-0 shadow-2xs border border-white"
                        style={{
                          backgroundColor: selectedEmployee.color || "#2563eb",
                        }}
                        title={`Color de perfil: ${selectedEmployee.color || "#2563eb"}`}
                      />
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <p className="text-xs text-slate-500 font-medium">
                        {selectedEmployee.role}
                        {selectedEmployee.especialidad &&
                          ` • ${selectedEmployee.especialidad}`}
                      </p>
                      {esArquitecto(selectedEmployee.especialidad) && (
                        <button
                          type="button"
                          onClick={() => toggleEnObra(selectedEmployee)}
                          title="Cambia hasta el final del día; mañana vuelve a Oficina"
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border cursor-pointer transition-colors ${
                            selectedEmployee.enObra
                              ? "bg-amber-100 text-amber-800 border-amber-300"
                              : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <Icon name="building" size={11} />
                          {selectedEmployee.enObra
                            ? "En obra hoy"
                            : "En oficina"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={handleEditClick}
                    title="Editar datos del empleado"
                    className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Icon name="pencil" size={13} />
                    <span className="hidden sm:inline">Editar</span>
                  </button>

                  <button
                    onClick={handleDeleteClick}
                    title="Eliminar empleado"
                    className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Icon name="trash" size={13} />
                    <span className="hidden sm:inline">Eliminar</span>
                  </button>

                  <button
                    onClick={handleOpenTransformModal}
                    className={`font-medium px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-1 ${
                      isEstudianteSelected
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                    }`}
                  >
                    <Icon name="refresh" size={13} />
                    <span>
                      {isEstudianteSelected ? "Transformar" : "Contrato"}
                    </span>
                  </button>

                  <button
                    onClick={() => setIsAssignModalOpen(true)}
                    className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white font-medium px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Icon name="plus" size={13} /> Asignar tarea
                  </button>
                </div>
              </div>

              {/* PESTAÑAS */}
              <div className="flex border-b border-slate-100 my-1.5 text-xs font-medium text-slate-500 shrink-0">
                {(
                  [
                    {
                      k: "actividad",
                      label: "Actividad y horas",
                      icon: "activity",
                    },
                    {
                      k: "documentos",
                      label: "Expediente legal",
                      icon: "folder",
                      flag: hasPendingDocsSelected,
                    },
                    {
                      k: "contrato",
                      label: "Detalle de contrato",
                      icon: "file-text",
                    },
                    { k: "recompensas", label: "Recompensas", icon: "award" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.k}
                    onClick={() => setActiveTab(tab.k)}
                    className={`pb-1.5 px-2 border-b-2 transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                      activeTab === tab.k
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent hover:text-slate-800"
                    }`}
                  >
                    <Icon name={tab.icon} size={13} />
                    {tab.label}
                    {"flag" in tab && tab.flag && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    )}
                  </button>
                ))}
              </div>

              {/* CONTENIDO ACTIVIDAD */}
              {activeTab === "actividad" && (
                <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
                  {isEstudianteSelected && (
                    <div className="p-2 bg-blue-50/50 border border-blue-100 rounded-2xl shrink-0 space-y-1 mb-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-blue-900 flex items-center gap-1">
                          <Icon name="clock" size={13} />
                          Conteo de horas ({selectedEmployee.role})
                        </span>
                        <span className="font-mono font-bold text-blue-700">
                          {selectedEmployee.horasAcumuladas || 0} de{" "}
                          {selectedEmployee.horasTotalesObjetivo || 480} hrs (
                          {porcentajeHoras}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 rounded-full transition-all duration-300"
                          style={{ width: `${porcentajeHoras}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* HISTORIAL DE ACTIVIDADES RENDERIZADO CON TARJETAS DETALLADAS */}
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex justify-between items-center mb-1.5 shrink-0">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Actividades en curso
                      </h4>
                      <span className="text-[11px] text-slate-400">
                        {
                          selectedEmployee.taskHistory.filter(
                            (t) => t.status !== "Completada",
                          ).length
                        }{" "}
                        activas ·{" "}
                        <a
                          href="/admin/historial"
                          className="text-blue-600 hover:underline"
                        >
                          Ver completadas en el Historial
                        </a>
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 min-h-0">
                      {selectedEmployee.taskHistory.filter(
                        (t) => t.status !== "Completada",
                      ).length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-3">
                          Sin actividades pendientes.
                        </p>
                      ) : (
                        selectedEmployee.taskHistory
                          .filter((t) => t.status !== "Completada")
                          .map((task) => (
                            <TaskCard
                              key={task.id}
                              id={task.id}
                              title={task.title}
                              projectName={task.project}
                              description={task.description}
                              assignedByName={
                                task.assignedByName || "Administrador"
                              }
                              assignedToName={selectedEmployee.name}
                              dueDate={task.dueDate}
                              priority={task.priority || "Media"}
                              status={task.status}
                              progressPercent={task.progressPercent ?? 0}
                              collaborators={task.collaborators || []}
                              isCritical={task.isCritical}
                              slackDays={task.slackDays}
                              onRequestExtension={() =>
                                handleExtendDeadline(
                                  task.id,
                                  task.title,
                                  task.dueDate,
                                )
                              }
                              subtareas={task.subtareas}
                              onToggleSubtarea={(id, hecha) =>
                                alternarSubtarea(id, hecha, false)
                              }
                              onEdit={() => abrirEditarTarea(task.id)}
                              onComplete={() =>
                                setCompletarTarea({
                                  id: task.id,
                                  title: task.title,
                                })
                              }
                            />
                          ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* DOCUMENTOS */}
              {activeTab === "documentos" && (
                <div className="flex-1 flex flex-col min-h-0 overflow-y-auto space-y-1.5">
                  <form
                    onSubmit={handleAgregarDocumento}
                    className="p-2 bg-slate-50/80 border border-slate-200/80 rounded-xl space-y-1.5"
                  >
                    <p className="text-[10px] font-bold text-slate-400 uppercase">
                      Agregar documento
                    </p>
                    <div className="flex gap-1.5">
                      <div className="flex-1 min-w-0 text-xs">
                        <ComboConAlta
                          value={nuevoDoc.nombre}
                          onChange={(v) =>
                            setNuevoDoc({ ...nuevoDoc, nombre: v })
                          }
                          opciones={DOCUMENTOS_CATALOGO.filter(
                            (d) =>
                              !selectedEmployee.documents?.some(
                                (x) => x.name === d,
                              ),
                          )}
                          permitirVacio
                          textoVacio="Elegir documento…"
                          textoAgregar="Otro…"
                          placeholderNuevo="Nombre del documento"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={agregandoDoc || !nuevoDoc.nombre.trim()}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-2 py-1 rounded-lg text-[11px] cursor-pointer transition-colors"
                      >
                        {agregandoDoc ? "Agregando..." : "Agregar"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={(e) =>
                          setNuevoDoc({
                            ...nuevoDoc,
                            archivo: e.target.files?.[0] || null,
                          })
                        }
                        className="min-w-0 flex-1 text-[11px]"
                      />
                      <label className="flex items-center gap-1 shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={nuevoDoc.obligatorio}
                          onChange={(e) =>
                            setNuevoDoc({
                              ...nuevoDoc,
                              obligatorio: e.target.checked,
                            })
                          }
                        />
                        Obligatorio
                      </label>
                    </div>
                  </form>
                  <div className="space-y-1.5">
                    {(!selectedEmployee.documents ||
                      selectedEmployee.documents.length === 0) && (
                      <p className="text-xs text-slate-400 text-center py-4">
                        Sin documentos requeridos registrados para este
                        integrante.
                      </p>
                    )}
                    {selectedEmployee.documents?.map((doc) => (
                      <div
                        key={doc.id}
                        className="p-2 bg-white border border-slate-200/80 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-1.5">
                          <Icon
                            name={
                              doc.fileUrl || doc.status === "Verificado"
                                ? "file-text"
                                : "alert-triangle"
                            }
                            size={16}
                            className={
                              doc.fileUrl || doc.status === "Verificado"
                                ? "text-slate-400"
                                : "text-amber-500"
                            }
                          />
                          <div>
                            <p className="font-bold text-slate-800 text-xs">
                              {doc.name}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {doc.required ? "Obligatorio" : "Opcional"}{" "}
                              {doc.expirationDate
                                ? `• Vence: ${doc.expirationDate}`
                                : ""}
                            </p>
                          </div>
                        </div>

                        {doc.fileUrl ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => abrirArchivo(doc.fileUrl)}
                              className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold px-1.5 py-1 rounded-lg text-[11px] transition-colors cursor-pointer"
                            >
                              Ver
                            </button>
                            <input
                              type="file"
                              accept=".pdf,image/*"
                              id={`replace-doc-tab-${doc.id}`}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file)
                                  handleUploadSingleDoc(doc.id, file, doc.name);
                                e.target.value = "";
                              }}
                              className="hidden"
                            />
                            <label
                              htmlFor={`replace-doc-tab-${doc.id}`}
                              className={`bg-white text-slate-600 border border-slate-300 hover:bg-slate-100 font-bold px-1.5 py-1 rounded-lg text-[11px] cursor-pointer transition-colors ${
                                uploadingDocId === doc.id
                                  ? "opacity-50 pointer-events-none"
                                  : ""
                              }`}
                            >
                              {uploadingDocId === doc.id
                                ? "Subiendo..."
                                : "Reemplazar"}
                            </label>
                            <button
                              type="button"
                              onClick={() => handleEliminarDocumento(doc)}
                              title="Eliminar documento"
                              className="text-slate-400 hover:text-red-600 px-1 cursor-pointer"
                            >
                              <Icon name="x" size={13} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <input
                              type="file"
                              accept=".pdf,image/*"
                              id={`upload-doc-tab-${doc.id}`}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file)
                                  handleUploadSingleDoc(doc.id, file, doc.name);
                              }}
                              className="hidden"
                            />
                            <label
                              htmlFor={`upload-doc-tab-${doc.id}`}
                              className={`bg-blue-600 hover:bg-blue-700 text-white font-bold px-1.5 py-1 rounded-lg text-[11px] cursor-pointer inline-block transition-colors ${
                                uploadingDocId === doc.id
                                  ? "opacity-50 pointer-events-none"
                                  : ""
                              }`}
                            >
                              {uploadingDocId === doc.id
                                ? "Subiendo..."
                                : "Subir PDF"}
                            </label>
                            <button
                              type="button"
                              onClick={() => handleEliminarDocumento(doc)}
                              title="Eliminar documento"
                              className="text-slate-400 hover:text-red-600 px-1 cursor-pointer"
                            >
                              <Icon name="x" size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CONTRATO */}
              {activeTab === "contrato" && (
                <div className="flex-1 flex flex-col min-h-0 overflow-y-auto space-y-2">
                  <div className="bg-slate-50/80 p-2 rounded-2xl border border-slate-200/80 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">
                          Modalidad de Contrato
                        </p>
                        <p className="font-semibold text-slate-800 mt-0.5">
                          {selectedEmployee.contract?.contractType ||
                            selectedEmployee.role}
                        </p>
                      </div>
                      {!esCoordinadorWeb && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">
                            Sueldo / Beca Mensual
                          </p>
                          <p className="font-bold text-blue-700 mt-0.5 text-sm">
                            <Icon
                              name="banknote"
                              size={13}
                              className="inline -mt-0.5 mr-1 text-slate-400"
                            />
                            {selectedEmployee.contract?.stipendOrSalary ||
                              "No asignado"}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">
                          Fecha de Inicio
                        </p>
                        <p className="font-medium text-slate-700 mt-0.5">
                          {selectedEmployee.contract?.startDate || "Reciente"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">
                          Supervisor Asignado
                        </p>
                        <p className="font-medium text-slate-700 mt-0.5">
                          {selectedEmployee.contract?.supervisor ||
                            "Coordinación"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CONTENIDO RECOMPENSAS — puntos y nivel reales (empleados.puntos_recompensa,
                  otorgados por trigger al completar tareas); el catálogo de canje sigue
                  pendiente, marcado explícitamente para el final del proyecto. */}
              {activeTab === "recompensas" &&
                (() => {
                  const puntos = selectedEmployee.puntosRecompensa;
                  const { actual, siguiente, progresoPct } =
                    getNivelRecompensa(puntos);
                  const historialEmpleado = recompensaHistorial.filter(
                    (h) => h.empleado_id === selectedEmployee.id,
                  );

                  return (
                    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto space-y-2">
                      {/* Balance de puntos y nivel */}
                      <div className="bg-gradient-to-br from-indigo-600 to-blue-600 text-white p-2 rounded-2xl shadow-sm space-y-1.5 shrink-0">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-semibold text-indigo-100 uppercase tracking-wide">
                              Puntos de {selectedEmployee.name.split(" ")[0]}
                            </p>
                            <p className="text-2xl font-semibold mt-0.5 inline-flex items-center gap-1.5">
                              <Icon name="award" size={20} />
                              {puntos} pts
                            </p>
                          </div>
                          <span className="text-[10px] font-semibold bg-white/15 border border-white/25 px-1.5 py-1 rounded-full">
                            Nivel {actual.label}
                          </span>
                        </div>
                        <div>
                          <div className="flex justify-between text-[10px] text-indigo-100 font-semibold mb-1">
                            <span>
                              {siguiente
                                ? `Progreso a Nivel ${siguiente.label}`
                                : "Nivel máximo alcanzado"}
                            </span>
                            <span>
                              {siguiente
                                ? `${puntos} / ${siguiente.min} pts`
                                : `${puntos} pts`}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-white rounded-full"
                              style={{ width: `${progresoPct}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Historial de puntos ganados */}
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                          Historial de puntos
                        </p>
                        {historialEmpleado.length === 0 ? (
                          <p className="text-xs text-slate-400 italic px-1">
                            Todavía no ha ganado puntos — se otorgan al
                            completar tareas.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {historialEmpleado.map((h) => (
                              <div
                                key={h.id}
                                className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-1.5 py-1.5"
                              >
                                <span className="text-xs font-medium text-slate-700">
                                  {h.motivo}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className="text-[10px] font-bold text-emerald-600">
                                    +{h.puntos} pts
                                  </span>
                                  <span className="text-[9px] text-slate-400 font-mono">
                                    {formatDate(h.created_at)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Catálogo de recompensas — pendiente para el final del proyecto */}
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1">
                          Catálogo de Recompensas
                          <span className="text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1 py-0.5 rounded-full normal-case">
                            Pendiente
                          </span>
                        </p>
                        <div className="space-y-1">
                          {[
                            {
                              icon: "gift",
                              label: "Vale de Despensa",
                              desc: "Apoyo para compras de despensa en supermercados.",
                              cost: 400,
                            },
                            {
                              icon: "banknote",
                              label: "Tarjeta / Vale de Gasolina",
                              desc: "Apoyo para transporte y movilidad diaria.",
                              cost: 400,
                            },
                            {
                              icon: "graduation-cap",
                              label: "Curso o Certificación Profesional",
                              desc: "Pago de capacitación técnica o profesional.",
                              cost: 900,
                            },
                            {
                              icon: "calendar",
                              label: "Día Libre",
                              desc: "Un día de descanso adicional pagado.",
                              cost: 2500,
                            },
                            {
                              icon: "award",
                              label: "Bono Colectivo de Equipo",
                              desc: "Premio acumulativo por cumplimiento de hitos del área o proyecto.",
                              cost: null,
                            },
                          ].map((item) => (
                            <div
                              key={item.label}
                              className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-1.5 py-1.5 gap-1.5"
                            >
                              <span className="flex items-start gap-1 text-xs font-semibold text-slate-700 min-w-0">
                                <span className="shrink-0 text-slate-400">
                                  <Icon name={item.icon as any} size={16} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block">{item.label}</span>
                                  <span className="block text-[10px] font-normal text-slate-400 leading-snug mt-0.5">
                                    {item.desc}
                                  </span>
                                </span>
                              </span>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <span className="text-[10px] font-bold text-amber-600 whitespace-nowrap">
                                  {item.cost !== null
                                    ? `${item.cost} pts`
                                    : "Según equipo"}
                                </span>
                                <button
                                  type="button"
                                  disabled
                                  title="Próximamente"
                                  className="text-[10px] font-bold bg-slate-200 text-slate-400 px-1.5 py-1 rounded-lg cursor-not-allowed"
                                >
                                  Canjear
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
            </div>
          )}
        </div>
      </main>

      {/* 📝 MODAL REGISTRO DE INTEGRANTE */}
      {isNewEmployeeModalOpen && (
        <ModalOverlay onClose={() => setIsNewEmployeeModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
              <h3 className="text-sm font-bold text-slate-900">
                Registrar Nuevo Integrante
              </h3>
              <button
                onClick={() => setIsNewEmployeeModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateEmployee} className="space-y-2 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Nombre Completo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Roberto Gómez"
                  value={newEmployeeData.nombre}
                  onChange={(e) =>
                    setNewEmployeeData({
                      ...newEmployeeData,
                      nombre: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  required
                  placeholder="roberto@empresa.com"
                  value={newEmployeeData.correo}
                  onChange={(e) =>
                    setNewEmployeeData({
                      ...newEmployeeData,
                      correo: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newEmployeeData.password}
                  onChange={(e) =>
                    setNewEmployeeData({
                      ...newEmployeeData,
                      password: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Rol
                  </label>
                  <ComboConAlta
                    value={newEmployeeData.rol}
                    onChange={(v) =>
                      setNewEmployeeData({ ...newEmployeeData, rol: v })
                    }
                    opciones={rolesConocidos}
                    textoAgregar="+ Agregar nuevo rol…"
                    placeholderNuevo="Nombre del rol nuevo"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Nivel Jerárquico
                  </label>
                  <select
                    value={newEmployeeData.nivel}
                    onChange={(e) =>
                      setNewEmployeeData({
                        ...newEmployeeData,
                        nivel: e.target.value,
                        // Gerencia es Dirección: no pertenece a un área, así que
                        // se limpia el valor al cambiar de nivel.
                        area:
                          e.target.value === "Gerencia"
                            ? []
                            : newEmployeeData.area,
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                  >
                    <option value="Gerencia">Gerencia</option>
                    <option value="Coordinador">Coordinador</option>
                    <option value="Trabajador">Trabajador</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Especialidad
                </label>
                <input
                  type="text"
                  value={newEmployeeData.especialidad}
                  onChange={(e) =>
                    setNewEmployeeData({
                      ...newEmployeeData,
                      especialidad: e.target.value,
                    })
                  }
                  placeholder="Ej. Arquitecto, Ingeniero civil, Contador…"
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              {/* Convenio: Prácticas, Servicio Social y JCF. */}
              {esConvenio(newEmployeeData.rol) && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Convenio
                  </label>
                  <ComboConAlta
                    value={newEmployeeData.escuela}
                    onChange={(v) =>
                      setNewEmployeeData({ ...newEmployeeData, escuela: v })
                    }
                    opciones={conveniosConocidos}
                    textoAgregar="+ Agregar otro convenio…"
                    placeholderNuevo="Nombre del convenio"
                  />
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Líneas de negocio
                </label>
                <LineasMultiSelect
                  value={newEmployeeData.lineas}
                  onChange={(v) =>
                    setNewEmployeeData({ ...newEmployeeData, lineas: v })
                  }
                  opciones={dbProjects}
                />
              </div>

              {/* Área solo aplica a Coordinadores y Trabajadores; puede ser más de una. */}
              {newEmployeeData.nivel !== "Gerencia" && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Área
                  </label>
                  <AreasMultiSelect
                    value={newEmployeeData.area}
                    onChange={(v) =>
                      setNewEmployeeData({ ...newEmployeeData, area: v })
                    }
                    opciones={areasConocidas}
                  />
                </div>
              )}
              <p className="text-[10px] text-slate-400 -mt-1">
                {newEmployeeData.nivel === "Gerencia"
                  ? "Gerencia pertenece a Dirección: no se le asigna área."
                  : 'Nivel agrupa al integrante en el panel "Equipo" del calendario de revisiones.'}
              </p>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Color Identificador de Perfil
                </label>
                <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 border border-slate-200 rounded-xl">
                  <div className="relative shrink-0">
                    <input
                      type="color"
                      id="newColorPicker"
                      value={newEmployeeData.color || "#2563eb"}
                      onChange={(e) =>
                        setNewEmployeeData({
                          ...newEmployeeData,
                          color: e.target.value,
                        })
                      }
                      className="w-9 h-9 rounded-xl border-0 p-0 cursor-pointer opacity-0 absolute inset-0 z-10"
                    />
                    <div
                      className="w-9 h-9 rounded-xl border-2 border-slate-300 shadow-2xs flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
                      style={{
                        backgroundColor: newEmployeeData.color || "#2563eb",
                      }}
                      title="Abrir mapa de color personalizado"
                    />
                  </div>

                  <span className="text-xs font-mono font-bold text-slate-700 uppercase w-16">
                    {newEmployeeData.color || "#2563eb"}
                  </span>

                  <div className="flex items-center gap-1 flex-1 justify-end flex-wrap">
                    {PALETA_EMPLEADOS.map((c) => {
                      const enUso = employees.some(
                        (e) =>
                          (e.color || "").trim().toLowerCase() ===
                          c.toLowerCase(),
                      );
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            setNewEmployeeData({ ...newEmployeeData, color: c })
                          }
                          title={enUso ? "Ya asignado a otro integrante" : c}
                          className={`w-5 h-5 rounded-full cursor-pointer transition-transform ${
                            newEmployeeData.color === c
                              ? "scale-125 ring-2 ring-slate-900"
                              : "hover:scale-110"
                          } ${enUso ? "opacity-30" : ""}`}
                          style={{ backgroundColor: c }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Sueldo o Beca (Mensual)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    placeholder="3000"
                    value={newEmployeeData.remuneracion}
                    onChange={(e) =>
                      setNewEmployeeData({
                        ...newEmployeeData,
                        remuneracion: e.target.value,
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-1.5 pl-4 text-slate-900 font-medium bg-white outline-none"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-1.5 space-y-1">
                <div className="flex justify-between items-center">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase">
                    Requisitos Documentales ({newEmployeeData.documentos.length}
                    )
                  </label>
                </div>

                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {newEmployeeData.documentos.map((doc) => (
                    <div
                      key={doc.idTemp}
                      className="p-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800 truncate max-w-[200px]">
                          {doc.nombre}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleRemoveDocumentRequirement(doc.idTemp)
                          }
                          className="text-slate-400 hover:text-red-600 px-1 cursor-pointer"
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </div>

                      <div className="flex items-center gap-1 pt-0.5">
                        <input
                          type="file"
                          accept=".pdf,image/*"
                          id={`file-doc-${doc.idTemp}`}
                          onChange={(e) =>
                            handleDocFileSelect(
                              doc.idTemp,
                              e.target.files?.[0] || null,
                            )
                          }
                          className="hidden"
                        />
                        <label
                          htmlFor={`file-doc-${doc.idTemp}`}
                          className="bg-white hover:bg-slate-100 text-slate-700 font-semibold px-1.5 py-1 rounded-lg border border-slate-300 text-[10px] cursor-pointer shrink-0"
                        >
                          <Icon
                            name="paperclip"
                            size={12}
                            className="inline -mt-0.5 mr-1"
                          />
                          {doc.archivo ? "Cambiar archivo" : "Adjuntar PDF"}
                        </label>
                        <span className="text-[10px] text-slate-500 truncate italic">
                          {doc.archivo
                            ? doc.archivo.name
                            : "Sin archivo seleccionado"}
                        </span>
                        {doc.archivo && (
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                URL.createObjectURL(doc.archivo as File),
                                "_blank",
                              )
                            }
                            className="shrink-0 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold px-1.5 py-1 rounded-lg text-[10px] cursor-pointer"
                          >
                            Ver
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-1 pt-1">
                  <div className="flex-1 min-w-0 text-[11px]">
                    <ComboConAlta
                      value={nuevoDocNombre}
                      onChange={setNuevoDocNombre}
                      opciones={DOCUMENTOS_CATALOGO.filter(
                        (d) =>
                          !newEmployeeData.documentos.some(
                            (x) => x.nombre === d,
                          ),
                      )}
                      permitirVacio
                      textoVacio="Elegir documento…"
                      textoAgregar="Otro…"
                      placeholderNuevo="Nombre del documento"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddDocumentRequirement}
                    className="bg-slate-800 hover:bg-slate-900 text-white font-bold px-1.5 py-1 rounded-xl text-[11px]"
                  >
                    + Añadir
                  </button>
                </div>
              </div>

              <div className="flex gap-1 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewEmployeeModalOpen(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-1.5 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loadingUpload}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-xl font-bold"
                >
                  {loadingUpload ? "Subiendo datos..." : "Registrar Integrante"}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* ✏️ MODAL DE EDICIÓN */}
      {isEditModalOpen && selectedEmployee && (
        <ModalOverlay onClose={() => setIsEditModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
              <h3 className="text-sm font-bold text-slate-900">
                Editar Integrante
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleUpdateEmployee} className="space-y-2 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Nombre Completo
                </label>
                <input
                  type="text"
                  required
                  value={editFormData.nombre}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, nombre: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  required
                  value={editFormData.correo}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, correo: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Rol
                  </label>
                  <ComboConAlta
                    value={editFormData.rol}
                    onChange={(v) =>
                      setEditFormData({ ...editFormData, rol: v })
                    }
                    opciones={rolesConocidos}
                    textoAgregar="+ Agregar nuevo rol…"
                    placeholderNuevo="Nombre del rol nuevo"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Nivel Jerárquico
                  </label>
                  <select
                    value={editFormData.nivel}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        nivel: e.target.value,
                        // Gerencia es Dirección: no pertenece a un área.
                        area:
                          e.target.value === "Gerencia"
                            ? []
                            : editFormData.area,
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                  >
                    <option value="Gerencia">Gerencia</option>
                    <option value="Coordinador">Coordinador</option>
                    <option value="Trabajador">Trabajador</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Especialidad
                </label>
                <input
                  type="text"
                  value={editFormData.especialidad}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      especialidad: e.target.value,
                    })
                  }
                  placeholder="Ej. Arquitecto, Ingeniero civil, Contador…"
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              {/* Convenio: Prácticas, Servicio Social y JCF. */}
              {esConvenio(editFormData.rol) && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Convenio
                  </label>
                  <ComboConAlta
                    value={editFormData.escuela}
                    onChange={(v) =>
                      setEditFormData({ ...editFormData, escuela: v })
                    }
                    opciones={conveniosConocidos}
                    textoAgregar="+ Agregar otro convenio…"
                    placeholderNuevo="Nombre del convenio"
                  />
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Líneas de negocio
                </label>
                <LineasMultiSelect
                  value={editFormData.lineas}
                  onChange={(v) =>
                    setEditFormData({ ...editFormData, lineas: v })
                  }
                  opciones={dbProjects}
                />
              </div>

              {/* Área solo aplica a Coordinadores y Trabajadores; puede ser más de una. */}
              {editFormData.nivel !== "Gerencia" && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Área
                  </label>
                  <AreasMultiSelect
                    value={editFormData.area}
                    onChange={(v) =>
                      setEditFormData({ ...editFormData, area: v })
                    }
                    opciones={areasConocidas}
                  />
                </div>
              )}

              {/* Pago: convenio recibe beca mensual; planta, pago por día (raya semanal). */}
              {esCoordinadorWeb ? null : esConvenio(editFormData.rol) ? (
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Beca mensual (MXN)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editFormData.remuneracion}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        remuneracion: e.target.value,
                      })
                    }
                    placeholder="Sin beca"
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Se paga cada mes, el día en que empezó su contrato.
                  </p>
                </div>
              ) : (
                editFormData.nivel !== "Gerencia" && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      Pago por día (MXN)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editFormData.pagoDia}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          pagoDia: e.target.value,
                        })
                      }
                      placeholder="Sin definir"
                      className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Raya semanal, se paga los sábados: días trabajados × pago
                      por día. Aplica a las listas sin pagar.
                    </p>
                  </div>
                )
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Color Asignado
                </label>
                <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 border border-slate-200 rounded-xl">
                  <div className="relative shrink-0">
                    <input
                      type="color"
                      id="editColorPicker"
                      value={editFormData.color || "#2563eb"}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          color: e.target.value,
                        })
                      }
                      className="w-9 h-9 rounded-xl border-0 p-0 cursor-pointer opacity-0 absolute inset-0 z-10"
                    />
                    <div
                      className="w-9 h-9 rounded-xl border-2 border-slate-300 shadow-2xs flex items-center justify-center cursor-pointer"
                      style={{
                        backgroundColor: editFormData.color || "#2563eb",
                      }}
                    />
                  </div>

                  <span className="text-xs font-mono font-bold text-slate-700 uppercase w-16">
                    {editFormData.color || "#2563eb"}
                  </span>

                  <div className="flex items-center gap-1 flex-1 justify-end flex-wrap">
                    {PALETA_EMPLEADOS.map((c) => {
                      const enUso = employees.some(
                        (e) =>
                          e.id !== selectedEmployee?.id &&
                          (e.color || "").trim().toLowerCase() ===
                            c.toLowerCase(),
                      );
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            setEditFormData({ ...editFormData, color: c })
                          }
                          title={enUso ? "Ya asignado a otro integrante" : c}
                          className={`w-5 h-5 rounded-full cursor-pointer transition-transform ${
                            editFormData.color === c
                              ? "scale-125 ring-2 ring-slate-900"
                              : "hover:scale-110"
                          } ${enUso ? "opacity-30" : ""}`}
                          style={{ backgroundColor: c }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Estatus de Disponibilidad
                </label>
                <select
                  value={editFormData.disponibilidad}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      disponibilidad: e.target.value as any,
                    })
                  }
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                >
                  <option value="Disponible">Disponible</option>
                  <option value="Ocupado">Ocupado</option>
                </select>
              </div>

              {/* Solo Gerencia/Coordinación (el servidor además limita a su área). */}
              {["Gerencia", "Coordinador"].includes(
                employees.find((e) => e.id === currentAdminId)?.nivel || "",
              ) && (
                <button
                  type="button"
                  onClick={() => {
                    setRestablecerPara({
                      id: selectedEmployee.id,
                      name: selectedEmployee.name,
                    });
                    setIsEditModalOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-1 border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 py-1.5 rounded-xl font-semibold cursor-pointer"
                >
                  <Icon name="key" size={12} /> Restablecer contraseña
                </button>
              )}

              <div className="flex gap-1 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 bg-slate-100 text-slate-700 py-1.5 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-xl font-bold"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {restablecerPara && (
        <RestablecerContrasena
          empleado={restablecerPara}
          onClose={() => setRestablecerPara(null)}
        />
      )}

      {/* 🗑️ MODAL DE ELIMINACIÓN DE EMPLEADO */}
      {isDeleteModalOpen && selectedEmployee && (
        <ModalOverlay onClose={() => setIsDeleteModalOpen(false)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-red-100 p-3 space-y-2 text-center">
            <div className="w-11 h-11 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <Icon name="trash" size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-[14px] font-semibold text-slate-900">
                ¿Eliminar integrante?
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                ¿Estás seguro de que deseas eliminar a{" "}
                <strong className="text-slate-900">
                  {selectedEmployee.name}
                </strong>
                ?
              </p>
              <p className="text-[11px] text-red-600 bg-red-50 p-1.5 rounded-lg border border-red-100 inline-flex items-center gap-1">
                <Icon name="alert-triangle" size={12} className="shrink-0" />{" "}
                Removerá su historial de tareas, expedientes y accesos.
              </p>
            </div>

            <div className="flex gap-1 pt-1">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-1.5 rounded-xl font-semibold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-1.5 rounded-xl font-bold text-xs cursor-pointer transition-colors shadow-xs"
              >
                {isDeleting ? "Eliminando..." : "Sí, Eliminar"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ✅ CONFIRMAR TAREA COMPLETADA */}
      {completarTarea && (
        <ModalOverlay onClose={() => setCompletarTarea(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2">
            <h3 className="text-sm font-bold text-slate-900">
              Marcar como completada
            </h3>
            <p className="text-xs text-slate-600">
              <strong className="text-slate-900">
                “{completarTarea.title}”
              </strong>{" "}
              saldrá de las actividades en curso y se guardará en el Historial
              general.
            </p>
            <div className="flex gap-1 pt-1.5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCompletarTarea(null)}
                className="flex-1 bg-slate-100 text-slate-700 py-1.5 rounded-xl font-semibold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={completando}
                onClick={handleCompletarTarea}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-1.5 rounded-xl font-bold text-xs cursor-pointer"
              >
                {completando ? "Guardando..." : "Completar"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ✏️ MODAL DE EDICIÓN DE TAREA */}
      {editTarea && (
        <ModalOverlay onClose={cerrarEditTarea}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
              <h3 className="text-sm font-bold text-slate-900">Editar tarea</h3>
              <button
                onClick={cerrarEditTarea}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleGuardarTarea} className="space-y-2 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Título
                </label>
                <input
                  type="text"
                  required
                  value={editTarea.titulo}
                  onChange={(e) =>
                    setEditTarea({ ...editTarea, titulo: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Descripción
                </label>
                <textarea
                  rows={3}
                  value={editTarea.descripcion}
                  onChange={(e) =>
                    setEditTarea({ ...editTarea, descripcion: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Prioridad
                  </label>
                  <select
                    value={editTarea.prioridad}
                    onChange={(e) =>
                      setEditTarea({ ...editTarea, prioridad: e.target.value })
                    }
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                  >
                    <option value="Baja">Baja</option>
                    <option value="Media">Media</option>
                    <option value="Alta">Alta</option>
                    <option value="Urgente">Urgente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Fecha límite
                  </label>
                  <input
                    type="date"
                    value={editTarea.fechaLimite}
                    onChange={(e) =>
                      setEditTarea({
                        ...editTarea,
                        fechaLimite: e.target.value,
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                  />
                </div>
              </div>

              {/* Subtareas: lo que ya está hecho y lo que falta */}
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Subtareas
                  {editTarea.subtareas.length > 0 &&
                    ` · ${editTarea.subtareas.filter((s) => s.completada).length}/${editTarea.subtareas.length} hechas`}
                </label>
                {editTarea.subtareas.length > 0 && (
                  <ul className="space-y-0.5 mb-1.5 max-h-40 overflow-y-auto">
                    {editTarea.subtareas.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={s.completada}
                          onChange={(e) =>
                            alternarSubtarea(s.id, e.target.checked, true)
                          }
                          className="accent-emerald-600 cursor-pointer"
                        />
                        <span
                          className={`flex-1 min-w-0 break-words ${
                            s.completada
                              ? "text-slate-400 line-through"
                              : "text-slate-800"
                          }`}
                        >
                          {s.titulo}
                        </span>
                        <button
                          type="button"
                          onClick={() => quitarSubtarea(s.id)}
                          title="Quitar subtarea"
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={nuevaSubtarea}
                    onChange={(e) => setNuevaSubtarea(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        agregarSubtarea();
                      }
                    }}
                    placeholder="Agregar subtarea y Enter"
                    className="flex-1 min-w-0 border border-slate-300 rounded-xl p-1.5 text-slate-900 bg-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={agregarSubtarea}
                    disabled={!nuevaSubtarea.trim()}
                    className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold px-2.5 rounded-xl cursor-pointer"
                  >
                    Agregar
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Se guardan al momento. El avance de la tarea se calcula con
                  las que van hechas.
                </p>
              </div>

              <div className="flex gap-1 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={cerrarEditTarea}
                  className="flex-1 bg-slate-100 text-slate-700 py-1.5 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoTarea}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-1.5 rounded-xl font-bold"
                >
                  {guardandoTarea ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* ⏱️ MODAL DE TIEMPO EXTRA / NUEVA FECHA LÍMITE */}
      {extendDeadlineTarget && (
        <ModalOverlay onClose={() => setExtendDeadlineTarget(null)}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
              <h3 className="text-sm font-bold text-slate-900">Tiempo extra</h3>
              <button
                onClick={() => setExtendDeadlineTarget(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form
              onSubmit={handleConfirmExtendDeadline}
              className="space-y-2 text-xs"
            >
              <p className="text-slate-600">
                Nueva fecha límite para{" "}
                <strong className="text-slate-900">
                  "{extendDeadlineTarget.title}"
                </strong>
                {extendDeadlineTarget.currentDueDate && (
                  <>
                    {" "}
                    (actual:{" "}
                    {formatFechaLimite(extendDeadlineTarget.currentDueDate)})
                  </>
                )}
              </p>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Fecha Límite
                </label>
                <input
                  type="date"
                  required
                  value={extendDeadlineValue}
                  onChange={(e) => setExtendDeadlineValue(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                />
              </div>

              <div className="flex gap-1 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setExtendDeadlineTarget(null)}
                  className="flex-1 bg-slate-100 text-slate-700 py-1.5 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded-xl font-bold"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* 🔄 MODAL DE TRANSFORMACIÓN */}
      {isTransformModalOpen && selectedEmployee && (
        <ModalOverlay onClose={() => setIsTransformModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
              <h3 className="text-sm font-bold text-slate-900">
                {isEstudianteSelected
                  ? "Transformar Modalidad Contractual"
                  : "Actualizar Contrato"}
              </h3>
              <button
                onClick={() => setIsTransformModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form
              onSubmit={handleTransformEmployee}
              className="space-y-2 text-xs"
            >
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Nuevo Rol / Puesto
                  </label>
                  <input
                    type="text"
                    required
                    value={transformFormData.nuevoRol}
                    onChange={(e) =>
                      setTransformFormData({
                        ...transformFormData,
                        nuevoRol: e.target.value,
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Tipo de Contrato
                  </label>
                  <select
                    value={transformFormData.tipoContrato}
                    onChange={(e) =>
                      setTransformFormData({
                        ...transformFormData,
                        tipoContrato: e.target.value as any,
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none"
                  >
                    <option value="Tiempo Completo">Tiempo Completo</option>
                    <option value="Medio Tiempo">Medio Tiempo</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-1 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTransformModalOpen(false)}
                  className="flex-1 bg-slate-100 text-slate-700 py-1.5 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-1.5 rounded-xl font-bold"
                >
                  {isEstudianteSelected
                    ? "Confirmar Transición"
                    : "Guardar Cambios"}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* 📌 MODAL DE ASIGNACIÓN DE TAREA */}
      {isAssignModalOpen && selectedEmployee && (
        <ModalOverlay onClose={() => setIsAssignModalOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Asignar Tarea a {selectedEmployee.name}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Detalles de la actividad, colaboradores, prioridad y entrega
                </p>
              </div>
              <button
                onClick={() => setIsAssignModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleAssignTask} className="space-y-2 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Proyecto Destino
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  required
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                >
                  {dbProjects.length === 0 ? (
                    <option value="" disabled>
                      No hay proyectos registrados en Supabase
                    </option>
                  ) : (
                    dbProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Título de la Tarea
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Integración de endpoint de autenticación"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Integrantes Colaboradores ({selectedCollaboratorIds.length}{" "}
                  seleccionados)
                </label>
                <div className="max-h-36 overflow-y-auto border border-slate-300 rounded-xl p-1 bg-white space-y-1">
                  {employees.filter((emp) => emp.id !== selectedEmployee.id)
                    .length === 0 ? (
                    <p className="text-[11px] text-slate-400 p-1 text-center">
                      No hay otros integrantes disponibles.
                    </p>
                  ) : (
                    employees
                      .filter((emp) => emp.id !== selectedEmployee.id)
                      .map((emp) => {
                        const isChecked = selectedCollaboratorIds.includes(
                          emp.id,
                        );
                        return (
                          <label
                            key={emp.id}
                            className={`flex items-center justify-between p-1 rounded-lg cursor-pointer text-xs transition-colors ${
                              isChecked
                                ? "bg-blue-50 border border-blue-200 text-blue-900 font-semibold"
                                : "hover:bg-slate-50 text-slate-700"
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() =>
                                  handleToggleCollaborator(emp.id)
                                }
                                className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                              <span className="inline-flex items-center gap-1">
                                <Icon name="users" size={11} />
                                {emp.name}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-normal">
                              {emp.role}
                            </span>
                          </label>
                        );
                      })
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Descripción / Indicaciones
                </label>
                <textarea
                  rows={3}
                  placeholder="Instrucciones específicas de la tarea..."
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Prioridad
                  </label>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  >
                    <option value="Baja">Baja</option>
                    <option value="Media">Media</option>
                    <option value="Alta">Alta</option>
                    <option value="Urgente">Urgente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Fecha Límite
                  </label>
                  <input
                    type="date"
                    value={newTaskDueDate}
                    onChange={(e) => setNewTaskDueDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-1 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-1.5 rounded-xl font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-xl font-bold cursor-pointer transition-colors shadow-xs"
                >
                  Asignar Tarea
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* 📊 MODAL DE DETALLES DE MÉTRICAS */}
      {activeMetricModal && (
        <ModalOverlay onClose={() => setActiveMetricModal(null)}>
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                  <Icon
                    name={
                      activeMetricModal === "ocupados"
                        ? "zap"
                        : activeMetricModal === "disponibles"
                          ? "hourglass"
                          : activeMetricModal === "completadas"
                            ? "check-circle"
                            : "users"
                    }
                    size={16}
                  />
                </span>
                <div>
                  <h3 className="text-[13px] font-semibold text-slate-900">
                    {activeMetricModal === "totales" &&
                      "Detalle: Total de Integrantes"}
                    {activeMetricModal === "ocupados" &&
                      "Detalle: Integrantes en Actividad"}
                    {activeMetricModal === "disponibles" &&
                      "Detalle: Integrantes Disponibles"}
                    {activeMetricModal === "completadas" &&
                      "Detalle: Historial de Tareas Completadas"}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {activeMetricModal === "totales" &&
                      `Mostrando los ${totalEmployees} miembros registrados`}
                    {activeMetricModal === "ocupados" &&
                      `Mostrando los ${activeNow} miembros con tareas activas`}
                    {activeMetricModal === "disponibles" &&
                      `Mostrando los ${available} miembros listos para recibir tareas`}
                    {activeMetricModal === "completadas" &&
                      `Mostrando las ${completedTasksCount} tareas finalizadas`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveMetricModal(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0 text-xs">
              {activeMetricModal === "totales" &&
                employees.map((emp) => (
                  <div
                    key={emp.id}
                    className="p-1.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                        {renderAvatar(emp.avatar, emp.name)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <h4 className="font-bold text-slate-900">
                            {emp.name}
                          </h4>
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block"
                            style={{ backgroundColor: emp.color || "#2563eb" }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {emp.role} • {emp.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] bg-slate-200/70 text-slate-700 font-bold px-1 py-0.5 rounded-md">
                        <Icon
                          name="folder"
                          size={11}
                          className="inline mr-1 -mt-0.5"
                        />
                        {emp.currentProject}
                      </span>
                      <span
                        className={`px-1 py-0.5 rounded-full text-[10px] font-bold ${
                          emp.status === "Disponible"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {emp.status}
                      </span>
                    </div>
                  </div>
                ))}

              {activeMetricModal === "ocupados" &&
                (employees.filter((e) => e.status === "Ocupado").length ===
                0 ? (
                  <p className="text-center text-slate-400 py-3">
                    No hay integrantes en actividad actualmente.
                  </p>
                ) : (
                  employees
                    .filter((e) => e.status === "Ocupado")
                    .map((emp) => (
                      <div
                        key={emp.id}
                        className="p-1.5 bg-amber-50/50 border border-amber-200/80 rounded-xl space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                              {renderAvatar(emp.avatar, emp.name)}
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-900">
                                {emp.name}
                              </h4>
                              <p className="text-[10px] text-slate-500">
                                {emp.role}
                              </p>
                            </div>
                          </div>
                          <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1 py-0.5 rounded-md border border-blue-200">
                            <Icon
                              name="folder"
                              size={11}
                              className="inline mr-1 -mt-0.5"
                            />
                            {emp.currentProject}
                          </span>
                        </div>
                        <div className="bg-white p-1.5 rounded-lg border border-amber-200/60 text-slate-800">
                          <span className="text-[10px] font-semibold text-amber-700 uppercase block mb-0.5">
                            Actividad en curso
                          </span>
                          <p className="font-medium text-xs leading-snug">
                            {emp.currentTask}
                          </p>
                        </div>
                      </div>
                    ))
                ))}

              {activeMetricModal === "disponibles" &&
                (employees.filter((e) => e.status === "Disponible").length ===
                0 ? (
                  <p className="text-center text-slate-400 py-3">
                    No hay integrantes libres en este momento.
                  </p>
                ) : (
                  employees
                    .filter((e) => e.status === "Disponible")
                    .map((emp) => (
                      <div
                        key={emp.id}
                        className="p-1.5 bg-emerald-50/40 border border-emerald-200/80 rounded-xl flex items-center justify-between"
                      >
                        <div className="flex items-center gap-1.5">
                          <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                            {renderAvatar(emp.avatar, emp.name)}
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900">
                              {emp.name}
                            </h4>
                            <p className="text-[11px] text-slate-500">
                              {emp.role}{" "}
                              {emp.especialidad ? `• ${emp.especialidad}` : ""}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedEmployee(emp);
                            setActiveMetricModal(null);
                            setIsAssignModalOpen(true);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-1.5 py-1 rounded-lg text-xs transition-colors cursor-pointer"
                        >
                          + Asignar Tarea
                        </button>
                      </div>
                    ))
                ))}

              {activeMetricModal === "completadas" &&
                (() => {
                  const allCompletedTasks = employees.flatMap((emp) =>
                    emp.taskHistory
                      .filter((t) => t.status === "Completada")
                      .map((t) => ({
                        ...t,
                        employeeId: emp.id,
                        employeeName: emp.name,
                      })),
                  );

                  if (allCompletedTasks.length === 0) {
                    return (
                      <p className="text-center text-slate-400 py-3">
                        No hay tareas completadas en el historial.
                      </p>
                    );
                  }

                  return allCompletedTasks.map((task, idx) => (
                    <div
                      key={`${task.id}-${idx}`}
                      className="p-1.5 bg-white border border-slate-200/80 rounded-xl flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <h4 className="font-bold text-slate-900">
                          {task.title}
                        </h4>
                        <div className="flex items-center gap-1 text-[10px] text-slate-500 flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Icon name="user" size={11} />
                            {task.employeeName}
                          </span>
                          <span>•</span>
                          <span className="text-blue-600 font-semibold bg-blue-50 px-1 py-0.5 rounded">
                            <Icon
                              name="folder"
                              size={11}
                              className="inline mr-1 -mt-0.5"
                            />
                            {task.project}
                          </span>
                          {task.collaboratorsNames &&
                            task.collaboratorsNames.length > 0 && (
                              <span className="text-indigo-600 font-semibold bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100">
                                Colaboradores:{" "}
                                {task.collaboratorsNames.join(", ")}
                              </span>
                            )}
                        </div>
                      </div>
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-1 rounded-lg text-[10px] font-bold shrink-0">
                        Completada ({task.date})
                      </span>
                    </div>
                  ));
                })()}
            </div>

            <div className="pt-1 border-t border-slate-100 flex justify-end shrink-0">
              <button
                onClick={() => setActiveMetricModal(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2 py-1 rounded-xl text-xs cursor-pointer transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
