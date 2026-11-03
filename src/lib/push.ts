import webpush from "web-push";
import { supabaseAdmin } from "./api-auth";

// Notificaciones push de la PWA móvil (las recibe quien tenga la app y las
// haya activado en su perfil). Las suscripciones viven en
// `push_suscripciones` (una por teléfono/navegador) y `push_enviados` evita
// mandar dos veces el mismo recordatorio cuando lo dispara un cron.

const PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const PRIVADA = process.env.VAPID_PRIVATE_KEY || "";
const SUJETO = process.env.VAPID_SUBJECT || "mailto:soporte@rocal.mx";

const configurado = Boolean(PUBLICA && PRIVADA);
if (configurado) webpush.setVapidDetails(SUJETO, PUBLICA, PRIVADA);

export interface AvisoPush {
  titulo: string;
  cuerpo: string;
  url: string; // ruta dentro de /movil que abre al tocarla
  etiqueta?: string; // misma etiqueta = reemplaza la notificación anterior
}

// Gerencia + coordinadores que comparten al menos un área con el empleado
// (sin incluirlo a él). Es el mismo alcance con el que la app muestra datos.
export async function revisoresDe(empleadoId: string): Promise<string[]> {
  const { data: emp } = await supabaseAdmin
    .from("empleados")
    .select("area")
    .eq("id", empleadoId)
    .maybeSingle();

  const [gerencia, coordinadores] = await Promise.all([
    supabaseAdmin.from("empleados").select("id").eq("nivel", "Gerencia"),
    emp?.area?.length
      ? supabaseAdmin
          .from("empleados")
          .select("id")
          .eq("nivel", "Coordinador")
          .overlaps("area", emp.area)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  return Array.from(
    new Set([...(gerencia.data || []), ...(coordinadores.data || [])].map((e) => e.id)),
  ).filter((id) => id !== empleadoId);
}

// Envía a todos los teléfonos suscritos de esas personas. Las suscripciones
// que el servicio de push da por muertas (404/410) se borran. Nunca lanza:
// una notificación fallida no debe romper la acción que la originó.
export async function enviarPush(empleadoIds: string[], aviso: AvisoPush) {
  if (!configurado || empleadoIds.length === 0) return;
  try {
    const { data: subs } = await supabaseAdmin
      .from("push_suscripciones")
      .select("id, endpoint, p256dh, auth")
      .in("empleado_id", empleadoIds);

    const carga = JSON.stringify(aviso);
    const muertas: string[] = [];
    await Promise.all(
      (subs || []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            carga,
            { TTL: 60 * 60 * 12 },
          );
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) muertas.push(s.id);
          else console.error("Push no entregado:", err?.statusCode, err?.body);
        }
      }),
    );
    if (muertas.length > 0) {
      await supabaseAdmin.from("push_suscripciones").delete().in("id", muertas);
    }
  } catch (err) {
    console.error("Error enviando notificaciones push:", err);
  }
}

// true si es la primera vez que se registra esa clave (y la registra). Sirve
// para que un cron que corre seguido no repita el mismo recordatorio.
export async function primeraVez(clave: string) {
  const { error } = await supabaseAdmin.from("push_enviados").insert({ clave });
  return !error; // clave duplicada → ya se había enviado
}
