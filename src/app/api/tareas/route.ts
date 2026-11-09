import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/api-auth';
import { verificarTokenVigente } from '../../../lib/tokenVigente';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 1. OBTENER TAREAS (GET)
export async function GET(req: NextRequest) {
  // 🔒 Verificación de Token JWT
  const user = await verificarTokenVigente(req);
  if (!user) {
    return NextResponse.json({ error: 'No autorizado / Token inválido' }, { status: 401, headers: corsHeaders });
  }

  try {
    const { searchParams } = new URL(req.url);
    const requestedEmpId = searchParams.get('employeeId') || searchParams.get('empleadoId');

    let query = supabaseAdmin
      .from('tareas')
      .select('*, proyectos(nombre)');

    const isAdmin = user.rol.toLowerCase() === 'administrador' || user.rol.toLowerCase() === 'admin';

    // Si no es admin, solo puede consultar sus tareas o colaboraciones
    if (!isAdmin) {
      query = query.or(`empleado_id.eq.${user.id},colaboradores_ids.cs.{${user.id}}`);
    } else if (requestedEmpId) {
      query = query.or(`empleado_id.eq.${requestedEmpId},colaboradores_ids.cs.{${requestedEmpId}}`);
    }

    const { data: tareas, error } = await query;
    if (error) throw error;

    // Subtareas (checklist) de cada tarea. Si la tabla aún no existe, sin ellas.
    const subtareasPorTarea: Record<string, any[]> = {};
    if (tareas && tareas.length > 0) {
      const { data: subs } = await supabaseAdmin
        .from('tarea_subtareas')
        .select('id, tarea_id, titulo, completada, orden')
        .in('tarea_id', tareas.map((t: any) => t.id))
        .order('orden')
        .order('id');
      (subs || []).forEach((s: any) => {
        (subtareasPorTarea[String(s.tarea_id)] ||= []).push(s);
      });
    }
    (tareas || []).forEach((t: any) => {
      t.subtareas = subtareasPorTarea[String(t.id)] || [];
    });

    // Puntos de recompensa actuales — se otorgan por trigger en Supabase al
    // completar tareas, así que se refrescan aquí en cada carga (la extensión ya
    // llama a este endpoint al cambiar de pestaña, no hace falta un endpoint aparte).
    const puntosEmpId = !isAdmin ? user.id : (requestedEmpId || user.id);
    const { data: empPuntos } = await supabaseAdmin
      .from('empleados')
      .select('puntos_recompensa')
      .eq('id', puntosEmpId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      tareas: tareas || [],
      puntosRecompensa: (empPuntos as any)?.puntos_recompensa || 0,
    }, { status: 200, headers: corsHeaders });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al consultar tareas' }, { status: 500, headers: corsHeaders });
  }
}

// 2. ACTUALIZAR ESTADO DE TAREA (PATCH)
export async function PATCH(req: NextRequest) {
  // 🔒 Verificación de Token JWT
  const user = await verificarTokenVigente(req);
  if (!user) {
    return NextResponse.json({ error: 'No autorizado / Token inválido' }, { status: 401, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { taskId, estado, porcentajeAvance } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'ID de la tarea requerido' }, { status: 400, headers: corsHeaders });
    }

    // A) Consultar la tarea para verificar ownership
    const { data: tarea, error: fetchErr } = await supabaseAdmin
      .from('tareas')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();

    if (fetchErr || !tarea) {
      return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404, headers: corsHeaders });
    }

    // B) Validar permisos (Ownership Check)
    const isAdmin = user.rol.toLowerCase() === 'administrador' || user.rol.toLowerCase() === 'admin';
    const isOwner = tarea.empleado_id === user.id;
    const isCollaborator = Array.isArray(tarea.colaboradores_ids) && tarea.colaboradores_ids.includes(user.id);

    if (!isAdmin && !isOwner && !isCollaborator) {
      return NextResponse.json({ error: 'No tienes permisos para modificar esta tarea' }, { status: 403, headers: corsHeaders });
    }

    // C) Construir payload de actualización.
    // 🛡️ El ESTADO solo lo cambia un administrador: un trabajador podía
    // marcar su tarea como "Completada" sin pasar por revisión (y ganar los
    // puntos que da el trigger). Él solo reporta su avance, de 0 a 100.
    if (estado !== undefined && !isAdmin) {
      return NextResponse.json({ error: 'Solo un administrador puede cambiar el estado de la tarea' }, { status: 403, headers: corsHeaders });
    }
    const updatePayload: any = {};
    if (estado !== undefined) updatePayload.estado = estado;
    if (porcentajeAvance !== undefined) {
      const avance = Number(porcentajeAvance);
      if (!Number.isFinite(avance) || avance < 0 || avance > 100) {
        return NextResponse.json({ error: 'El avance debe estar entre 0 y 100' }, { status: 400, headers: corsHeaders });
      }
      updatePayload.porcentaje_avance = Math.round(avance);
    }
    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400, headers: corsHeaders });
    }

    const { data: updatedTask, error: updateErr } = await supabaseAdmin
      .from('tareas')
      .update(updatePayload)
      .eq('id', taskId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, tarea: updatedTask }, { status: 200, headers: corsHeaders });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al actualizar tarea' }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}