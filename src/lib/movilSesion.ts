// Sesión de la PWA móvil — un JWT propio (el mismo que ya usa la extensión de
// Chrome vía /api/auth/login), guardado en localStorage. No usa las cookies de
// Supabase Auth del dashboard web. Entra cualquier integrante; Gerencia y
// Coordinadores además supervisan a su equipo (`esMandoSesion`). Lo que puede
// ver y hacer cada quien lo decide el servidor (lib/movilAuth.ts).

export interface MovilEmpleado {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  nivel?: string;
  horas_acumuladas: number;
  horas_totales_objetivo: number | null;
  puntos_recompensa: number;
}

const CLAVE = "movil_sesion";

export function guardarSesion(token: string, employee: MovilEmpleado) {
  localStorage.setItem(CLAVE, JSON.stringify({ token, employee }));
}

export function leerSesion(): {
  token: string;
  employee: MovilEmpleado;
} | null {
  try {
    const raw = localStorage.getItem(CLAVE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Sesiones muy viejas no traen `nivel` → se descartan y piden volver a entrar.
export function sesionPermitida(employee: MovilEmpleado) {
  return Boolean(employee.nivel);
}

// Gerencia/Coordinación ven a su equipo, asignan y revisan. El resto usa la
// app solo para consultar lo suyo y recibir recordatorios.
export function esMandoSesion() {
  const nivel = leerSesion()?.employee.nivel;
  return nivel === "Gerencia" || nivel === "Coordinador";
}

export function cerrarSesion() {
  localStorage.removeItem(CLAVE);
}
