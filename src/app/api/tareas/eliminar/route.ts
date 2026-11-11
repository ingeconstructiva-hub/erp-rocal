import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { verificarTokenVigente } from "../../../../lib/tokenVigente";
import { empleadoDeSesion, esAdminWeb } from "../../../../lib/adminWeb";
import { DOC_BUCKET, rutaEnBucket } from "../../../../lib/rutaBucket";

// Borra una tarea por completo (por si se asignó a quien no era): sus subtareas,
// revisiones, notificaciones, minutas, eventos del calendario y archivos de
// evidencia. Lo que dependía de ella queda libre. Solo administradores.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function esAdmin(request: NextRequest): Promise<boolean> {
  const jwtCaller = await verificarTokenVigente(request);
  const rolJwt = jwtCaller?.rol?.toLowerCase();
  if (rolJwt === "administrador" || rolJwt === "admin") return true;

  const supabaseSsr = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    },
  );
  const {
    data: { user },
  } = await supabaseSsr.auth.getUser();
  if (!user) return false;
  return esAdminWeb(await empleadoDeSesion(user.id));
}

export async function POST(request: NextRequest) {
  try {
    if (!(await esAdmin(request))) {
      return NextResponse.json(
        { error: "Acceso denegado: se requieren permisos de Administrador" },
        { status: 403 },
      );
    }

    const { tareaId } = await request.json();
    const id = Number(tareaId);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Falta la tarea" }, { status: 400 });
    }

    const { data: tarea } = await supabaseAdmin
      .from("tareas")
      .select("id, empleado_id")
      .eq("id", id)
      .maybeSingle();
    if (!tarea) {
      return NextResponse.json(
        { error: "La tarea no existe" },
        { status: 404 },
      );
    }

    // Archivos a borrar del Storage (se juntan antes de borrar las filas).
    const rutas = new Set<string>();
    const consultas = await Promise.all([
      supabaseAdmin
        .from("revisiones")
        .select("evidencia_url")
        .eq("tarea_id", id),
      supabaseAdmin
        .from("notificaciones")
        .select("evidencia_url")
        .eq("tarea_id", id),
      supabaseAdmin
        .from("tarea_minutas")
        .select("adjunto_url")
        .eq("tarea_id", id),
    ]);
    for (const { data } of consultas) {
      for (const fila of (data || []) as any[]) {
        const ruta = rutaEnBucket(fila.evidencia_url ?? fila.adjunto_url);
        if (ruta && !/^https?:/i.test(ruta)) rutas.add(ruta);
      }
    }
    const { data: carpeta } = await supabaseAdmin.storage
      .from(DOC_BUCKET)
      .list(`evidencias/${id}`, { limit: 1000 });
    for (const f of carpeta || [])
      if (f.id) rutas.add(`evidencias/${id}/${f.name}`);

    // Lo que dependía de esta tarea queda libre (y deja de estar en espera).
    await supabaseAdmin
      .from("tareas")
      .update({ estado: "En Proceso", depende_de_tarea_id: null })
      .eq("depende_de_tarea_id", id)
      .eq("estado", "Pendiente");
    await supabaseAdmin
      .from("tareas")
      .update({ depende_de_tarea_id: null })
      .eq("depende_de_tarea_id", id);

    for (const tabla of [
      "tarea_subtareas",
      "tarea_minutas",
      "reuniones",
      "revisiones",
      "notificaciones",
    ]) {
      const { error } = await supabaseAdmin
        .from(tabla)
        .delete()
        .eq("tarea_id", id);
      if (error) {
        console.error(`Error limpiando ${tabla}:`, error.message);
        return NextResponse.json(
          { error: `No se pudo limpiar ${tabla}: ${error.message}` },
          { status: 500 },
        );
      }
    }

    const { error: delErr } = await supabaseAdmin
      .from("tareas")
      .delete()
      .eq("id", id);
    if (delErr) {
      return NextResponse.json(
        { error: `No se pudo eliminar la tarea: ${delErr.message}` },
        { status: 500 },
      );
    }

    if (rutas.size) {
      const { error } = await supabaseAdmin.storage
        .from(DOC_BUCKET)
        .remove(Array.from(rutas));
      if (error)
        console.error("No se pudieron borrar las evidencias:", error.message);
    }

    // Queda disponible si ya no le quedan tareas en curso.
    if (tarea.empleado_id) {
      const { data: pendientes } = await supabaseAdmin
        .from("tareas")
        .select("id")
        .eq("empleado_id", tarea.empleado_id)
        .in("estado", ["En Proceso", "En Revisión", "Postergada"]);
      if (!pendientes || pendientes.length === 0) {
        await supabaseAdmin
          .from("empleados")
          .update({ disponibilidad: true })
          .eq("id", tarea.empleado_id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Error eliminando tarea:", err);
    return NextResponse.json(
      { error: err.message || "Error del servidor" },
      { status: 500 },
    );
  }
}
