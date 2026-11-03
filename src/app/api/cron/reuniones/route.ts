import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/api-auth";
import { esCronAutorizado, REUNION_ACTIVA } from "../../../../lib/cronAuth";
import { enviarPush, primeraVez, revisoresDe } from "../../../../lib/push";

// Recordatorio de reuniones que empiezan en los próximos 30 minutos. Debe
// llamarse seguido (cada 10 min). Vercel Hobby solo permite crons diarios, así
// que este se dispara desde un cron externo (p. ej. cron-job.org) con
// "Authorization: Bearer <CRON_SECRET>". `push_enviados` evita repetirlo.
// Le llega a Gerencia/Coordinación del equipo de los participantes, y a los
// propios participantes si también usan la app.
//
// Como corre cada 10 min, también avisa a cada trabajador de lo suyo:
//  - tarea nueva asignada (a él o como colaborador)
//  - su entrega fue aprobada o le pidieron correcciones
// Las tareas se asignan y revisan desde varios lados (web, app), así que en
// vez de engancharse a cada uno se buscan los cambios recientes aquí.

const VENTANA_MIN = 30;

export async function GET(req: Request) {
  if (!esCronAutorizado(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const ahora = new Date();
  const limite = new Date(ahora.getTime() + VENTANA_MIN * 60 * 1000);
  const { data: filas } = await supabaseAdmin
    .from("reuniones")
    .select("titulo, fecha_inicio, empleado_id, creado_por, link, tarea_id")
    .in("estado", REUNION_ACTIVA)
    .gte("fecha_inicio", ahora.toISOString())
    .lte("fecha_inicio", limite.toISOString());

  // Una reunión con varios participantes son varias filas.
  // empleado_id vacío = reunión para todo el equipo ("Todos" en la web).
  const reuniones = new Map<string, { titulo: string; inicio: string; personas: Set<string>; todos: boolean; creador: string | null }>();
  (filas || []).forEach((r) => {
    const clave = `${r.titulo}|${r.fecha_inicio}`;
    const previa = reuniones.get(clave) || {
      titulo: r.titulo,
      inicio: r.fecha_inicio,
      personas: new Set<string>(),
      todos: false,
      creador: r.creado_por,
    };
    if (r.empleado_id) previa.personas.add(r.empleado_id);
    else previa.todos = true;
    reuniones.set(clave, previa);
  });

  // Reuniones de todo el equipo: a todos (cada quien solo si tiene la app).
  const { data: todosLosEmpleados } = await supabaseAdmin.from("empleados").select("id");

  let enviadas = 0;
  for (const [clave, r] of reuniones) {
    if (!(await primeraVez(`reunion-${clave}`))) continue;

    const destinatarios = new Set<string>(r.personas);
    if (r.creador) destinatarios.add(r.creador);
    if (r.todos) (todosLosEmpleados || []).forEach((m) => destinatarios.add(m.id));
    for (const p of r.personas) (await revisoresDe(p)).forEach((id) => destinatarios.add(id));

    const minutos = Math.max(1, Math.round((new Date(r.inicio).getTime() - ahora.getTime()) / 60000));
    await enviarPush(Array.from(destinatarios), {
      titulo: `Reunión en ${minutos} min`,
      cuerpo: r.titulo,
      url: "/movil/avisos",
      etiqueta: `reunion-${clave}`,
    });
    enviadas++;
  }

  const tareas = await avisarTareas(ahora);

  return NextResponse.json({ enviadas, tareas });
}

const VENTANA_TAREAS_MIN = 30;

async function avisarTareas(ahora: Date) {
  const desde = new Date(ahora.getTime() - VENTANA_TAREAS_MIN * 60 * 1000).toISOString();
  const [{ data: nuevas }, { data: decididas }] = await Promise.all([
    supabaseAdmin
      .from("tareas")
      .select("id, titulo, empleado_id, colaboradores_ids, fecha_limite")
      .gte("created_at", desde),
    supabaseAdmin
      .from("tareas")
      .select("id, titulo, empleado_id, revision_resultado, revision_comentario, revision_fecha")
      .gte("revision_fecha", desde)
      .not("revision_resultado", "is", null),
  ]);

  let enviados = 0;
  for (const t of nuevas || []) {
    if (!(await primeraVez(`tarea-nueva-${t.id}`))) continue;
    const entrega = t.fecha_limite ? ` · Entrega: ${fechaCorta(t.fecha_limite)}` : "";
    await enviarPush([t.empleado_id, ...(t.colaboradores_ids || [])], {
      titulo: "Nueva tarea asignada",
      cuerpo: `${t.titulo}${entrega}`,
      url: `/movil/tarea/${t.id}`,
      etiqueta: `tarea-nueva-${t.id}`,
    });
    enviados++;
  }

  for (const t of decididas || []) {
    if (!(await primeraVez(`decision-${t.id}-${t.revision_fecha}`))) continue;
    const aprobada = t.revision_resultado === "Aprobado";
    const comentario = t.revision_comentario ? ` — “${t.revision_comentario}”` : "";
    await enviarPush([t.empleado_id], {
      titulo: aprobada ? "Tu entrega fue aprobada" : "Te pidieron correcciones",
      cuerpo: `${t.titulo}${comentario}`,
      url: `/movil/tarea/${t.id}`,
      etiqueta: `decision-${t.id}`,
    });
    enviados++;
  }
  return enviados;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(valor: string) {
  const [, mm, dd] = valor.slice(0, 10).split("-");
  return `${Number(dd)} ${MESES[Number(mm) - 1] || ""}`;
}
