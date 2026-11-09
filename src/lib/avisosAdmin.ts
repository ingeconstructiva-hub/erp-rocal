import { supabase } from "./supabaseClient";
import { asegurarSemanasRaya } from "./rayaAuto";
import { nivelAdminActual } from "./useNivelAdmin";
import { ROLES_CONVENIO } from "./convenios";
import { ciclosBeca, montoMensual, rangoCiclo } from "./pagos";

// Avisos informativos de la campana. No hay tabla propia: se calculan al vuelo
// con lo que ya existe (tareas, reuniones, equipo, documentos, horas y raya).
// El id de cada aviso cambia cuando cambia su situación (p. ej. el número de
// tareas vencidas), así un aviso ya leído solo reaparece si hay algo nuevo.

export type TipoAviso =
  "tarea" | "reunion" | "equipo" | "documento" | "horas" | "raya";

export interface Aviso {
  id: string;
  tipo: TipoAviso;
  titulo: string;
  detalle: string;
  fecha: string; // ISO, para ordenar
  urgente?: boolean;
}

const DIA = 864e5;
const hoyMx = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

const sumaDias = (ymd: string, dias: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

const fechaCorta = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const dinero = (n: number) =>
  `$${Number(n || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;

export async function cargarAvisos(): Promise<Aviso[]> {
  // Coordinación no ve nada de nóminas: ni avisos de raya ni de becas.
  const sinNomina = (await nivelAdminActual()) === "Coordinador";
  // Cada semana se abre sola la lista de raya (la actual y la anterior).
  if (!sinNomina) await asegurarSemanasRaya();
  const ahora = Date.now();
  const hoy = hoyMx();
  const manana = sumaDias(hoy, 1);
  const hace3d = new Date(ahora - 3 * DIA).toISOString();
  const hace7d = new Date(ahora - 7 * DIA).toISOString();
  const en24h = new Date(ahora + DIA).toISOString();
  const en30d = sumaDias(hoy, 30);

  const [emps, tareas, reuniones, docs, semanas, contratos, pagosConv, fechas] =
    await Promise.all([
      supabase
        .from("empleados")
        .select(
          "id, nombre, rol, created_at, horas_acumuladas, horas_totales_objetivo",
        ),
      supabase
        .from("tareas")
        .select(
          "id, titulo, empleado_id, estado, fecha_limite, created_at, fecha_completado",
        )
        .or(
          `created_at.gte.${hace3d},fecha_completado.gte.${hace3d},and(estado.neq.Completada,fecha_limite.lte.${sumaDias(hoy, 2)})`,
        ),
      supabase
        .from("reuniones")
        .select("id, titulo, fecha_inicio, empleado_id, estado, created_at")
        .or(
          `created_at.gte.${hace3d},and(fecha_inicio.gte.${new Date(ahora).toISOString()},fecha_inicio.lte.${en24h})`,
        ),
      supabase
        .from("documentos_legales")
        .select(
          "id, empleado_id, nombre_documento, es_obligatorio, estado, archivo_path, fecha_vencimiento",
        ),
      supabase
        .from("raya_semanas")
        .select(
          "id, semana_inicio, estado, raya_detalle (id, empleado_id, dias_trabajados, pago_dia, total, pagado)",
        ),
      supabase
        .from("contratos")
        .select("empleado_id, remuneracion_o_beca, fecha_inicio"),
      supabase.from("pagos_convenio").select("empleado_id, mes"),
      supabase.from("fechas_pago").select("clave, fecha"),
    ]);

  const nombres = new Map<string, string>();
  (emps.data || []).forEach((e: any) => nombres.set(e.id, e.nombre));
  const quien = (id?: string | null) => (id && nombres.get(id)) || "Equipo";

  const avisos: Aviso[] = [];

  // --- Tareas ---------------------------------------------------------------
  const vencidasPorPersona = new Map<string, number>();
  (tareas.data || []).forEach((t: any) => {
    const fl = t.fecha_limite ? String(t.fecha_limite).slice(0, 10) : null;
    const enRevision = (t.estado || "").includes("Revisi");

    if (t.created_at && t.created_at >= hace3d) {
      avisos.push({
        id: `tarea-nueva-${t.id}`,
        tipo: "tarea",
        titulo: "Nueva tarea asignada",
        detalle: `${t.titulo} · ${quien(t.empleado_id)}`,
        fecha: t.created_at,
      });
    }
    if (t.estado === "Completada") {
      if (t.fecha_completado && t.fecha_completado >= hace3d) {
        avisos.push({
          id: `tarea-completada-${t.id}`,
          tipo: "tarea",
          titulo: "Tarea completada",
          detalle: `${t.titulo} · ${quien(t.empleado_id)}`,
          fecha: t.fecha_completado,
        });
      }
      return;
    }
    if (!fl || enRevision) return;
    if (fl < hoy) {
      vencidasPorPersona.set(
        t.empleado_id,
        (vencidasPorPersona.get(t.empleado_id) || 0) + 1,
      );
    } else if (fl <= manana) {
      avisos.push({
        id: `tarea-porvencer-${t.id}-${fl}`,
        tipo: "tarea",
        titulo: fl === hoy ? "Tarea vence hoy" : "Tarea vence mañana",
        detalle: `${t.titulo} · ${quien(t.empleado_id)}`,
        fecha: `${fl}T12:00:00Z`,
        urgente: fl === hoy,
      });
    }
  });
  vencidasPorPersona.forEach((n, empId) => {
    avisos.push({
      id: `tareas-vencidas-${empId}-${n}`,
      tipo: "tarea",
      titulo: n === 1 ? "Tarea vencida" : "Tareas vencidas",
      detalle: `${quien(empId)} tiene ${n} ${n === 1 ? "tarea vencida" : "tareas vencidas"}`,
      fecha: new Date(ahora).toISOString(),
      urgente: true,
    });
  });

  // --- Reuniones (una sola por título + hora, aunque sea para varias personas)
  const vistas = new Set<string>();
  (reuniones.data || []).forEach((r: any) => {
    const estado = (r.estado || "").toLowerCase();
    if (estado.includes("complet") || estado.includes("cancel")) return;
    const clave = `${r.titulo}|${r.fecha_inicio}`;
    if (vistas.has(clave)) return;
    vistas.add(clave);

    const inicio = r.fecha_inicio ? new Date(r.fecha_inicio).getTime() : 0;
    const proxima = inicio >= ahora && inicio <= ahora + DIA;
    const cuando = inicio
      ? new Date(inicio).toLocaleString("es-MX", {
          timeZone: "America/Mexico_City",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : "";
    if (proxima) {
      avisos.push({
        id: `reunion-proxima-${r.id}`,
        tipo: "reunion",
        titulo: "Reunión en las próximas 24 h",
        detalle: `${r.titulo} · ${cuando}`,
        fecha: r.fecha_inicio,
        urgente: true,
      });
    }
    if (r.created_at && r.created_at >= hace3d) {
      avisos.push({
        id: `reunion-nueva-${r.id}`,
        tipo: "reunion",
        titulo: "Reunión agendada",
        detalle: `${r.titulo} · ${cuando}`,
        fecha: r.created_at,
      });
    }
  });

  // --- Equipo ---------------------------------------------------------------
  (emps.data || []).forEach((e: any) => {
    if (e.created_at && e.created_at >= hace7d) {
      avisos.push({
        id: `equipo-nuevo-${e.id}`,
        tipo: "equipo",
        titulo: "Integrante nuevo",
        detalle: e.nombre,
        fecha: e.created_at,
      });
    }

    // --- Horas: meta cumplida
    const meta = Number(e.horas_totales_objetivo) || 0;
    if (meta > 0 && Number(e.horas_acumuladas) >= meta) {
      avisos.push({
        id: `horas-meta-${e.id}-${meta}`,
        tipo: "horas",
        titulo: "Meta de horas cumplida",
        detalle: `${e.nombre} llegó a ${meta} h`,
        fecha: new Date(ahora).toISOString(),
      });
    }
  });

  // --- Documentos -----------------------------------------------------------
  const pendientesPorPersona = new Map<string, number>();
  (docs.data || []).forEach((d: any) => {
    const venc = d.fecha_vencimiento
      ? String(d.fecha_vencimiento).slice(0, 10)
      : null;
    if (venc && venc <= en30d) {
      avisos.push({
        id: `doc-vence-${d.id}-${venc}`,
        tipo: "documento",
        titulo: venc < hoy ? "Documento vencido" : "Documento por vencer",
        detalle: `${d.nombre_documento} · ${quien(d.empleado_id)} · ${fechaCorta(venc)}`,
        fecha: `${venc}T12:00:00Z`,
        urgente: venc < hoy,
      });
    }
    if (d.es_obligatorio && !d.archivo_path) {
      pendientesPorPersona.set(
        d.empleado_id,
        (pendientesPorPersona.get(d.empleado_id) || 0) + 1,
      );
    }
  });
  pendientesPorPersona.forEach((n, empId) => {
    avisos.push({
      id: `docs-pendientes-${empId}-${n}`,
      tipo: "documento",
      titulo: "Documentos obligatorios pendientes",
      detalle: `${quien(empId)} debe ${n} ${n === 1 ? "documento" : "documentos"}`,
      fecha: new Date(ahora).toISOString(),
    });
  });

  // --- Pagos -----------------------------------------------------------------
  // Fechas de pago editadas a mano; sin ellas rige la regla (sábado / aniversario).
  const fechaEditada = new Map<string, string>();
  (fechas.data || []).forEach((f: any) =>
    fechaEditada.set(f.clave, String(f.fecha).slice(0, 10)),
  );
  // Raya: renglones sin pagar cuyo día de pago es hoy, ya pasó o es mañana.
  (semanas.data || []).forEach((s: any) => {
    const inicio = String(s.semana_inicio).slice(0, 10);
    const porDia = new Map<string, any[]>();
    const sinCaptura: any[] = [];
    (s.raya_detalle || []).forEach((f: any) => {
      const vence = fechaEditada.get(`raya:${f.id}`) || sumaDias(inicio, 5);
      // Ya llegó su día de pago pero no hay días capturados.
      if (!f.pagado && Number(f.pago_dia) > 0 && !(Number(f.total) > 0)) {
        if (vence <= hoy) sinCaptura.push(f);
        return;
      }
      if (!(Number(f.total) > 0) || f.pagado) return;
      if (vence > manana) return;
      porDia.set(vence, [...(porDia.get(vence) || []), f]);
    });
    if (sinCaptura.length > 0) {
      avisos.push({
        id: `raya-capturar-${s.id}-${sinCaptura.length}`,
        tipo: "raya",
        titulo: `Falta capturar la raya · semana del ${fechaCorta(inicio)}`,
        detalle: `Ya es día de pago y no hay días capturados de: ${sinCaptura
          .map((f: any) => quien(f.empleado_id))
          .join(" · ")}`,
        fecha: `${sumaDias(inicio, 5)}T12:00:00Z`,
        urgente: true,
      });
    }
    porDia.forEach((filas, vence) => {
      const total = filas.reduce(
        (a: number, f: any) => a + Number(f.total || 0),
        0,
      );
      const personas = filas
        .map((f: any) => `${quien(f.empleado_id)} ${dinero(f.total)}`)
        .join(" · ");
      const ya = vence <= hoy;
      avisos.push({
        id: `raya-pagar-${s.id}-${vence}-${filas.length}-${ya ? "ya" : "man"}`,
        tipo: "raya",
        titulo: `${ya ? "Toca pagar" : "Mañana toca pagar"} la raya · semana del ${fechaCorta(inicio)}`,
        detalle: `${filas.length} ${filas.length === 1 ? "persona" : "personas"} · ${dinero(total)} — ${personas}`,
        fecha: `${vence}T12:00:00Z`,
        urgente: ya,
      });
    });
  });

  // Becas de convenio: un ciclo por mes desde que empezó el contrato; se paga un
  // mes después de empezar cada ciclo (o el día que se haya editado).
  const contratoVigente = new Map<string, { monto: number; inicio: string }>();
  (contratos.data || []).forEach((c: any) => {
    const previo = contratoVigente.get(c.empleado_id);
    if (!previo || (c.fecha_inicio || "") > previo.inicio) {
      contratoVigente.set(c.empleado_id, {
        monto: montoMensual(c.remuneracion_o_beca),
        inicio: c.fecha_inicio || "",
      });
    }
  });
  (emps.data || []).forEach((e: any) => {
    if (!ROLES_CONVENIO.includes(e.rol || "")) return;
    const c = contratoVigente.get(e.id);
    if (!c || c.monto <= 0) return;
    const pagados = new Set<string>(
      (pagosConv.data || [])
        .filter((pc: any) => pc.empleado_id === e.id)
        .map((pc: any) => String(pc.mes).slice(0, 10)),
    );
    ciclosBeca(c.inicio, sumaDias(hoy, 40))
      .filter((ciclo) => !pagados.has(ciclo.inicio))
      .forEach((ciclo) => {
        const vence =
          fechaEditada.get(`beca:${e.id}:${ciclo.inicio}`) || ciclo.vence;
        if (vence > manana) return;
        const ya = vence <= hoy;
        avisos.push({
          id: `beca-pagar-${e.id}-${ciclo.inicio}-${ya ? "ya" : "man"}`,
          tipo: "raya",
          titulo: `${ya ? "Toca pagar" : "Mañana toca pagar"} la beca de ${e.nombre}`,
          detalle: `${dinero(c.monto)} · ${rangoCiclo(ciclo.inicio)}`,
          fecha: `${vence}T12:00:00Z`,
          urgente: ya,
        });
      });
  });

  return avisos
    .filter((a) => !sinNomina || a.tipo !== "raya")
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}
