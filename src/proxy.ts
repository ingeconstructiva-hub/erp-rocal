import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sinPersistencia } from "./lib/sessionCookies";
import { empleadoDeSesion, esAdminWeb } from "./lib/adminWeb";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ✅ Deja pasar /api/ (JWT propio), /movil (PWA, su propia sesión por JWT en
  // localStorage) y el manifest de la PWA (el navegador lo pide SIN sesión
  // para poder instalarla — si el proxy lo manda a /login, nunca se instala).
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/movil") ||
    // Panel del trabajador: su propia sesión por JWT (localStorage), como /movil.
    pathname.startsWith("/trabajador") ||
    pathname === "/manifest.webmanifest"
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              value ? sinPersistencia(options) : options,
            ),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = pathname === "/login";

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user) {
    // 🛡️ Una sesión válida de Supabase no basta: tiene que ser de un empleado
    // con rol de Administrador (por user_id). Si alguien se crea una cuenta
    // por fuera (registro público) o no es admin, se le borra la sesión.
    if (!esAdminWeb(await empleadoDeSesion(user.id))) {
      const res = isLoginPage
        ? NextResponse.next({ request })
        : NextResponse.redirect(new URL("/login", request.url));
      request.cookies
        .getAll()
        .filter((c) => c.name.startsWith("sb-"))
        .forEach((c) => res.cookies.delete(c.name));
      return res;
    }
    if (isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
