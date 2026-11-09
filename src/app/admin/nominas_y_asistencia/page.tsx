"use client";

import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Sidebar";
import { useRouter } from "next/navigation";
import { useNivelAdmin } from "../../../lib/useNivelAdmin";
import { Icon } from "../../../components/icons";
import { ModalOverlay } from "../../../components/ModalOverlay";
import { supabase } from "../../../lib/supabaseClient";
import { getCurrentAdminId } from "../../../lib/currentAdmin";
import { ROLES_CONVENIO } from "../../../lib/convenios";
import { asegurarSemanasRaya } from "../../../lib/rayaAuto";
import {
  ciclosAdeudados,
  ciclosBeca,
  montoMensual,
  rangoCiclo,
  sumaMeses,
} from "../../../lib/pagos";
import { PagosPanel, type Pago } from "./PagosPanel";

interface Empleado {
  id: string;
  nombre: string;
  color?: string | null;
  area?: string[] | null;
  nivel?: string | null;
  rol?: string | null;
}

// Los de convenio (Prácticas, SS y Jóvenes Construyendo el Futuro) no reciben
// raya semanal. Lista única en src/lib/convenios.ts.
const esConvenio = (e?: Empleado | null) =>
  !!e && ROLES_CONVENIO.includes(e.rol || "");

interface RayaSemana {
  id: string;
  semana_inicio: string;
  estado: string;
  nota?: string | null;
  created_at: string;
}

interface RayaDetalle {
  id: string;
  semana_id: string;
  empleado_id: string;
  dias_trabajados: number;
  pago_dia: number;
  extras: number;
  descuentos: number;
  asistencia: Record<string, boolean> | null;
  nota?: string | null;
  total: number;
  pagado?: boolean;
  fecha_pago?: string | null;
}

interface PagoConvenio {
  id: string;
  empleado_id: string;
  mes: string;
  monto: number;
  fecha_pago: string;
}

const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
const DIAS_LABEL: Record<string, string> = {
  lun: "L",
  mar: "A",
  mie: "M",
  jue: "J",
  vie: "V",
  sab: "S",
  dom: "D",
};
const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

const money = (n: number) =>
  (Number(n) || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });

// "YYYY-MM-DD" -> lunes de esa semana, sin conversión de zona horaria.
const lunesDe = (fecha: string) => {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const diff = dt.getDay() === 0 ? -6 : 1 - dt.getDay();
  dt.setDate(dt.getDate() + diff);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

const fmtRango = (semanaInicio: string) => {
  const [y, m, d] = semanaInicio.split("-").map(Number);
  const ini = new Date(y, m - 1, d);
  const fin = new Date(y, m - 1, d + 6);
  const mismoMes = ini.getMonth() === fin.getMonth();
  return mismoMes
    ? `${ini.getDate()}–${fin.getDate()} ${MESES[ini.getMonth()]} ${ini.getFullYear()}`
    : `${ini.getDate()} ${MESES[ini.getMonth()]} – ${fin.getDate()} ${MESES[fin.getMonth()]} ${fin.getFullYear()}`;
};

const sumaDias = (ymd: string, dias: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + dias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

// "2026-10-31" → "sábado, 31 de octubre"
const fechaLarga = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
};

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const totalFila = (d: {
  dias_trabajados: number;
  pago_dia: number;
  extras: number;
  descuentos: number;
}) =>
  (Number(d.dias_trabajados) || 0) * (Number(d.pago_dia) || 0) +
  (Number(d.extras) || 0) -
  (Number(d.descuentos) || 0);

function NominasAsistenciaPage() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [semanas, setSemanas] = useState<RayaSemana[]>([]);
  const [detallePorSemana, setDetallePorSemana] = useState<
    Record<string, RayaDetalle[]>
  >({});
  const [expandidaId, setExpandidaId] = useState<string | null>(null);
  const [verProyeccion, setVerProyeccion] = useState(false);
  const [vista, setVista] = useState<"porPagar" | "pagados" | "listas">(
    "porPagar",
  );
  const [ocupadoClave, setOcupadoClave] = useState<string | null>(null);
  // Contrato vigente de cada persona: monto mensual de la beca y fecha de inicio.
  const [contratosPorEmp, setContratosPorEmp] = useState<
    Record<string, { monto: number; inicio: string }>
  >({});
  const [pagosConvenio, setPagosConvenio] = useState<PagoConvenio[]>([]);
  // Fechas de pago editadas a mano (si no hay, rige la regla: sábado / aniversario).
  const [fechasPago, setFechasPago] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

  const [nuevaSemanaOpen, setNuevaSemanaOpen] = useState(false);
  const [nuevaSemanaFecha, setNuevaSemanaFecha] = useState("");
  const [creandoSemana, setCreandoSemana] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  useEffect(() => {
    getCurrentAdminId().then(setCurrentAdminId);
  }, []);

  const cargarConvenios = async () => {
    const [{ data: contData }, { data: pagData }, { data: fechasData }] =
      await Promise.all([
        (supabase.from("contratos") as any).select(
          "empleado_id, remuneracion_o_beca, fecha_inicio",
        ),
        (supabase.from("pagos_convenio") as any).select("*"),
        (supabase.from("fechas_pago") as any).select("clave, fecha"),
      ]);
    const editadas: Record<string, string> = {};
    (fechasData || []).forEach((f: any) => {
      editadas[f.clave] = String(f.fecha).slice(0, 10);
    });
    setFechasPago(editadas);
    const mapa: Record<string, { monto: number; inicio: string }> = {};
    (contData || []).forEach((c: any) => {
      const previo = mapa[c.empleado_id];
      if (!previo || (c.fecha_inicio || "") > previo.inicio) {
        mapa[c.empleado_id] = {
          monto: montoMensual(c.remuneracion_o_beca),
          inicio: c.fecha_inicio || "",
        };
      }
    });
    setContratosPorEmp(mapa);
    setPagosConvenio(pagData || []);
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      await asegurarSemanasRaya();
      const [{ data: empData }, { data: semData }, { data: detData }] =
        await Promise.all([
          (supabase.from("empleados") as any)
            .select("id, nombre, color, area, nivel, rol")
            .order("nombre"),
          (supabase.from("raya_semanas") as any)
            .select("*")
            .order("semana_inicio", { ascending: false }),
          (supabase.from("raya_detalle") as any).select("*"),
        ]);
      setEmpleados(empData || []);
      setSemanas(semData || []);
      const map: Record<string, RayaDetalle[]> = {};
      (detData || []).forEach((r: any) => {
        (map[r.semana_id] ||= []).push(r);
      });
      setDetallePorSemana(map);
      await cargarConvenios();
    } catch (err) {
      console.error("Error cargando Nóminas y Asistencia:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Todos cobran, menos Gerencia: la planta por raya semanal y el personal de
  // convenio por su beca mensual. Ya no hay alta manual.
  const plantilla = empleados.filter(
    (e) => !esConvenio(e) && e.nivel !== "Gerencia",
  );
  const personalConvenio = empleados.filter(
    (e) => esConvenio(e) && e.nivel !== "Gerencia",
  );

  const totalDeSemana = (semanaId: string) =>
    (detallePorSemana[semanaId] || []).reduce((s, d) => s + totalFila(d), 0);
  // --- Pagos ---
  // Cada pago es de una persona: una semana de raya o un mes de beca de
  // convenio. La raya se paga por renglón; la beca sale del monto del contrato
  // y vence el último día de cada mes.
  const hoyPagos = (() => {
    const h = new Date();
    const d2 = (n: number) => String(n).padStart(2, "0");
    return `${h.getFullYear()}-${d2(h.getMonth() + 1)}-${d2(h.getDate())}`;
  })();
  const pagosRaya: Pago[] = semanas.flatMap((sem) =>
    (detallePorSemana[sem.id] || [])
      .filter((d) => {
        if (totalFila(d) > 0) return true;
        // Sin días capturados pero con pago por día conocido: solo recuerda
        // capturar cuando ya llegó el día de pago.
        const vence =
          fechasPago[`raya:${d.id}`] || sumaDias(sem.semana_inicio, 5);
        return !d.pagado && Number(d.pago_dia) > 0 && vence <= hoyPagos;
      })
      .map((d) => {
        const e = empleados.find((x) => x.id === d.empleado_id);
        return {
          clave: `raya-${d.id}`,
          tipo: "raya" as const,
          empleadoId: d.empleado_id,
          refId: d.id,
          empleadoNombre: e?.nombre || "—",
          color: e?.color,
          concepto: `Semana ${fmtRango(sem.semana_inicio)}`,
          monto: totalFila(d),
          fecha: fechasPago[`raya:${d.id}`] || sumaDias(sem.semana_inicio, 5),
          fechaBase: sumaDias(sem.semana_inicio, 5),
          claveFecha: `raya:${d.id}`,
          pagado: !!d.pagado,
          fechaPago: d.fecha_pago || null,
          faltaCaptura: totalFila(d) <= 0,
          semanaId: sem.id,
        };
      }),
  );
  const pagosBeca: Pago[] = [
    ...pagosConvenio.map((pc) => {
      const e = empleados.find((x) => x.id === pc.empleado_id);
      return {
        clave: `beca-${pc.id}`,
        tipo: "convenio" as const,
        empleadoId: pc.empleado_id,
        refId: pc.id,
        mes: pc.mes,
        empleadoNombre: e?.nombre || "—",
        color: e?.color,
        concepto: `Beca ${rangoCiclo(pc.mes)}`,
        monto: Number(pc.monto),
        fecha: sumaMeses(pc.mes, 1),
        fechaBase: sumaMeses(pc.mes, 1),
        claveFecha: `beca:${pc.empleado_id}:${pc.mes}`,
        pagado: true,
        fechaPago: pc.fecha_pago,
      };
    }),
    ...personalConvenio.flatMap((e) => {
      const c = contratosPorEmp[e.id];
      if (!c || c.monto <= 0) return [];
      const yaPagados = new Set<string>(
        pagosConvenio
          .filter((pc) => pc.empleado_id === e.id)
          .map((pc) => pc.mes),
      );
      // La beca se paga un mes después de empezar cada ciclo (o en la fecha que
      // se haya editado): aparece cuando llega ese día.
      return ciclosBeca(c.inicio, sumaMeses(hoyPagos, 1))
        .filter((ciclo) => !yaPagados.has(ciclo.inicio))
        .map((ciclo) => {
          const claveFecha = `beca:${e.id}:${ciclo.inicio}`;
          return {
            clave: `beca-${e.id}-${ciclo.inicio}`,
            tipo: "convenio" as const,
            empleadoId: e.id,
            refId: "",
            mes: ciclo.inicio,
            empleadoNombre: e.nombre,
            color: e.color,
            concepto: `Beca ${rangoCiclo(ciclo.inicio)}`,
            monto: c.monto,
            fecha: fechasPago[claveFecha] || ciclo.vence,
            fechaBase: ciclo.vence,
            claveFecha,
            pagado: false,
            fechaPago: null,
          };
        })
        .filter((p) => p.fecha <= hoyPagos);
    }),
  ];
  const pagos: Pago[] = [...pagosRaya, ...pagosBeca];

  // --- Anuncio: a quién se le paga y qué día ---
  // Trabajadores: todos los sábados (hoy mismo si es sábado).
  const proximoSabado = (() => {
    const [y, m, d] = hoyPagos.split("-").map(Number);
    const dia = new Date(y, m - 1, d).getDay();
    return sumaDias(hoyPagos, (6 - dia + 7) % 7);
  })();
  // Prácticas y convenios: el mismo día del mes en que empezaron su contrato.
  const proximasBecas = personalConvenio.map((e) => {
    const c = contratosPorEmp[e.id];
    if (!c || c.monto <= 0 || !c.inicio) return { e, c, siguiente: null };
    const pagados = new Set<string>(
      pagosConvenio.filter((pc) => pc.empleado_id === e.id).map((pc) => pc.mes),
    );
    const siguiente =
      ciclosBeca(c.inicio, sumaMeses(hoyPagos, 13))
        .filter((ciclo) => !pagados.has(ciclo.inicio))
        .map((ciclo) => ({
          fecha: fechasPago[`beca:${e.id}:${ciclo.inicio}`] || ciclo.vence,
        }))
        .filter((x) => x.fecha >= hoyPagos)
        .sort((a, b) => a.fecha.localeCompare(b.fecha))[0] || null;
    return { e, c, siguiente };
  });
  const pendientes = pagos.filter((p) => !p.pagado && !p.faltaCaptura);
  const porCapturar = pagos.filter((p) => p.faltaCaptura);
  const hechos = pagos.filter((p) => p.pagado);
  const totalPorPagar = pendientes.reduce((s, p) => s + p.monto, 0);
  const totalPagado = hechos.reduce((s, p) => s + p.monto, 0);
  const porPagarSemanal = pendientes
    .filter((p) => p.tipo === "raya")
    .reduce((s, p) => s + p.monto, 0);
  const porPagarMensual = totalPorPagar - porPagarSemanal;
  const personasPorPagar = new Set(pendientes.map((p) => p.empleadoId)).size;

  // --- Proyecciones ---
  // Semanal: por cada persona de la plantilla, su último pago por día × el
  // promedio de días que trabajó en sus últimas 4 semanas con pago (máx. 7).
  // Quien aún no tiene una semana con pago capturado no entra al cálculo.
  const proyeccionPersonas = plantilla.map((e) => {
    const filas = semanas
      .map((sem) =>
        (detallePorSemana[sem.id] || []).find((d) => d.empleado_id === e.id),
      )
      .filter((d): d is RayaDetalle => !!d && Number(d.pago_dia) > 0);
    if (filas.length === 0) {
      return { empleado: e, pagoDia: 0, dias: 0, total: 0 };
    }
    const recientes = filas.slice(0, 4);
    const dias = Math.min(
      7,
      recientes.reduce((s, d) => s + (Number(d.dias_trabajados) || 0), 0) /
        recientes.length,
    );
    const pagoDia = Number(filas[0].pago_dia);
    return { empleado: e, pagoDia, dias, total: pagoDia * dias };
  });
  const proyeccionSemanal = proyeccionPersonas.reduce((s, p) => s + p.total, 0);
  const personasSinHistorial = proyeccionPersonas.filter(
    (p) => p.pagoDia === 0,
  ).length;

  // Del año: lo registrado este año (pagado + por pagar) más la proyección
  // semanal repetida en cada semana que falta, desde hoy hasta el 31 dic.
  const anioActual = new Date().getFullYear();
  const registradoAnio = semanas
    .filter((s) => s.semana_inicio.startsWith(String(anioActual)))
    .reduce((s, sem) => s + totalDeSemana(sem.id), 0);
  const hoyYmd = (() => {
    const h = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${h.getFullYear()}-${p(h.getMonth() + 1)}-${p(h.getDate())}`;
  })();
  // Solo hacia adelante: desde la semana actual, o desde la siguiente a la
  // última lista registrada si ya hay una de esta semana o posterior.
  let inicioProyeccion = lunesDe(hoyYmd);
  if (semanas.length > 0) {
    const despuesDeLaUltima = sumaDias(semanas[0].semana_inicio, 7);
    if (despuesDeLaUltima > inicioProyeccion) {
      inicioProyeccion = despuesDeLaUltima;
    }
  }
  let semanasSinLista = 0;
  for (
    let f = inicioProyeccion, i = 0;
    i < 120 && f <= `${anioActual}-12-31`;
    f = sumaDias(f, 7), i++
  ) {
    if (f.startsWith(String(anioActual))) semanasSinLista++;
  }
  // Becas de convenio del año: las ya pagadas más los ciclos que vencen en él.
  const becasPagadasAnio = pagosConvenio
    .filter((pc) => sumaMeses(pc.mes, 1).startsWith(String(anioActual)))
    .reduce((s, pc) => s + Number(pc.monto), 0);
  const becasPorPagarAnio = personalConvenio.reduce((total, e) => {
    const c = contratosPorEmp[e.id];
    if (!c || c.monto <= 0) return total;
    const yaPagados = new Set<string>(
      pagosConvenio.filter((pc) => pc.empleado_id === e.id).map((pc) => pc.mes),
    );
    const ciclos = ciclosBeca(c.inicio, `${anioActual}-12-31`).filter(
      (ciclo) =>
        ciclo.vence.startsWith(String(anioActual)) &&
        !yaPagados.has(ciclo.inicio),
    );
    return total + ciclos.length * c.monto;
  }, 0);
  const becasAnio = becasPagadasAnio + becasPorPagarAnio;
  const proyeccionAnio =
    registradoAnio + proyeccionSemanal * semanasSinLista + becasAnio;

  // --- Handlers ---
  const handleNuevaSemana = async () => {
    if (!nuevaSemanaFecha) return;
    const semanaInicio = lunesDe(nuevaSemanaFecha);
    if (semanas.some((s) => s.semana_inicio === semanaInicio)) {
      alert("Ya existe una lista de raya para esa semana.");
      return;
    }
    try {
      setCreandoSemana(true);
      const { data: sem, error } = await (supabase.from("raya_semanas") as any)
        .insert({
          semana_inicio: semanaInicio,
          estado: "Borrador",
          creado_por: currentAdminId,
        })
        .select("*")
        .single();
      if (error) throw error;

      if (plantilla.length > 0) {
        const filas = plantilla.map((e) => ({
          semana_id: sem.id,
          empleado_id: e.id,
          dias_trabajados: 0,
          pago_dia: 0,
          extras: 0,
          descuentos: 0,
        }));
        const { error: detErr } = await (
          supabase.from("raya_detalle") as any
        ).insert(filas);
        if (detErr) throw detErr;
      }

      setNuevaSemanaOpen(false);
      setNuevaSemanaFecha("");
      await fetchAll();
      setExpandidaId(sem.id);
    } catch (err: any) {
      alert("No se pudo crear la semana: " + (err.message || "Error"));
    } finally {
      setCreandoSemana(false);
    }
  };

  const patchDetalleLocal = (
    semanaId: string,
    detId: string,
    cambios: Partial<RayaDetalle>,
  ) => {
    setDetallePorSemana((prev) => ({
      ...prev,
      [semanaId]: (prev[semanaId] || []).map((d) =>
        d.id === detId ? { ...d, ...cambios } : d,
      ),
    }));
  };

  // Normaliza el valor de un campo numérico: nunca negativo, y los días topados en 7.
  const clampCampo = (campo: string, raw: number) => {
    const n = Number.isFinite(raw) ? raw : 0;
    if (campo === "dias_trabajados") return Math.min(7, Math.max(0, n));
    return Math.max(0, n);
  };

  const handleGuardarFila = async (
    semanaId: string,
    det: RayaDetalle,
    campo: keyof RayaDetalle,
  ) => {
    const valor = clampCampo(campo as string, Number((det as any)[campo]));
    // Refleja el clamp en la UI antes de persistir.
    patchDetalleLocal(semanaId, det.id, { [campo]: valor } as any);
    try {
      const { data, error } = await (supabase.from("raya_detalle") as any)
        .update({ [campo]: valor })
        .eq("id", det.id)
        .select("*")
        .single();
      if (error) throw error;
      patchDetalleLocal(semanaId, det.id, { total: data.total });
    } catch (err: any) {
      alert("No se pudo guardar: " + (err.message || "Error"));
      await fetchAll();
    }
  };

  const toggleDia = async (semanaId: string, det: RayaDetalle, dia: string) => {
    const prev = det.asistencia || {};
    const asistencia = { ...prev, [dia]: !prev[dia] };
    const dias = DIAS.filter((d) => asistencia[d]).length;
    patchDetalleLocal(semanaId, det.id, { asistencia, dias_trabajados: dias });
    try {
      const { data, error } = await (supabase.from("raya_detalle") as any)
        .update({ asistencia, dias_trabajados: dias })
        .eq("id", det.id)
        .select("total")
        .single();
      if (error) throw error;
      if (data) patchDetalleLocal(semanaId, det.id, { total: data.total });
    } catch (err: any) {
      // Revertir el toggle local si la BD lo rechazó.
      patchDetalleLocal(semanaId, det.id, {
        asistencia: prev,
        dias_trabajados: DIAS.filter((d) => prev[d]).length,
      });
      alert("No se pudo guardar la asistencia: " + (err.message || "Error"));
    }
  };

  // Marca un pago como hecho (o lo deshace). La raya guarda la marca en su
  // renglón; la beca de convenio crea (o borra) un registro del mes.
  const pagar = async (p: Pago) => {
    setOcupadoClave(p.clave);
    try {
      if (p.tipo === "raya") {
        const fecha = new Date().toISOString();
        const { error } = await (supabase.from("raya_detalle") as any)
          .update({ pagado: true, fecha_pago: fecha })
          .eq("id", p.refId);
        if (error) throw error;
        setDetallePorSemana((prev) => {
          const sig = { ...prev };
          for (const k of Object.keys(sig)) {
            sig[k] = sig[k].map((d) =>
              d.id === p.refId ? { ...d, pagado: true, fecha_pago: fecha } : d,
            );
          }
          return sig;
        });
      } else {
        const { error } = await (supabase.from("pagos_convenio") as any).insert(
          {
            empleado_id: p.empleadoId,
            mes: p.mes,
            monto: p.monto,
          },
        );
        if (error) throw error;
        await cargarConvenios();
      }
    } catch (err: any) {
      alert("No se pudo registrar el pago: " + (err.message || "Error"));
    } finally {
      setOcupadoClave(null);
    }
  };

  const deshacerPago = async (p: Pago) => {
    setOcupadoClave(p.clave);
    try {
      if (p.tipo === "raya") {
        const { error } = await (supabase.from("raya_detalle") as any)
          .update({ pagado: false, fecha_pago: null })
          .eq("id", p.refId);
        if (error) throw error;
        setDetallePorSemana((prev) => {
          const sig = { ...prev };
          for (const k of Object.keys(sig)) {
            sig[k] = sig[k].map((d) =>
              d.id === p.refId ? { ...d, pagado: false, fecha_pago: null } : d,
            );
          }
          return sig;
        });
      } else {
        const { error } = await (supabase.from("pagos_convenio") as any)
          .delete()
          .eq("id", p.refId);
        if (error) throw error;
        await cargarConvenios();
      }
    } catch (err: any) {
      alert("No se pudo deshacer el pago: " + (err.message || "Error"));
    } finally {
      setOcupadoClave(null);
    }
  };

  // Cambia el día en que se debe pagar algo. Sin fecha (o igual a la regla) se
  // vuelve al sábado / aniversario.
  const cambiarFechaPago = async (p: Pago, nueva: string | null) => {
    const volver = !nueva || nueva === p.fechaBase;
    setFechasPago((prev) => {
      const sig = { ...prev };
      if (volver) delete sig[p.claveFecha];
      else sig[p.claveFecha] = nueva as string;
      return sig;
    });
    try {
      const tabla = supabase.from("fechas_pago") as any;
      const { error } = volver
        ? await tabla.delete().eq("clave", p.claveFecha)
        : await tabla.upsert({ clave: p.claveFecha, fecha: nueva });
      if (error) throw error;
    } catch (err: any) {
      alert("No se pudo cambiar la fecha: " + (err.message || "Error"));
      await cargarConvenios();
    }
  };

  // Lleva a la lista de raya de esa semana para capturar días.
  const irACapturar = (p: Pago) => {
    setVista("listas");
    if (p.semanaId) setExpandidaId(p.semanaId);
  };

  const pagarTodo = (lista: Pago[]) =>
    setConfirmDialog({
      titulo: "Pagar todo",
      mensaje: `¿Marcar como pagados ${lista.length} pagos por ${money(
        lista.reduce((t, x) => t + x.monto, 0),
      )}?`,
      onConfirmar: async () => {
        for (const p of lista) await pagar(p);
      },
    });

  // Lo que se le debe a una persona y el botón para pagárselo de una vez.
  const accionPago = (id: string, nombre: string) => {
    const pend = pendientes.filter((p) => p.empleadoId === id);
    if (pend.length === 0 && porCapturar.some((p) => p.empleadoId === id)) {
      return (
        <span className="shrink-0 text-[10px] font-semibold text-amber-600">
          Falta capturar
        </span>
      );
    }
    if (pend.length === 0) {
      return (
        <span className="shrink-0 text-[10px] font-semibold text-emerald-600">
          Al corriente
        </span>
      );
    }
    const total = pend.reduce((t, p) => t + p.monto, 0);
    return (
      <button
        type="button"
        onClick={() =>
          setConfirmDialog({
            titulo: `Pagar a ${nombre}`,
            mensaje: `${pend
              .map((p) => `${p.concepto}: ${money(p.monto)}`)
              .join(" · ")}. Total ${money(total)}. ¿Marcar como pagado?`,
            onConfirmar: async () => {
              for (const p of pend) await pagar(p);
            },
          })
        }
        className="shrink-0 flex flex-col items-end leading-tight bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-2 py-1 cursor-pointer transition-colors"
      >
        <span className="text-[11px] font-bold tabular-nums">
          {money(total)}
        </span>
        <span className="text-[9px] font-medium opacity-90">
          Pagar{pend.length > 1 ? ` (${pend.length})` : ""}
        </span>
      </button>
    );
  };

  const handleEliminarSemana = async (sem: RayaSemana) => {
    setSemanas((prev) => prev.filter((s) => s.id !== sem.id));
    if (expandidaId === sem.id) setExpandidaId(null);
    try {
      const { error } = await (supabase.from("raya_semanas") as any)
        .delete()
        .eq("id", sem.id);
      if (error) throw error;
    } catch (err: any) {
      alert("No se pudo eliminar: " + (err.message || "Error"));
      await fetchAll();
    }
  };

  const exportarCSV = (sem: RayaSemana) => {
    const filas = detallePorSemana[sem.id] || [];
    const head = [
      "Colaborador",
      "Dias",
      "Pago/dia",
      "Extras",
      "Descuentos",
      "Total",
    ];
    const lineas = filas.map((d) => {
      const emp = empleados.find((e) => e.id === d.empleado_id);
      return [
        (emp?.nombre || "—").replace(/"/g, "'"),
        d.dias_trabajados,
        d.pago_dia,
        d.extras,
        d.descuentos,
        totalFila(d),
      ].join(",");
    });
    const csv = [
      `Raya semana ${fmtRango(sem.semana_inicio)}`,
      head.join(","),
      ...lineas,
      `,,,,Total,${totalDeSemana(sem.id)}`,
    ].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `raya_${sem.semana_inicio}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const imprimirPDF = (sem: RayaSemana) => {
    setExpandidaId(sem.id);
    setTimeout(() => window.print(), 60);
  };

  return (
    <div className="h-screen w-screen bg-slate-50 flex font-sans overflow-hidden select-none">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #raya-print, #raya-print * { visibility: visible !important; }
          #raya-print { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; }
          .no-print { display: none !important; }
        }
      `}</style>
      <Sidebar />

      <main className="flex-1 flex flex-col p-1.5 md:p-2 overflow-hidden h-full min-w-0">
        {/* Encabezado */}
        <div className="shrink-0 mb-1.5 flex items-center justify-between flex-wrap gap-1 pb-1.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
              <Icon name="banknote" size={15} />
            </span>
            <div>
              <h1 className="m-0 text-[15px] font-semibold text-slate-900 tracking-tight leading-tight">
                Nóminas y Asistencia
              </h1>
              <p className="m-0 text-[11px] text-slate-500 leading-tight">
                Listas de raya semanal · toda la empresa
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNuevaSemanaOpen(true)}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[12px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
          >
            <Icon name="plus" size={14} />
            Nueva semana
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-xs font-bold text-slate-500 gap-1">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            Cargando…
          </div>
        ) : (
          <>
            {/* Anuncio de pagos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 shrink-0 mb-2">
              <div className="rounded-lg p-4 bg-blue-600 text-white">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-blue-100">
                  Trabajadores · pago semanal
                </div>
                <div className="text-[26px] font-bold leading-tight mt-1 capitalize">
                  {fechaLarga(proximoSabado)}
                </div>
                <div className="text-[12px] text-blue-100 mt-0.5">
                  Se les paga todos los sábados · {plantilla.length}{" "}
                  {plantilla.length === 1 ? "persona" : "personas"}
                </div>
                <div className="flex flex-wrap gap-1 mt-2 max-h-16 overflow-y-auto">
                  {plantilla.map((e) => (
                    <span
                      key={e.id}
                      className="text-[11px] font-medium bg-white/15 rounded-full px-2 py-0.5"
                    >
                      {e.nombre.split(/\s+/).slice(0, 2).join(" ")}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg p-4 bg-violet-600 text-white">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-violet-100">
                  Prácticas y convenios · pago mensual
                </div>
                {proximasBecas.length === 0 ? (
                  <div className="text-[13px] text-violet-100 mt-2">
                    No hay personal de convenio.
                  </div>
                ) : (
                  <div className="mt-1.5 flex flex-col gap-1.5 max-h-28 overflow-y-auto">
                    {proximasBecas.map(({ e, c, siguiente }) => (
                      <div
                        key={e.id}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <span className="text-[13px] font-semibold truncate">
                          {e.nombre}
                        </span>
                        <span className="text-[12px] text-violet-100 text-right shrink-0">
                          {siguiente ? (
                            <>
                              <strong className="text-white text-[15px] capitalize">
                                {fechaLarga(siguiente.fecha)}
                              </strong>
                              {c ? ` · ${money(c.monto)}` : ""}
                            </>
                          ) : c && c.monto > 0 ? (
                            "Sin fecha próxima"
                          ) : (
                            "Sin beca en su contrato"
                          )}
                        </span>
                      </div>
                    ))}
                    <div className="text-[11px] text-violet-200">
                      Se les paga cada mes, el día en que empezaron.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fila 1: resumen */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 shrink-0 mb-2">
              <div className="bg-slate-900 text-white rounded-lg p-3">
                <span className="text-[10px] uppercase tracking-wider font-medium text-slate-400">
                  Por pagar
                </span>
                <div className="text-[22px] font-semibold text-amber-400 leading-tight mt-1 tabular-nums">
                  {money(totalPorPagar)}
                </div>
                <span className="text-[10px] text-slate-500">
                  {pendientes.length}{" "}
                  {pendientes.length === 1 ? "pago" : "pagos"} ·{" "}
                  {personasPorPagar}{" "}
                  {personasPorPagar === 1 ? "persona" : "personas"}
                </span>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Semanal {money(porPagarSemanal)} · Mensual{" "}
                  {money(porPagarMensual)}
                </div>
              </div>
              <div className="bg-slate-900 text-white rounded-lg p-3">
                <span className="text-[10px] uppercase tracking-wider font-medium text-slate-400">
                  Pagados
                </span>
                <div className="text-[22px] font-semibold text-emerald-400 leading-tight mt-1 tabular-nums">
                  {money(totalPagado)}
                </div>
                <span className="text-[10px] text-slate-500">
                  {hechos.length} {hechos.length === 1 ? "pago" : "pagos"}
                  registrados
                </span>
              </div>
              <div className="bg-slate-900 text-white rounded-lg p-3">
                <span className="text-[10px] uppercase tracking-wider font-medium text-slate-400">
                  Proyección semanal
                </span>
                <div className="text-[22px] font-semibold text-sky-400 leading-tight mt-1 tabular-nums">
                  {money(proyeccionSemanal)}
                </div>
                <span className="text-[10px] text-slate-500">
                  {plantilla.length - personasSinHistorial} de{" "}
                  {plantilla.length} personas
                  {personasSinHistorial > 0
                    ? ` · ${personasSinHistorial} sin historial`
                    : ""}{" "}
                  ·{" "}
                  <button
                    type="button"
                    onClick={() => setVerProyeccion((v) => !v)}
                    className="underline hover:text-slate-300 cursor-pointer"
                  >
                    {verProyeccion ? "ocultar desglose" : "ver desglose"}
                  </button>
                </span>
              </div>
              <div className="bg-slate-900 text-white rounded-lg p-3">
                <span className="text-[10px] uppercase tracking-wider font-medium text-slate-400">
                  Proyección {anioActual}
                </span>
                <div className="text-[22px] font-semibold text-sky-400 leading-tight mt-1 tabular-nums">
                  {money(proyeccionAnio)}
                </div>
                <span className="text-[10px] text-slate-500">
                  {money(registradoAnio)} de raya + {semanasSinLista}{" "}
                  {semanasSinLista === 1 ? "semana" : "semanas"} ×{" "}
                  {money(proyeccionSemanal)}
                </span>
              </div>
            </div>

            {verProyeccion && (
              <div className="bg-white border border-slate-200 rounded-lg p-2 mb-2 shrink-0 max-h-48 overflow-y-auto">
                <div className="text-[12px] font-semibold text-slate-900 pb-1">
                  Desglose de la proyección semanal
                </div>
                {plantilla.length === 0 ? (
                  <p className="text-[11px] text-slate-400 py-2 text-center">
                    No hay personal en la plantilla.
                  </p>
                ) : (
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="text-[9.5px] uppercase text-slate-400 text-left">
                        <th className="py-1 pr-2 font-semibold">Colaborador</th>
                        <th className="py-1 px-1 font-semibold text-right">
                          Último pago/día
                        </th>
                        <th className="py-1 px-1 font-semibold text-right">
                          Días promedio
                        </th>
                        <th className="py-1 pl-1 font-semibold text-right">
                          Proyectado
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {proyeccionPersonas.map((p) => (
                        <tr
                          key={p.empleado.id}
                          className="border-t border-slate-100"
                        >
                          <td className="py-1 pr-2 text-slate-800 font-medium">
                            {p.empleado.nombre}
                          </td>
                          {p.pagoDia > 0 ? (
                            <>
                              <td className="py-1 px-1 text-right tabular-nums">
                                {money(p.pagoDia)}
                              </td>
                              <td className="py-1 px-1 text-right tabular-nums">
                                {p.dias.toFixed(1)}
                              </td>
                              <td className="py-1 pl-1 text-right font-semibold tabular-nums">
                                {money(p.total)}
                              </td>
                            </>
                          ) : (
                            <td
                              colSpan={3}
                              className="py-1 text-right text-slate-400 italic"
                            >
                              Sin semanas con pago capturado
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Fila 2: historial + plantilla */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 flex-1 min-h-0">
              {/* Historial */}
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-2 flex flex-col min-h-0 overflow-hidden">
                <div className="flex items-center justify-between gap-1 shrink-0 pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-1 min-w-0 flex-wrap">
                    {(
                      [
                        ["porPagar", "Por pagar", pendientes.length],
                        ["pagados", "Pagados", hechos.length],
                        ["listas", "Listas de raya", semanas.length],
                      ] as const
                    ).map(([k, label, n]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setVista(k)}
                        className={`text-[12px] font-semibold px-2 py-1 rounded-lg cursor-pointer transition-colors ${
                          vista === k
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {label} <span className="opacity-60">{n}</span>
                      </button>
                    ))}
                  </div>
                  {expandidaId && vista === "listas" && (
                    <div className="flex items-center gap-1 shrink-0 no-print">
                      <button
                        type="button"
                        onClick={() => {
                          const s = semanas.find((x) => x.id === expandidaId);
                          if (s) exportarCSV(s);
                        }}
                        className="text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg cursor-pointer transition-colors"
                      >
                        Exportar Raya
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const s = semanas.find((x) => x.id === expandidaId);
                          if (s) imprimirPDF(s);
                        }}
                        className="text-[11px] font-semibold text-white bg-slate-900 hover:bg-slate-800 px-2 py-1 rounded-lg cursor-pointer transition-colors"
                      >
                        Imprimir PDF
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto min-h-0 pt-1.5 space-y-1">
                  {vista !== "listas" ? (
                    <PagosPanel
                      pagos={pagos}
                      vista={vista}
                      ocupadoClave={ocupadoClave}
                      onPagar={pagar}
                      onDeshacer={deshacerPago}
                      onPagarTodo={pagarTodo}
                      onCambiarFecha={cambiarFechaPago}
                      onCapturar={irACapturar}
                    />
                  ) : semanas.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center px-4">
                      <span className="text-[12px] text-slate-400 italic">
                        No hay reportes de nómina o asistencia registrados.
                      </span>
                    </div>
                  ) : (
                    [{ titulo: "Semanas", lista: semanas }].map((grupo) => (
                      <div key={grupo.titulo} className="space-y-1">
                        {grupo.lista.map((sem) => {
                          const abierta = expandidaId === sem.id;
                          const filas = detallePorSemana[sem.id] || [];
                          const pagables = filas.filter(
                            (d) => totalFila(d) > 0,
                          );
                          const pagadasN = pagables.filter(
                            (d) => d.pagado,
                          ).length;
                          const estadoPago =
                            pagables.length === 0
                              ? "Sin datos"
                              : pagadasN === pagables.length
                                ? "Pagada"
                                : pagadasN > 0
                                  ? `Pagada ${pagadasN}/${pagables.length}`
                                  : "Por pagar";
                          return (
                            <div
                              key={sem.id}
                              className="border border-slate-200 rounded-lg overflow-hidden"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandidaId(abierta ? null : sem.id)
                                }
                                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer text-left"
                              >
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <Icon
                                    name="chevron-right"
                                    size={14}
                                    className={`text-slate-400 transition-transform ${abierta ? "rotate-90" : ""}`}
                                  />
                                  <span className="text-[12px] font-bold text-slate-800 truncate">
                                    {fmtRango(sem.semana_inicio)}
                                  </span>
                                  <span
                                    className={`text-[9px] font-bold px-1 py-0.5 rounded-full border ${
                                      estadoPago === "Pagada"
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                        : estadoPago === "Por pagar"
                                          ? "bg-amber-50 text-amber-700 border-amber-200"
                                          : "bg-slate-50 text-slate-600 border-slate-200"
                                    }`}
                                  >
                                    {estadoPago}
                                  </span>
                                </span>
                                <span className="shrink-0 text-[12px] font-extrabold text-slate-900">
                                  {money(totalDeSemana(sem.id))}
                                </span>
                              </button>

                              {abierta && (
                                <div
                                  id="raya-print"
                                  className="border-t border-slate-100 p-1.5"
                                >
                                  <div className="hidden print:block mb-2 text-sm font-bold">
                                    Raya · {fmtRango(sem.semana_inicio)}
                                  </div>
                                  {filas.length === 0 ? (
                                    <p className="text-[11px] text-slate-400 py-2 text-center">
                                      No hay personal de planta registrado.
                                    </p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-[11px] border-collapse">
                                        <thead>
                                          <tr className="text-[9.5px] uppercase text-slate-400 text-left">
                                            <th className="py-1 pr-2 font-semibold">
                                              Colaborador
                                            </th>
                                            <th className="py-1 px-1 font-semibold text-center">
                                              Asistencia
                                            </th>
                                            <th className="py-1 px-1 font-semibold w-12">
                                              Días
                                            </th>
                                            <th className="py-1 px-1 font-semibold w-16">
                                              Pago/día
                                            </th>
                                            <th className="py-1 px-1 font-semibold w-16">
                                              Extras
                                            </th>
                                            <th className="py-1 px-1 font-semibold w-16">
                                              Desc.
                                            </th>
                                            <th className="py-1 pl-1 font-semibold text-right w-20">
                                              Total
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {filas.map((d) => {
                                            const emp = empleados.find(
                                              (e) => e.id === d.empleado_id,
                                            );
                                            const bloqueada = !!d.pagado;
                                            return (
                                              <tr
                                                key={d.id}
                                                className="border-t border-slate-100"
                                              >
                                                <td className="py-1 pr-2">
                                                  <span className="flex items-center gap-1.5">
                                                    <span
                                                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                                                      style={{
                                                        backgroundColor:
                                                          emp?.color ||
                                                          "#64748b",
                                                      }}
                                                    >
                                                      {iniciales(
                                                        emp?.nombre || "?",
                                                      )}
                                                    </span>
                                                    <span className="font-semibold text-slate-800 truncate">
                                                      {emp?.nombre || "—"}
                                                    </span>
                                                  </span>
                                                </td>
                                                <td className="py-1 px-1">
                                                  <span className="flex items-center gap-0.5 justify-center no-print">
                                                    {DIAS.map((dia) => (
                                                      <button
                                                        key={dia}
                                                        type="button"
                                                        disabled={bloqueada}
                                                        onClick={() =>
                                                          toggleDia(
                                                            sem.id,
                                                            d,
                                                            dia,
                                                          )
                                                        }
                                                        className={`w-4 h-4 rounded text-[8px] font-bold flex items-center justify-center transition-colors ${
                                                          d.asistencia?.[dia]
                                                            ? "bg-blue-600 text-white"
                                                            : "bg-slate-100 text-slate-400"
                                                        } ${bloqueada ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-blue-100"}`}
                                                      >
                                                        {DIAS_LABEL[dia]}
                                                      </button>
                                                    ))}
                                                  </span>
                                                </td>
                                                {(
                                                  [
                                                    "dias_trabajados",
                                                    "pago_dia",
                                                    "extras",
                                                    "descuentos",
                                                  ] as const
                                                ).map((campo) => (
                                                  <td
                                                    key={campo}
                                                    className="py-1 px-1"
                                                  >
                                                    <input
                                                      type="number"
                                                      min="0"
                                                      max={
                                                        campo ===
                                                        "dias_trabajados"
                                                          ? 7
                                                          : undefined
                                                      }
                                                      step={
                                                        campo ===
                                                        "dias_trabajados"
                                                          ? "0.5"
                                                          : "1"
                                                      }
                                                      disabled={bloqueada}
                                                      value={
                                                        (d as any)[campo] ?? 0
                                                      }
                                                      onChange={(e) =>
                                                        patchDetalleLocal(
                                                          sem.id,
                                                          d.id,
                                                          {
                                                            [campo]:
                                                              e.target.value ===
                                                              ""
                                                                ? 0
                                                                : Number(
                                                                    e.target
                                                                      .value,
                                                                  ),
                                                          } as any,
                                                        )
                                                      }
                                                      onBlur={() =>
                                                        handleGuardarFila(
                                                          sem.id,
                                                          d,
                                                          campo,
                                                        )
                                                      }
                                                      className="w-full bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-[11px] text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 disabled:opacity-60"
                                                    />
                                                  </td>
                                                ))}
                                                <td className="py-1 pl-1 text-right font-extrabold text-slate-900">
                                                  {money(totalFila(d))}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                        <tfoot>
                                          <tr className="border-t-2 border-slate-200">
                                            <td
                                              colSpan={6}
                                              className="py-1 pr-2 text-right text-[10px] uppercase font-bold text-slate-400"
                                            >
                                              Total de la semana
                                            </td>
                                            <td className="py-1 pl-1 text-right text-[13px] font-extrabold text-emerald-600">
                                              {money(totalDeSemana(sem.id))}
                                            </td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  )}

                                  <div className="flex items-center justify-end gap-1 pt-1.5 mt-1 border-t border-slate-100 no-print">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDialog({
                                          titulo: "Eliminar semana",
                                          mensaje: `¿Eliminar la lista de raya de ${fmtRango(sem.semana_inicio)}? Se borra también su desglose.`,
                                          onConfirmar: () =>
                                            handleEliminarSemana(sem),
                                        })
                                      }
                                      className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg cursor-pointer"
                                    >
                                      <Icon name="trash" size={13} /> Eliminar
                                    </button>
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

              {/* Personal: planta y convenio */}
              <div className="bg-white border border-slate-200 rounded-lg p-2 flex flex-col min-h-0 overflow-hidden">
                <div className="shrink-0 pb-1.5 border-b border-slate-100">
                  <div className="text-[12px] font-semibold text-slate-900">
                    Personal
                  </div>
                  <p className="text-[10.5px] text-slate-400">
                    {plantilla.length} de planta · {personalConvenio.length} de
                    convenio
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0 pt-1.5 flex flex-col gap-0.5">
                  <span className="block text-[9.5px] font-bold text-slate-400 uppercase tracking-wide px-1 pb-0.5">
                    Planta · raya semanal ({plantilla.length})
                  </span>
                  {plantilla.length === 0 ? (
                    <span className="text-[11px] text-slate-400 italic px-1 py-2 text-center">
                      Sin personal de planta todavía.
                    </span>
                  ) : (
                    plantilla.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center gap-1.5 px-1 py-1 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: e.color || "#64748b" }}
                        >
                          {iniciales(e.nombre)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12px] font-medium text-slate-800 truncate">
                            {e.nombre}
                          </span>
                          <span className="block text-[9.5px] text-slate-400 truncate">
                            {e.rol || e.area?.join(", ") || e.nivel || "—"}
                          </span>
                        </span>
                        {accionPago(e.id, e.nombre)}
                      </div>
                    ))
                  )}

                  {personalConvenio.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-100">
                      <span className="block text-[9.5px] font-bold text-slate-400 uppercase tracking-wide px-1 pb-0.5">
                        Convenio · beca mensual ({personalConvenio.length})
                      </span>
                      {personalConvenio.map((e) => {
                        const beca = contratosPorEmp[e.id]?.monto || 0;
                        return (
                          <div
                            key={e.id}
                            className="flex items-center gap-1.5 px-1 py-1 rounded-lg hover:bg-slate-50 transition-colors"
                          >
                            <span
                              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                              style={{ backgroundColor: e.color || "#94a3b8" }}
                            >
                              {iniciales(e.nombre)}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[12px] font-medium text-slate-800 truncate">
                                {e.nombre}
                              </span>
                              <span className="block text-[9.5px] text-slate-400 truncate">
                                {e.rol} ·{" "}
                                {beca > 0 ? `${money(beca)}/mes` : "Sin beca"}
                              </span>
                            </span>
                            {accionPago(e.id, e.nombre)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Modal: nueva semana */}
      {nuevaSemanaOpen && (
        <ModalOverlay onClose={() => setNuevaSemanaOpen(false)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
              <h3 className="text-[13px] font-semibold text-slate-900">
                Nueva lista de raya
              </h3>
              <button
                onClick={() => {
                  setNuevaSemanaOpen(false);
                  setNuevaSemanaFecha("");
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="text-xs">
              <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                Semana (cualquier día de esa semana)
              </label>
              <input
                type="date"
                value={nuevaSemanaFecha}
                onChange={(e) => setNuevaSemanaFecha(e.target.value)}
                className="w-full border border-slate-300 rounded-xl p-1.5 text-slate-900 font-medium bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {nuevaSemanaFecha && (
                <p className="mt-1 text-[10.5px] text-slate-400">
                  Se registrará la semana {fmtRango(lunesDe(nuevaSemanaFecha))}{" "}
                  · {plantilla.length} colaborador(es) de planta.
                </p>
              )}
            </div>
            <div className="flex gap-1 pt-1.5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setNuevaSemanaOpen(false);
                  setNuevaSemanaFecha("");
                }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-1.5 rounded-xl font-semibold cursor-pointer text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleNuevaSemana}
                disabled={creandoSemana || !nuevaSemanaFecha}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white py-1.5 rounded-xl font-bold cursor-pointer text-xs"
              >
                {creandoSemana ? "Creando…" : "Crear semana"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Modal: confirmación */}
      {confirmDialog && (
        <ModalOverlay onClose={() => setConfirmDialog(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 p-3 space-y-2">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1.5">
              <h3 className="text-[13px] font-semibold text-slate-900">
                {confirmDialog.titulo}
              </h3>
              <button
                onClick={() => setConfirmDialog(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-600">{confirmDialog.mensaje}</p>
            <div className="flex gap-1 pt-1.5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-1.5 rounded-xl font-semibold cursor-pointer text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmDialog.onConfirmar();
                  setConfirmDialog(null);
                }}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-1.5 rounded-xl font-bold cursor-pointer text-xs"
              >
                Sí, continuar
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// Coordinación no entra a Nóminas: se le manda al Panel Principal.
export default function NominasProtegida() {
  const nivel = useNivelAdmin();
  const router = useRouter();
  useEffect(() => {
    if (nivel === "Coordinador") router.replace("/");
  }, [nivel, router]);
  if (nivel === undefined || nivel === "Coordinador") return null;
  return <NominasAsistenciaPage />;
}
