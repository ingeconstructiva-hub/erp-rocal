import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/api-auth";
import {
  corsMovil,
  opcionesMovil,
  soloMandos,
  verificarMovil,
} from "../../../../lib/movilAuth";
import { esArquitecto, hoyMx } from "../../../../lib/enObra";

// Quién está en obra hoy (dentro del alcance del usuario) y cambio de estado de
// un arquitecto. Ver quién está en obra lo puede cualquiera (dentro de su alcance); cambiar el
// estado, solo Gerencia y Coordinación.
//  GET  → { enObra: [ids] }
//  POST { empleadoId, enObra } → marca o quita el estado "en obra" de hoy.

export async function GET(req: Request) {
  const auth = await verificarMovil(req);
  if (!auth.ok) return auth.respuesta;
  const { equipoIds } = auth;

  let q = supabaseAdmin
    .from("empleados")
    .select("id")
    .eq("en_obra_fecha", hoyMx());
  if (equipoIds) q = q.in("id", equipoIds);
  const { data, error } = await q;
  // Sin la columna todavía (falta correr el SQL): nadie está en obra.
  if (error) return NextResponse.json({ enObra: [] }, { headers: corsMovil });
  return NextResponse.json(
    { enObra: (data || []).map((e) => e.id) },
    { headers: corsMovil },
  );
}

export async function POST(req: Request) {
  const auth = await verificarMovil(req);
  if (!auth.ok) return auth.respuesta;
  const { usuario, equipoIds } = auth;
  const sinPermiso = soloMandos(usuario);
  if (sinPermiso) return sinPermiso;

  const b = await req.json().catch(() => ({}));
  const empleadoId = String(b?.empleadoId || "");
  if (!empleadoId) {
    return NextResponse.json(
      { error: "Falta la persona." },
      { status: 400, headers: corsMovil },
    );
  }
  if (equipoIds && !equipoIds.includes(empleadoId)) {
    return NextResponse.json(
      { error: "No tienes acceso a esa persona." },
      { status: 403, headers: corsMovil },
    );
  }

  const { data: emp } = await supabaseAdmin
    .from("empleados")
    .select("especialidad")
    .eq("id", empleadoId)
    .maybeSingle();
  if (!emp || !esArquitecto(emp.especialidad)) {
    return NextResponse.json(
      { error: "Solo los arquitectos tienen estado de obra." },
      { status: 400, headers: corsMovil },
    );
  }

  const { error } = await supabaseAdmin
    .from("empleados")
    .update({ en_obra_fecha: b?.enObra ? hoyMx() : null })
    .eq("id", empleadoId);
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: corsMovil },
    );
  }
  return NextResponse.json({ success: true }, { headers: corsMovil });
}

export const OPTIONS = opcionesMovil;
