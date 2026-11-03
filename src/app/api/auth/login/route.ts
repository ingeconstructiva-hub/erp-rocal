import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/api-auth";
import bcrypt from "bcryptjs";
import { generateToken } from "../../../../lib/auth";
import {
  getIp,
  estaBloqueado,
  registrarFallo as registrarFalloLogin,
  limpiarFallos,
  MENSAJE_BLOQUEO,
} from "../../../../lib/rateLimitLogin";
import { limpiarCredencial } from "../../../../lib/credenciales";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // La extensión envía { email, password }, este fallback acepta ambos
    // Sin espacios ni caracteres invisibles que se cuelan al copiar y pegar.
    const emailInput = limpiarCredencial(body.email || body.username);
    const passwordCruda = String(body.password ?? "");
    const passwordInput = limpiarCredencial(passwordCruda);

    if (!emailInput || !passwordInput) {
      return NextResponse.json(
        { error: "Correo/Usuario y contraseña requeridos" },
        { status: 400, headers: corsHeaders },
      );
    }

    const cleanEmail = emailInput.trim().toLowerCase();
    const ip = getIp(req);
    const registrarFallo = () => registrarFalloLogin(ip, cleanEmail);

    if (await estaBloqueado(ip, cleanEmail)) {
      return NextResponse.json(
        { error: MENSAJE_BLOQUEO },
        { status: 429, headers: corsHeaders },
      );
    }

    // 1. Buscar primero en la columna 'username' (donde se guarda el correo/usuario)
    let { data: empleado } = await supabaseAdmin
      .from("empleados")
      .select("*")
      .ilike("username", cleanEmail)
      .maybeSingle();

    // 2. Si no se encontró en 'username', intentar por la columna 'email' de forma segura
    if (!empleado) {
      try {
        const { data: empByEmail } = await supabaseAdmin
          .from("empleados")
          .select("*")
          .ilike("email", cleanEmail)
          .maybeSingle();

        if (empByEmail) {
          empleado = empByEmail;
        }
      } catch (e) {
        // Ignorar si la columna 'email' no existe en la base de datos
      }
    }

    if (!empleado) {
      await registrarFallo();
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401, headers: corsHeaders },
      );
    }

    // 3. Traer las credenciales desde la tabla aislada `empleados_auth`
    //    (la tabla `empleados` ya no guarda contraseñas).
    const { data: cred } = await supabaseAdmin
      .from("empleados_auth")
      .select("password_hash, password")
      .eq("empleado_id", empleado.id)
      .maybeSingle();

    let isPasswordValid = false;
    let needsPasswordMigration = false;

    if (cred?.password_hash) {
      isPasswordValid = await bcrypt.compare(passwordInput, cred.password_hash);
      // Compatibilidad: contraseñas guardadas antes de limpiar (p. ej. con un
      // espacio a propósito) se aceptan tal cual llegaron.
      if (!isPasswordValid && passwordCruda !== passwordInput) {
        isPasswordValid = await bcrypt.compare(passwordCruda, cred.password_hash);
      }
    } else if (cred?.password) {
      isPasswordValid = cred.password === passwordInput;
      if (isPasswordValid) {
        needsPasswordMigration = true;
      }
    }

    if (!isPasswordValid) {
      await registrarFallo();
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401, headers: corsHeaders },
      );
    }

    await limpiarFallos(cleanEmail);

    // 🔄 4. MIGRACIÓN AL VUELO: si autenticó por texto plano, hashea y borra el texto plano
    if (needsPasswordMigration) {
      const newHash = await bcrypt.hash(passwordInput, 10);
      await supabaseAdmin
        .from("empleados_auth")
        .upsert(
          { empleado_id: empleado.id, password_hash: newHash, password: null },
          { onConflict: "empleado_id" },
        );
    }

    // 🔑 5. Generar Token JWT firmado
    const token = generateToken({
      id: empleado.id,
      email: empleado.username || empleado.email || cleanEmail,
      rol: empleado.rol || "Practicante",
    });

    return NextResponse.json(
      {
        success: true,
        token,
        employee: {
          id: empleado.id,
          nombre: empleado.nombre,
          email: empleado.username || empleado.email || cleanEmail,
          rol: empleado.rol,
          nivel: empleado.nivel,
          horas_acumuladas: empleado.horas_acumuladas || 0,
          horas_totales_objetivo: empleado.horas_totales_objetivo,
          puntos_recompensa: empleado.puntos_recompensa || 0,
        },
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Error interno del servidor", details: err.message },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
