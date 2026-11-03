import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/api-auth";
import {
  corsMovil,
  opcionesMovil,
  soloMandos,
  verificarMovil,
} from "../../../../../../lib/movilAuth";

// Revisión remota desde la PWA: aprobar o pedir correcciones de una entrega.
// Replica Aprobar/Rechazar del Panel Principal (src/app/page.tsx,
// handleResolveNotification / handleConfirmExtendDeadline) para que la tarea
// quede igual se revise desde la web o desde el celular:
//  - Aprobado: tarea Completada (100%), cierra sus reuniones; comentario opcional.
//  - Rechazado: vuelve a "En Proceso" con nueva fecha límite; comentario obligatorio.
// En ambos casos se resuelven las notificaciones pendientes de esa tarea y el
// comentario queda en la tarea (lo lee la extensión) y en la notificación (hilo).

const responder = (cuerpo: object, status: number) =>
  NextResponse.json(cuerpo, { status, headers: corsMovil });

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/movil/tareas/[id]/revision">,
) {
  const auth = await verificarMovil(req);
  if (!auth.ok) return auth.respuesta;
  const { usuario, equipoIds } = auth;
  const sinPermiso = soloMandos(usuario);
  if (sinPermiso) return sinPermiso;

  const tareaId = Number((await ctx.params).id);
  const body = await req.json().catch(() => ({}));
  const decision = body?.decision;
  const comentario = String(body?.comentario || "").trim();
  const nuevaFecha = String(body?.nuevaFecha || "");

  if (decision !== "Aprobado" && decision !== "Rechazado") {
    return responder({ error: "Decisión no válida." }, 400);
  }
  if (decision === "Rechazado") {
    if (!comentario) {
      return responder({ error: "Escribe qué hay que corregir." }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha)) {
      return responder({ error: "Elige la nueva fecha límite." }, 400);
    }
  }

  try {
    const { data: tarea } = await supabaseAdmin
      .from("tareas")
      .select("id, estado, empleado_id")
      .eq("id", tareaId)
      .maybeSingle();
    if (!tarea || (equipoIds && !equipoIds.includes(tarea.empleado_id))) {
      return responder({ error: "No encontramos esa tarea." }, 404);
    }
    // Evita decidir dos veces (otro revisor, la web, o doble toque).
    if (!(tarea.estado || "").toLowerCase().includes("revisi")) {
      return responder(
        { error: "Esta entrega ya fue revisada o ya no está en revisión." },
        409,
      );
    }

    const ahora = new Date().toISOString();
    const resultado = {
      revision_resultado: decision,
      revision_comentario: comentario || null,
      revision_por: usuario.nombre,
      revision_fecha: ahora,
    };

    const { error: errTarea } = await supabaseAdmin
      .from("tareas")
      .update(
        decision === "Aprobado"
          ? {
              ...resultado,
              estado: "Completada",
              porcentaje_avance: 100,
              fecha_completado: ahora,
            }
          : { ...resultado, estado: "En Proceso", fecha_limite: nuevaFecha },
      )
      .eq("id", tareaId);
    if (errTarea) throw errTarea;

    await supabaseAdmin
      .from("notificaciones")
      .update({ estado: decision, comentario: comentario || null })
      .eq("tarea_id", tareaId)
      .eq("estado", "Pendiente");

    if (decision === "Aprobado") {
      await supabaseAdmin
        .from("reuniones")
        .update({ estado: "Completada" })
        .eq("tarea_id", tareaId)
        .neq("estado", "Completada");
    }

    return responder({ success: true }, 200);
  } catch (err: any) {
    return responder(
      { error: err.message || "No se pudo guardar la revisión." },
      500,
    );
  }
}

export const OPTIONS = opcionesMovil;
