import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/api-auth";
import { verificarTokenVigente } from "../../../lib/tokenVigente";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Palomear / despalomear una subtarea. Lo puede hacer el responsable de la
// tarea, un colaborador o un administrador. El avance de la tarea se recalcula
// aquí (hechas / total) para que el trabajador no tenga que moverlo a mano.
export async function PATCH(req: NextRequest) {
  const user = await verificarTokenVigente(req);
  if (!user) {
    return NextResponse.json(
      { error: "No autorizado / Token inválido" },
      { status: 401, headers: corsHeaders },
    );
  }

  try {
    const { id, completada } = await req.json();
    if (id === undefined || typeof completada !== "boolean") {
      return NextResponse.json(
        { error: "Datos incompletos" },
        { status: 400, headers: corsHeaders },
      );
    }

    const { data: sub } = await supabaseAdmin
      .from("tarea_subtareas")
      .select("id, tarea_id")
      .eq("id", id)
      .maybeSingle();
    if (!sub) {
      return NextResponse.json(
        { error: "Subtarea no encontrada" },
        { status: 404, headers: corsHeaders },
      );
    }

    const { data: tarea } = await supabaseAdmin
      .from("tareas")
      .select("id, empleado_id, colaboradores_ids, estado")
      .eq("id", sub.tarea_id)
      .maybeSingle();
    if (!tarea) {
      return NextResponse.json(
        { error: "Tarea no encontrada" },
        { status: 404, headers: corsHeaders },
      );
    }

    const isAdmin = ["admin", "administrador"].includes(
      (user.rol || "").toLowerCase().trim(),
    );
    const esSuya =
      tarea.empleado_id === user.id ||
      (tarea.colaboradores_ids || []).includes(user.id);
    if (!isAdmin && !esSuya) {
      return NextResponse.json(
        { error: "No tienes permisos para modificar esta tarea" },
        { status: 403, headers: corsHeaders },
      );
    }
    // Con la tarea en revisión o terminada ya no se mueve nada.
    const estado = (tarea.estado || "").toLowerCase();
    if (!isAdmin && (estado.includes("revisi") || estado.includes("completa"))) {
      return NextResponse.json(
        { error: "La tarea ya fue enviada a revisión" },
        { status: 409, headers: corsHeaders },
      );
    }

    const { error } = await supabaseAdmin
      .from("tarea_subtareas")
      .update({ completada })
      .eq("id", id);
    if (error) throw error;

    const { data: todas } = await supabaseAdmin
      .from("tarea_subtareas")
      .select("completada")
      .eq("tarea_id", tarea.id);
    const total = (todas || []).length;
    const hechas = (todas || []).filter((s: any) => s.completada).length;
    const avance = total ? Math.round((hechas / total) * 100) : 0;
    await supabaseAdmin
      .from("tareas")
      .update({ porcentaje_avance: avance })
      .eq("id", tarea.id);

    return NextResponse.json(
      { success: true, avance },
      { status: 200, headers: corsHeaders },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al actualizar la subtarea" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
