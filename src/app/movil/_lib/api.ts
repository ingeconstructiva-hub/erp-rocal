import { cerrarSesion, leerSesion } from "../../../lib/movilSesion";

// La sesión venció o el usuario ya no tiene acceso: la página debe mandar al login.
export class SesionExpirada extends Error {}

// fetch a /api/movil/* con el JWT de la sesión. Un 401 cierra la sesión local
// para que el usuario vuelva a entrar (el token dura 8 h). Un 403 es "no tienes
// permiso para esto" y se muestra como error, sin cerrar la sesión.
export async function apiMovil<T>(ruta: string, init?: RequestInit): Promise<T> {
  const sesion = leerSesion();
  if (!sesion) throw new SesionExpirada();

  const res = await fetch(ruta, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
      Authorization: `Bearer ${sesion.token}`,
    },
  });

  if (res.status === 401) {
    cerrarSesion();
    throw new SesionExpirada();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "No se pudo conectar con el servidor.");
  return data as T;
}
