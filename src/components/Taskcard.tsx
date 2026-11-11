'use client';

import React, { useState } from 'react';
import { Icon } from './icons';

export interface TaskCardProps {
  id: string | number;
  title: string;
  projectName: string;
  description?: string;
  assignedByName?: string;
  assignedToName?: string;
  dueDate?: string;
  priority: 'Baja' | 'Media' | 'Alta' | 'Urgente';
  status: 'Pendiente' | 'En Proceso' | 'Postergada' | 'Completada';
  progressPercent: number;
  collaborators?: { id: string; name: string; avatar?: string }[];
  isCritical?: boolean;
  slackDays?: number;
  onRequestExtension?: () => void;
  subtareas?: { id: number | string; titulo: string; completada: boolean }[];
  onToggleSubtarea?: (id: number | string, completada: boolean) => void;
  onEdit?: () => void;
  onComplete?: () => void;
  onDelete?: () => void;
}

export default function TaskCard({
  title,
  projectName,
  description,
  assignedByName = 'Administrador',
  assignedToName,
  dueDate,
  priority,
  status,
  progressPercent,
  collaborators = [],
  isCritical,
  slackDays,
  onRequestExtension,
  subtareas = [],
  onToggleSubtarea,
  onEdit,
  onComplete,
  onDelete,
}: TaskCardProps) {
  const [abierta, setAbierta] = useState(false);

  const priorityColors = {
    Baja: 'bg-slate-100 text-slate-700 border-slate-200',
    Media: 'bg-blue-50 text-blue-700 border-blue-200',
    Alta: 'bg-amber-50 text-amber-800 border-amber-200',
    Urgente: 'bg-red-50 text-red-700 border-red-200',
  };

  const statusColors = {
    Pendiente: 'bg-slate-100 text-slate-700',
    'En Proceso': 'bg-blue-600 text-white',
    Postergada: 'bg-amber-500 text-white',
    Completada: 'bg-emerald-600 text-white',
  };

  const label = 'text-[10px] font-medium text-slate-400 uppercase tracking-wide block';

  return (
    <div
      className={`p-2.5 rounded-xl border bg-white transition-colors hover:border-slate-300 space-y-1.5 relative overflow-hidden ${
        isCritical ? 'border-rose-300 ring-1 ring-rose-500/20' : 'border-slate-200'
      }`}
    >
      {/* Listón superior si es Ruta Crítica */}
      {isCritical && (
        <div className="absolute top-0 right-0 bg-rose-600 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-bl-lg uppercase tracking-wide inline-flex items-center gap-1">
          <Icon name="zap" size={10} /> Ruta crítica
        </div>
      )}

      {/* Encabezado */}
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className={`w-full flex items-start justify-between gap-2 text-left cursor-pointer ${isCritical ? 'pt-4' : ''}`}
      >
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md uppercase tracking-wide">
            <Icon name="folder" size={10} /> {projectName}
          </span>
          <h4 className="font-semibold text-slate-900 text-[13px] mt-1 leading-snug">{title}</h4>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          {subtareas.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500" title="Subtareas hechas">
              <Icon name="check-circle" size={11} /> {subtareas.filter((s) => s.completada).length}/{subtareas.length}
            </span>
          )}
          {dueDate && (
            <span className="hidden sm:inline font-mono text-[10px] text-slate-500">{dueDate}</span>
          )}
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${statusColors[status]}`}>
            {status}
          </span>
          <Icon
            name="chevron-down"
            size={14}
            className={`text-slate-400 transition-transform ${abierta ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {abierta && (
        <div className="space-y-1.5">

      {/* Descripción */}
      {description && (
        <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-1.5 rounded-lg border border-slate-100">
          {description}
        </p>
      )}

      {/* Barra de progreso */}
      <div className="space-y-1">
        <div className="flex justify-between items-center text-[10px] font-medium text-slate-500">
          <span>Avance de actividad</span>
          <span className="font-mono text-slate-800 tabular-nums">{progressPercent}%</span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              status === 'Completada'
                ? 'bg-emerald-500'
                : status === 'Postergada'
                  ? 'bg-amber-500'
                  : 'bg-blue-600'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Subtareas: lo que ya se hizo y lo que falta */}
      {subtareas.length > 0 && (
        <div className="space-y-1">
          <span className={`${label} flex items-center gap-1`}>
            <Icon name="list" size={11} /> Subtareas ({subtareas.filter((s) => s.completada).length}/{subtareas.length})
          </span>
          <ul className="space-y-0.5">
            {subtareas.map((s) => (
              <li key={s.id}>
                <label
                  className={`flex items-start gap-1.5 text-xs rounded-md px-1 py-0.5 ${
                    onToggleSubtarea ? 'cursor-pointer hover:bg-slate-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={s.completada}
                    disabled={!onToggleSubtarea}
                    onChange={(e) => onToggleSubtarea?.(s.id, e.target.checked)}
                    className="mt-0.5 accent-emerald-600"
                  />
                  <span className={s.completada ? 'text-slate-400 line-through' : 'text-slate-800'}>{s.titulo}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Meta información */}
      <div className="grid grid-cols-2 gap-1.5 pt-1.5 text-[11px] border-t border-slate-100">
        {assignedToName && (
          <div className="min-w-0">
            <span className={label}>Dirigida a</span>
            <span className="font-medium text-slate-800 truncate flex items-center gap-1 mt-0.5">
              <Icon name="user" size={11} className="text-slate-400 shrink-0" /> {assignedToName}
            </span>
          </div>
        )}

        <div className="min-w-0">
          <span className={label}>Asignada por</span>
          <span className="font-medium text-slate-800 truncate flex items-center gap-1 mt-0.5">
            <Icon name="key" size={11} className="text-slate-400 shrink-0" /> {assignedByName}
          </span>
        </div>

        <div>
          <span className={label}>Prioridad</span>
          <span
            className={`inline-block px-1.5 py-0.5 rounded-md border text-[10px] font-semibold mt-0.5 ${priorityColors[priority]}`}
          >
            {priority}
          </span>
        </div>

        <div className="min-w-0">
          <span className={label}>Fecha límite</span>
          <span className="font-mono text-slate-700 font-medium flex items-center gap-1 mt-0.5">
            <Icon name="calendar" size={11} className="text-slate-400 shrink-0" /> {dueDate || 'Sin fecha'}
          </span>
        </div>

        <div>
          <span className={label}>Holgura estimada</span>
          <span
            className={`font-mono text-[10px] font-semibold block mt-0.5 ${
              isCritical ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {isCritical ? '0 días (crítica)' : `+${slackDays || 0} días`}
          </span>
        </div>
      </div>

      {/* Colaboradores */}
      {collaborators.length > 0 && (
        <div className="pt-1.5 border-t border-slate-100">
          <span className={`${label} mb-1 flex items-center gap-1`}>
            <Icon name="users" size={11} /> Equipo colaborador ({collaborators.length})
          </span>
          <div className="flex items-center gap-1 flex-wrap">
            {collaborators.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-100 text-indigo-800 text-[10px] font-medium px-1.5 py-0.5 rounded-lg"
              >
                <Icon name="user" size={10} /> {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Acciones */}
      {(onEdit || onComplete || onDelete || (status !== 'Completada' && onRequestExtension)) && (
        <div className="pt-1.5 border-t border-slate-100 flex items-center justify-end gap-1">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 font-medium px-1.5 py-1 rounded-lg text-[10px] transition-colors cursor-pointer mr-auto"
              title="Eliminar esta tarea (por ejemplo, si se asignó a quien no era)"
            >
              <Icon name="trash" size={11} /> Eliminar
            </button>
          )}
          {onComplete && status !== 'Completada' && (
            <button
              type="button"
              onClick={onComplete}
              className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-2 py-1 rounded-lg text-[10px] transition-colors cursor-pointer"
              title="Marcar la tarea como completada y mandarla al historial"
            >
              <Icon name="check-circle" size={11} /> Completada
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 font-medium px-1.5 py-1 rounded-lg text-[10px] transition-colors cursor-pointer"
              title="Editar los datos de esta tarea"
            >
              <Icon name="pencil" size={11} /> Editar
            </button>
          )}
          {status !== 'Completada' && onRequestExtension && (
            <button
              type="button"
              onClick={onRequestExtension}
              className="inline-flex items-center gap-1 bg-slate-100 hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300 font-medium px-1.5 py-1 rounded-lg text-[10px] transition-colors cursor-pointer"
              title="Extender la fecha límite de esta tarea"
            >
              <Icon name="clock" size={11} /> Tiempo extra
            </button>
          )}
        </div>
      )}
        </div>
      )}
    </div>
  );
}
