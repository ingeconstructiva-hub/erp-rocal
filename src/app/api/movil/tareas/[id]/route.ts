import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/api-auth";
import { DOC_BUCKET, rutaEnBucket } from "../../../../../lib/rutaBucket";
import {
  corsMovil,
  opcionesMovil,
  verificarMovil,
} from "../../../../../lib/movilAuth";

// Seguimiento de una tarea en la PWA: datos de la tarea + el mismo hilo que el
// Historial de /admin/revisiones (envíos a revisión, reuniones, decisiones y
// minutas). Los archivos del bucket privado se devuelven ya firmados (1 h)
// porque la PWA no tiene sesión de Supabase para firmarlos.

async function firmar(guardado: string | null | undefined) {
  const ruta = rutaEnBucket(guardado);
  if (!ruta) return null;
  const { data } = await supabaseAdmin.storage
    .from(DOC_BUCKET)
    .createSignedUrl(ruta, 3600);
  return data?.signedUrl ?? null;
}

const noEncontrada = () =>
  NextResponse.json(
    { error: "No encontramos esa tarea." },
    { status: 404, headers: corsMovil },
  );

export async function GET(req: Request, ctx: RouteContext<"/api/movil/tareas/[id]">) {
  const auth = await verificarMovil(req);
  if (!auth.ok) return auth.respuesta;
  const { usuario, equipoIds } = auth;

  const tareaId = Number((await ctx.params).id);
  if (!Number.isInteger(tareaId)) return noEncontrada();

  try {
    const { data: tarea, error } = await supabaseAdmin
      .from("tareas")
      .select(
        "id, titulo, descripcion, estado, prioridad, fecha_asignada, fecha_limite, porcentaje_avance, empleado_id, proyecto_id, asignada_por, colaboradores_ids, revision_resultado, revision_comentario, revision_por, revision_fecha",
      )
      .eq("id", tareaId)
      .maybeSingle();
    if (error) throw error;
    // Fuera de su alcance se responde igual que si no existiera.
    const colabora = (tarea?.colaboradores_ids || []).includes(usuario.id);
    if (!tarea || (equipoIds && !equipoIds.includes(tarea.empleado_id) && !colabora)) {
      return noEncontrada();
    }

    const idsPersonas = Array.from(
      new Set(
        [tarea.empleado_id, tarea.asignada_por, ...(tarea.colaboradores_ids || [])].filter(
          Boolean,
        ),
      ),
    );

    const [personas, proyecto, revisiones, reuniones, decisiones, minutas] =
      await Promise.all([
        supabaseAdmin
          .from("empleados")
          .select("id, nombre, color, avatar_url, rol, especialidad, celular")
          .in("id", idsPersonas),
        tarea.proyecto_id
          ? supabaseAdmin
              .from("proyectos")
              .select("nombre")
              .eq("id", tarea.proyecto_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabaseAdmin
          .from("revisiones")
          .select("id, fecha_solicitud, comentarios, evidencia_url, evidencia_nombre")
          .eq("tarea_id", tareaId),
        supabaseAdmin
          .from("reuniones")
          .select("id, titulo, descripcion, fecha_inicio, estado, link, lugar")
          .eq("tarea_id", tareaId),
        supabaseAdmin
          .from("notificaciones")
          .select("id, estado, created_at, comentario, titulo_tarea")
          .eq("tarea_id", tareaId)
          .in("estado", ["Aprobado", "Rechazado"]),
        supabaseAdmin
          .from("tarea_minutas")
          .select("id, created_at, contenido, autor_nombre, reunion_id, adjunto_url, adjunto_nombre")
          .eq("tarea_id", tareaId),
      ]);

    const porId: Record<string, any> = {};
    (personas.data || []).forEach((p) => (porId[p.id] = p));
    const tituloReunion: Record<string, string> = {};
    (reuniones.data || []).forEach((r) => (tituloReunion[r.id] = r.titulo));

    // Mismo armado que threadEvents en /admin/revisiones, más reciente primero.
    const hilo = [
      ...(await Promise.all(
        (revisiones.data || []).map(async (r) => ({
          clave: `rev-${r.id}`,
          tipo: "revision",
          // `revisiones` no tiene created_at: su fecha es fecha_solicitud.
          fecha: r.fecha_solicitud,
          titulo: "Enviada a revisión",
          cuerpo: r.comentarios || "",
          archivo: r.evidencia_url
            ? { nombre: r.evidencia_nombre || "Evidencia", url: await firmar(r.evidencia_url) }
            : null,
        })),
      )),
      ...(reuniones.data || []).map((m) => ({
        clave: `reu-${m.id}`,
        tipo: "reunion",
        fecha: m.fecha_inicio,
        titulo: m.titulo || "Reunión",
        cuerpo: m.descripcion || "",
        detalle:
          m.estado === "Fecha Límite"
            ? "Fecha límite (automática)"
            : [m.link ? "Virtual" : "Presencial", m.lugar, m.estado].filter(Boolean).join(" · "),
        enlace: m.link || null,
      })),
      ...(decisiones.data || []).map((n) => ({
        clave: `dec-${n.id}`,
        tipo: "decision",
        fecha: n.created_at,
        titulo: n.estado === "Aprobado" ? "Tarea aprobada" : "Se pidieron correcciones",
        aprobada: n.estado === "Aprobado",
        cuerpo: n.comentario || "",
      })),
      ...(await Promise.all(
        (minutas.data || []).map(async (mn) => ({
          clave: `min-${mn.id}`,
          tipo: "minuta",
          fecha: mn.created_at,
          titulo: mn.autor_nombre || "Minuta",
          detalle: mn.reunion_id ? tituloReunion[mn.reunion_id] || null : null,
          cuerpo: mn.contenido || "",
          archivo: mn.adjunto_url
            ? { nombre: mn.adjunto_nombre || "Adjunto", url: await firmar(mn.adjunto_url) }
            : null,
        })),
      )),
    ].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    return NextResponse.json(
      {
        tarea: {
          ...tarea,
          proyecto: (proyecto.data as any)?.nombre || null,
          responsable: porId[tarea.empleado_id] || null,
          asignadaPor: tarea.asignada_por ? porId[tarea.asignada_por]?.nombre || null : null,
          colaboradores: (tarea.colaboradores_ids || [])
            .map((id: string) => porId[id])
            .filter(Boolean),
        },
        hilo,
      },
      { status: 200, headers: corsMovil },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "No se pudo cargar la tarea" },
      { status: 500, headers: corsMovil },
    );
  }
}

export const OPTIONS = opcionesMovil;
