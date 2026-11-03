import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/api-auth";
import {
  corsMovil,
  opcionesMovil,
  verificarMovil,
} from "../../../../lib/movilAuth";

// Datos de las pantallas "Tareas" y "Equipo" de la PWA: las personas que el
// usuario puede ver (según su nivel/área) y sus tareas sin completar. Los
// proyectos se piden aparte en vez de con un embed de PostgREST sobre `tareas`.
export async function GET(req: Request) {
  const auth = await verificarMovil(req);
  if (!auth.ok) return auth.respuesta;
  const { usuario, equipoIds } = auth;

  try {
    let qEmpleados = supabaseAdmin
      .from("empleados")
      .select(
        "id, nombre, color, avatar_url, nivel, area, rol, especialidad, disponibilidad",
      )
      .order("nombre");
    if (equipoIds) qEmpleados = qEmpleados.in("id", equipoIds);

    let qTareas = supabaseAdmin
      .from("tareas")
      .select(
        "id, titulo, descripcion, estado, prioridad, fecha_limite, porcentaje_avance, empleado_id, proyecto_id, colaboradores_ids, revision_resultado",
      )
      .neq("estado", "Completada");
    // Un trabajador ve lo suyo: lo que tiene a cargo y donde es colaborador.
    if (!usuario.esMando) {
      qTareas = qTareas.or(
        `empleado_id.eq.${usuario.id},colaboradores_ids.cs.{${usuario.id}}`,
      );
    } else if (equipoIds) {
      qTareas = qTareas.in("empleado_id", equipoIds);
    }

    const [empleados, tareas, proyectos] = await Promise.all([
      qEmpleados,
      qTareas,
      supabaseAdmin.from("proyectos").select("id, nombre"),
    ]);
    if (empleados.error) throw empleados.error;
    if (tareas.error) throw tareas.error;

    const nombreProyecto: Record<string, string> = {};
    (proyectos.data || []).forEach((p) => {
      nombreProyecto[p.id] = p.nombre;
    });

    return NextResponse.json(
      {
        yo: usuario,
        empleados: empleados.data || [],
        proyectos: (proyectos.data || [])
          .map((p) => ({ id: p.id, nombre: p.nombre }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
        tareas: (tareas.data || []).map((t) => ({
          ...t,
          proyecto: t.proyecto_id ? nombreProyecto[t.proyecto_id] || null : null,
        })),
      },
      { status: 200, headers: corsMovil },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "No se pudo cargar el equipo" },
      { status: 500, headers: corsMovil },
    );
  }
}

export const OPTIONS = opcionesMovil;
