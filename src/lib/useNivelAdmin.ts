"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

// Nivel jerárquico (Gerencia / Coordinador / …) de quien tiene la sesión web.
// Coordinación ve el panel como Gerencia, salvo Nóminas y lo que sea de pagos.

let enCache: Promise<string | null> | null = null;

export function nivelAdminActual(): Promise<string | null> {
  if (!enCache) {
    enCache = (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("empleados")
        .select("nivel")
        .eq("user_id", user.id)
        .maybeSingle();
      return (data as any)?.nivel || null;
    })().catch(() => {
      enCache = null;
      return null;
    });
  }
  return enCache;
}

// undefined = todavía cargando.
export function useNivelAdmin(): string | null | undefined {
  const [nivel, setNivel] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    nivelAdminActual().then((n) => vivo && setNivel(n));
    return () => {
      vivo = false;
    };
  }, []);
  return nivel;
}
