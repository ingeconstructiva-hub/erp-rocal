'use client';

import { useNivelAdmin } from '../lib/useNivelAdmin';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { Icon, IconName } from './icons';
import CampanaNotificaciones from './CampanaNotificaciones';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/admin/revisiones', label: 'Calendario de Actividades', icon: 'calendar' },
  { href: '/', label: 'Panel Principal', icon: 'bar-chart' },
  { href: '/admin/historial', label: 'Historial de Tareas', icon: 'scroll' },
  { href: '/admin/document_int', label: 'Documentación Interna', icon: 'folder' },
  { href: '/admin/nominas_y_asistencia', label: 'Nóminas y Asistencia', icon: 'banknote' },
  { href: '/admin/ruta-critica', label: 'Ruta Crítica', icon: 'target' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ top: number; height: number; ready: boolean }>({ top: 0, height: 0, ready: false });

  // Ruta activa: coincidencia exacta para "/", por prefijo para el resto
  // (así "/admin/ruta-critica/tecnico" mantiene marcado "Ruta Crítica").
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
  // Coordinación no ve Nóminas (se oculta también mientras carga el nivel).
  const nivel = useNivelAdmin();
  const items = NAV.filter(n => !n.href.includes('nominas') || (nivel !== undefined && nivel !== 'Coordinador'));
  const activeIndex = items.findIndex(n => isActive(n.href));

  // Desliza el indicador azul hasta la opción activa cuando cambia la ruta.
  useEffect(() => {
    if (activeIndex < 0) { setPill(p => ({ ...p, ready: false })); return; }
    const el = itemRefs.current[activeIndex];
    if (!el) return;
    setPill({ top: el.offsetTop, height: el.offsetHeight, ready: true });
  }, [activeIndex, pathname]);

  // Reposiciona si cambia el tamaño de la ventana.
  useEffect(() => {
    const onResize = () => {
      const el = itemRefs.current[activeIndex];
      if (el) setPill(p => ({ ...p, top: el.offsetTop, height: el.offsetHeight }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeIndex]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  };

  return (
    <aside className="w-60 bg-slate-900 text-slate-300 flex flex-col shrink-0 hidden md:flex h-full select-none border-r border-slate-800 relative z-40">
      {/* Marca */}
      <div className="px-4 h-14 border-b border-slate-800 flex items-center gap-2.5 shrink-0">
        <span className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
          <Icon name="briefcase" size={15} />
        </span>
        <span className="font-semibold text-white text-[13px] tracking-tight flex-1">ERP Admin</span>
        <CampanaNotificaciones />
      </div>

      {/* Navegación */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Gestión</p>

        <div ref={listRef} className="relative">
          {/* Indicador deslizante */}
          <span
            aria-hidden
            className="absolute left-0 right-0 rounded-lg bg-blue-600 transition-[top,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ top: pill.top, height: pill.height, opacity: pill.ready ? 1 : 0 }}
          />

          <div className="relative space-y-0.5">
            {items.map(({ href, label, icon }, i) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  className={`relative flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium transition-colors duration-200 ${
                    active ? 'text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                  }`}
                >
                  <Icon
                    name={icon}
                    size={16}
                    className={`shrink-0 transition-transform duration-300 ease-out ${active ? 'scale-110' : ''}`}
                  />
                  <span className={`truncate transition-transform duration-300 ease-out ${active ? 'translate-x-0.5' : ''}`}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Pie */}
      <div className="px-2 py-3 border-t border-slate-800 shrink-0">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-300 transition-colors cursor-pointer"
        >
          <Icon name="log-out" size={16} className="shrink-0" />
          <span>Cerrar sesión</span>
        </button>
        <p className="mt-2 pt-2 border-t border-slate-800/60 text-[10px] text-slate-600 text-center">v1.0.0</p>
      </div>
    </aside>
  );
}
