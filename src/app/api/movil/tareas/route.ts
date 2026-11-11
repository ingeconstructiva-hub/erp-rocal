import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/api-auth";
import {
  corsMovil,
  opcionesMovil,
  soloMandos,
  verificarMovil,
} from "../../../../lib/movilAuth";

// Asignar una tarea desde la PWA. Replica handleAssignTask del Panel Principal
// (src/app/page.tsx): inserta la tarea y marca al responsable como ocupado.
// Solo se puede asignar a personas (y colaboradores) dentro del alcance.

const PRIORIDADES = ["Baja", "Media", "Alta", "Urgente"];

const responder = (cuerpo: object, status: number) =>
  NextResponse.json(cuerpo, { status, headers: corsMovil });

export async function POST(req: Request) {
  const auth = await verificarMovil(req);
  if (!auth.ok) return auth.respuesta;
  const { usuario, equipoIds } = auth;
  const sinPermiso = soloMandos(usuario);
  if (sinPermiso) return sinPermiso;

  const b = await req.json().catch(() => ({}));
  const empleadoId = String(b?.empleadoId || "");
  const titulo = String(b?.titulo || "").trim();
  const descripcion = String(b?.descripcion || "").trim() || null;
  const proyectoId = String(b?.proyectoId || "");
  const prioridad = PRIORIDADES.includes(b?.prioridad) ? b.prioridad : "Media";
  const fechaLimite = /^\d{4}-\d{2}-\d{2}$/.test(b?.fechaLimite || "")
    ? b.fechaLimite
    : null;
  const colaboradores: string[] = Array.isArray(b?.colaboradoresIds)
    ? b.colaboradoresIds.map(String).filter((id: string) => id !== empleadoId)
    : [];
  const dependeDe = Number.isInteger(Number(b?.dependeDeId)) && b?.dependeDeId
    ? Number(b.dependeDeId)
    : null;

  if (!empleadoId) return responder({ error: "Elige a quién asignarla." }, 400);
  if (!titulo) return responder({ error: "Escribe el título de la tarea." }, 400);
  if (!proyectoId) return responder({ error: "Elige el proyecto." }, 400);

  const enAlcance = (id: string) => !equipoIds || equipoIds.includes(id);
  if (!enAlcance(empleadoId) || !colaboradores.every(enAlcance)) {
    return responder(
      { error: "Solo puedes asignar tareas a personas de tu equipo." },
      403,
    );
  }

  try {
    if (dependeDe) {
      const { data: previa } = await supabaseAdmin
        .from("tareas")
        .select("id, empleado_id")
        .eq("id", dependeDe)
        .maybeSingle();
      if (!previa || !enAlcance(previa.empleado_id)) {
        return responder({ error: "La tarea de la que depende no existe." }, 400);
      }
    }

    const { data: nueva, error } = await supabaseAdmin
      .from("tareas")
      .insert({
        empleado_id: empleadoId,
        proyecto_id: proyectoId,
        titulo,
        descripcion,
        estado: dependeDe ? "Pendiente" : "En Proceso",
        prioridad,
        asignada_por: usuario.id,
        fecha_asignada: new Date().toISOString().split("T")[0],
        fecha_limite: fechaLimite,
        depende_de_tarea_id: dependeDe,
        colaboradores_ids: colaboradores.length > 0 ? colaboradores : null,
      })
      .select("id")
      .single();
    if (error) throw error;

    await supabaseAdmin
      .from("empleados")
      .update({ disponibilidad: false })
      .eq("id", empleadoId);

    // La fecha límite ya no se manda al calendario (solo reuniones y revisiones).
    return responder({ success: true, id: nueva.id, avisoCalendario: null }, 200);
  } catch (err: any) {
    return responder(
      { error: err.message || "No se pudo asignar la tarea." },
      500,
    );
  }
}

export const OPTIONS = opcionesMovil;
