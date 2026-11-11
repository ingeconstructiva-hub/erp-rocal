document.addEventListener('DOMContentLoaded', () => {
  let usuarioAutenticado = null;
  let jwtToken = null;
  let activeMainTab = 'tareas';
  let activeSubFilter = 'por_hacer';
  // Gerencia y Coordinación asignan tareas a su equipo desde la extensión.
  let mostrarAsignar = false;
  const esMando = () => ['gerencia', 'coordinador'].includes((usuarioAutenticado?.nivel || '').toLowerCase().trim());

  // ⏱️ Variables para el Timer Automático
  // 🏆 Evidencia pendiente de adjuntar por tarea (id -> {base64, nombre, tipo}) —
  // se llena al elegir un archivo y se envía junto con "Enviar a Revisión".
  const evidenciasPendientes = new Map();
  const MAX_EVIDENCIA_BYTES = 5 * 1024 * 1024; // 5MB

  let timerInterval = null;
  let todaySeconds = 0;
  let lastSyncTimestamp = Date.now();
  let lastSyncedSeconds = 0; // 🛡️ Fix #5: Marca hasta dónde ya se sincronizó realmente
  let syncInProgress = false; // 🛡️ Fix #9: Candado para evitar carreras y errores de null
  const SYNC_INTERVAL_MS = 15000; // ⏱️ Fix #7: Cada 15s
  const MAX_DAILY_SECONDS = 5 * 3600; // 5 Horas = 18,000s

  // 🌐 URL de la API: producción por defecto; `custom_api_url` en storage la sobreescribe (p. ej. localhost para desarrollo)
  let API_BASE_URL = "https://erp-rocal.vercel.app/api";
  chrome.storage.local.get(['custom_api_url'], (res) => {
    if (res?.custom_api_url) {
      API_BASE_URL = res.custom_api_url.replace(/\/+$/, '');
    }
  });

  const screenContainer = document.getElementById('screen-container');

  // Acciones de la tarjeta del usuario: 🔄 actualizar y menú ⋮ (ventana
  // flotante y cerrar sesión). Chrome ya muestra el nombre de la extensión
  // arriba del panel, así que no hay encabezado propio.
  let menuListenersListos = false;
  function setupAccionesUsuario() {
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        if (!usuarioAutenticado || refreshBtn.disabled) return;
        refreshBtn.disabled = true;
        refreshBtn.classList.add('spinning');
        await loadData();
        setTimeout(() => {
          refreshBtn.classList.remove('spinning');
          refreshBtn.disabled = false;
        }, 400);
      };
    }

    const menuBtn = document.getElementById('btn-menu');
    const menu = document.getElementById('menu-opciones');
    if (!menuBtn || !menu) return;
    const cerrarMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
    };
    // Los listeners del documento se ponen una sola vez (el dashboard se
    // vuelve a dibujar al iniciar sesión).
    if (!menuListenersListos) {
      menuListenersListos = true;
      const cerrarSiAbierto = () => {
        const m = document.getElementById('menu-opciones');
        if (m && !m.hidden) { m.hidden = true; document.getElementById('btn-menu')?.setAttribute('aria-expanded', 'false'); }
      };
      document.addEventListener('click', (e) => { if (!e.target.closest('#menu-opciones')) cerrarSiAbierto(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarSiAbierto(); });
    }

    const popoutBtn = document.getElementById('btn-popout');
    // Si ya estás en la ventana flotante, la opción sobra.
    chrome.windows?.getCurrent((w) => { if (w?.type === 'popup' && popoutBtn) popoutBtn.style.display = 'none'; });
    if (popoutBtn) popoutBtn.onclick = () => { cerrarMenu(); chrome.runtime.sendMessage({ type: 'OPEN_POPUP_WINDOW' }); };

    // Interruptor "Abrir al iniciar Chrome" (activado si nunca se ha tocado).
    const inicioBtn = document.getElementById('btn-abrir-inicio');
    if (inicioBtn) {
      const pintar = (activo) => {
        inicioBtn.setAttribute('aria-checked', String(activo));
        inicioBtn.classList.toggle('activo', activo);
      };
      chrome.storage.local.get(['abrir_al_iniciar'], (res) => pintar(res?.abrir_al_iniciar !== false));
      inicioBtn.onclick = (e) => {
        e.stopPropagation();
        const activo = inicioBtn.getAttribute('aria-checked') !== 'true';
        pintar(activo);
        chrome.storage.local.set({ abrir_al_iniciar: activo });
      };
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.onclick = () => { cerrarMenu(); handleLogout(); };
  }

  // 🔒 Cliente de red inyectando Token JWT
  function apiRequest(url, options = {}) {
    options.headers = {
      'Content-Type': 'application/json',
      ...(jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {}),
      ...(options.headers || {})
    };

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'API_REQUEST', url, options }, (res) => {
        if (res?.status === 401) {
          handleLogout();
        }
        resolve(res || { ok: false, error: 'Sin respuesta' });
      });
    });
  }

  const OJO_ABIERTO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OJO_CERRADO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  // ==========================================
  // 1. RENDERIZADO DEL LOGIN
  // ==========================================
  function renderLogin() {
    if (!screenContainer) return;

    screenContainer.innerHTML = `
      <div class="login-container">
        <div style="text-align: center; margin-bottom: 10px;">
          <h3 style="font-size: 15px; font-weight: 700; color: #ffffff; margin-bottom: 2px;">Acceso de Empleados</h3>
          <p style="font-size: 11px; color: #94a3b8;">Sincroniza tus tareas y jornada de trabajo</p>
        </div>

        <div class="form-group">
          <label class="form-label">Usuario o Correo</label>
          <input type="text" id="c-user" placeholder="usuario o correo@empresa.com" class="form-input">
        </div>

        <div class="form-group">
          <label class="form-label">Contraseña</label>
          <div style="position: relative;">
            <input type="password" id="c-pass" placeholder="••••••••" class="form-input" style="padding-right: 30px;">
            <button type="button" id="c-verPass" class="ver-pass" title="Mostrar contraseña" aria-label="Mostrar contraseña">${OJO_ABIERTO}</button>
          </div>
        </div>

        <button id="c-btnLogin" class="btn-submit">Conectar al ERP</button>
      </div>
    `;

    // 👁 Mostrar/ocultar la contraseña mientras se escribe.
    const verPass = document.getElementById('c-verPass');
    verPass.onclick = () => {
      const campo = document.getElementById('c-pass');
      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      verPass.innerHTML = mostrar ? OJO_CERRADO : OJO_ABIERTO;
      const texto = mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña';
      verPass.title = texto;
      verPass.setAttribute('aria-label', texto);
    };

    document.getElementById('c-btnLogin').onclick = async () => {
      const email = document.getElementById('c-user').value.trim();
      const password = document.getElementById('c-pass').value.trim();
      if (!email || !password) return alert('Por favor ingresa tus credenciales.');

      const res = await apiRequest(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      const user = res?.data?.employee || res?.data?.user;
      const token = res?.data?.token;

      if (res?.ok && user?.id && token) {
        usuarioAutenticado = user;
        jwtToken = token;

        chrome.storage.local.set({ session_user: usuarioAutenticado, jwt_token: jwtToken });
        renderDashboard();
      } else {
        alert(res?.data?.error || res?.data?.message || res?.error || 'Credenciales incorrectas.');
      }
    };
  }

  // ==========================================
  // 2. RENDERIZADO DEL DASHBOARD
  // ==========================================
  async function renderDashboard() {
    if (!screenContainer) return;
    if (!usuarioAutenticado?.id || !jwtToken) return renderLogin();

    // Sesiones guardadas antes de que el login trajera el nivel: se completa una vez.
    if (!usuarioAutenticado.nivel) {
      const r = await apiRequest(`${API_BASE_URL}/movil/equipo`, { method: 'GET' });
      if (r?.ok && r.data?.yo?.nivel) {
        usuarioAutenticado.nivel = r.data.yo.nivel;
        chrome.storage.local.set({ session_user: usuarioAutenticado });
      }
    }

    const rolLower = (usuarioAutenticado.rol || usuarioAutenticado.role || '').toLowerCase().trim();

    // Detectar categoría
    const isServicio = rolLower.includes('servicio') || rolLower.includes('ss');
    const isPracticas = rolLower.includes('practicante') || rolLower.includes('práctica') || rolLower.includes('practica') || rolLower.includes('pp');
    const isEstudiante = isServicio || isPracticas;

    // Priorizar horas por rol (PP = 250, SS = 480)
    const targetHours = isPracticas ? 250 : (isServicio ? 480 : (usuarioAutenticado.horas_totales_objetivo || 480));
    usuarioAutenticado.horas_totales_objetivo = targetHours;

    screenContainer.innerHTML = `
      <!-- Tarjeta de Usuario -->
      <div class="user-card">
        <div class="avatar">
          ${escapeHtml((usuarioAutenticado.nombre || usuarioAutenticado.name || 'E').charAt(0).toUpperCase())}
        </div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(usuarioAutenticado.nombre || usuarioAutenticado.name || 'Empleado')}</div>
          <div class="user-role-container">
            <div class="status-dot"></div>
            <span class="user-role">${escapeHtml(usuarioAutenticado.rol || usuarioAutenticado.role || 'Personal')}</span>
          </div>
        </div>
        <span id="rewards-badge" class="rewards-badge" title="Puntos de recompensa">🏆 ${Number(usuarioAutenticado.puntos_recompensa) || 0} pts</span>
        <div class="user-acciones">
          <button id="btn-refresh" title="Actualizar" class="icon-btn"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button>
          <div class="menu-wrap">
            <button id="btn-menu" title="Más opciones" class="icon-btn" aria-haspopup="true" aria-expanded="false"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>
            <div id="menu-opciones" class="menu-opciones" hidden>
              <button id="btn-abrir-inicio" class="menu-item" role="menuitemcheckbox" aria-checked="true"><span class="menu-check"></span> Abrir al iniciar Chrome</button>
              <button id="btn-popout" class="menu-item"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg> Abrir en ventana flotante</button>
              <div class="menu-separador"></div>
              <button id="btn-logout" class="menu-item peligro"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg> Cerrar sesión</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Widget de Timer Automático -->
      <div id="timer-box" class="timer-widget" style="display: ${isEstudiante ? 'block' : 'none'};">
        <div class="timer-header">
          <span>⏱️ Jornada Diaria (Máx 5h)</span>
          <span id="timer-status" class="timer-badge">🟢 Contando</span>
        </div>

        <div id="timer-display" class="timer-clock">00:00:00</div>

        <div class="timer-footer">
          <span>Acumulado Total:</span>
          <strong id="total-hours-text" style="color: #a5b4fc;">0.0 / ${targetHours} hrs</strong>
        </div>

        <div class="progress-bar-bg">
          <div id="progress-fill" class="progress-bar-fill"></div>
        </div>
      </div>

      <!-- Avisos de revisión (aprobaciones con comentario) -->
      <div id="avisos-revision"></div>

      <!-- Pestañas Principales -->
      <div class="tabs-container">
        <button id="tab-tareas" class="tab-btn">📋 Tareas</button>
        <button id="tab-reuniones" class="tab-btn">📅 Reuniones</button>
        <button id="tab-recompensas" class="tab-btn">🏆 Puntos</button>
        <button id="tab-avisos" class="tab-btn"><span class="tab-campana">🔔</span> Avisos<span id="avisos-contador" class="tab-contador" style="display:none;"></span></button>
      </div>

      <!-- Sub-filtros de Tareas -->
      <div id="subfilters-container" class="subfilters-grid">
        <button id="sub-por_hacer" class="subfilter-btn">Por hacer</button>
        <button id="sub-pendientes" class="subfilter-btn">Pendientes</button>
        <button id="sub-completadas" class="subfilter-btn">Completadas</button>
      </div>

      <!-- Asignar tarea (solo Gerencia / Coordinación) -->
      ${esMando() ? '<div id="asignar-bar" class="asignar-bar"><button id="btn-asignar" class="btn-action btn-asignar">➕ Asignar tarea a mi equipo</button></div>' : ''}

      <!-- Contenedor Dinámico -->
      <div id="c-contentList" class="content-list"></div>
    `;

    setupEvents();
    setupAccionesUsuario();
    updateStyles();

    if (isEstudiante) {
      setupAutoTimer(targetHours);
    }

    await loadData();
  }

  // ==========================================
  // RESULTADO DE REVISIÓN (comentarios del coordinador)
  // ==========================================
  // La web guarda en la tarea el resultado de la última revisión. "Rechazado"
  // con la tarea de vuelta en proceso = hay que corregir; al reenviarla el
  // servidor limpia el resultado.
  function esPorCorregir(t) {
    const st = (t.estado || '').toLowerCase();
    return t.revision_resultado === 'Rechazado' &&
      !st.includes('completa') && !st.includes('revisi');
  }

  function escapeHtml(texto) {
    return String(texto ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Solo enlaces http(s) (Zoom, Meet, etc.); cualquier otro esquema se descarta.
  function enlaceSeguro(url) {
    try {
      const u = new URL(String(url || ''));
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
      return null;
    }
  }

  function formatFechaHora(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  const AVISOS_VISTOS_KEY = 'avisos_revision_vistos';
  const DIAS_AVISO_APROBACION = 3;

  // Aviso verde arriba de las pestañas por cada tarea aprobada en los últimos
  // días que el trabajador no haya cerrado (se recuerda en chrome.storage).
  function renderAvisosRevision(tareas) {
    const cont = document.getElementById('avisos-revision');
    if (!cont) return;
    const limite = Date.now() - DIAS_AVISO_APROBACION * 24 * 3600 * 1000;
    const aprobadas = tareas.filter(t =>
      t.revision_resultado === 'Aprobado' && t.revision_fecha &&
      new Date(t.revision_fecha).getTime() >= limite);

    chrome.storage.local.get([AVISOS_VISTOS_KEY], (res) => {
      const vistos = new Set(res?.[AVISOS_VISTOS_KEY] || []);
      const pendientes = aprobadas.filter(t => !vistos.has(`${t.id}|${t.revision_fecha}`));
      cont.innerHTML = pendientes.map(t => `
        <div class="review-approved">
          <span class="review-approved-icon">✅</span>
          <div class="review-approved-text">
            <div class="review-approved-title">Aprobada: ${escapeHtml(t.titulo || 'Tarea')}</div>
            ${t.revision_comentario ? `<div class="review-approved-body">“${escapeHtml(t.revision_comentario)}”</div>` : ''}
            <div class="review-comment-date">${escapeHtml(t.revision_por || '')}${t.revision_por ? ' · ' : ''}${formatFechaHora(t.revision_fecha)}</div>
          </div>
          <button class="review-approved-close" data-key="${escapeHtml(`${t.id}|${t.revision_fecha}`)}" title="Cerrar">✕</button>
        </div>`).join('');

      cont.querySelectorAll('.review-approved-close').forEach(btn => {
        btn.onclick = () => {
          vistos.add(btn.dataset.key);
          chrome.storage.local.set({ [AVISOS_VISTOS_KEY]: Array.from(vistos).slice(-100) });
          btn.closest('.review-approved')?.remove();
        };
      });
    });
  }

  // ==========================================
  // AVISOS (historial de notificaciones)
  // ==========================================
  // background.js guarda cada notificación en `avisos_historial`. Aquí se
  // listan; al abrir la pestaña se marcan como leídas (las nuevas se resaltan
  // mientras sigas en la pestaña).
  const ICONO_AVISO = { tarea: '📋', revision: '✅', reunion: '📅', recordatorio: '⏰' };

  function haceCuanto(ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'Justo ahora';
    if (min < 60) return `Hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `Hace ${h} h`;
    return new Date(ms).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  function actualizarContadorAvisos() {
    chrome.storage.local.get(['avisos_historial'], (res) => {
      const el = document.getElementById('avisos-contador');
      if (!el) return;
      const sinLeer = (res?.avisos_historial || []).filter(a => !a.leido).length;
      el.textContent = sinLeer > 99 ? '99+' : String(sinLeer);
      el.style.display = sinLeer ? 'inline-block' : 'none';
      document.getElementById('tab-avisos')?.classList.toggle('tiene-avisos', sinLeer > 0);
    });
  }

  function renderAvisos(list) {
    chrome.storage.local.get(['avisos_historial'], (res) => {
      const avisos = res?.avisos_historial || [];
      if (avisos.length === 0) {
        list.innerHTML = `<p style="text-align:center; font-size:11px; color:#64748b; margin-top: 12px;">Sin avisos todavía. Aquí aparecerán tus tareas nuevas, revisiones y reuniones.</p>`;
        return;
      }

      list.innerHTML = `
        <div class="avisos-acciones">
          <button id="avisos-limpiar" class="avisos-limpiar">Borrar todos</button>
        </div>
        ${avisos.map((a, i) => {
          const esRevision = a.tipo === 'revision';
          const icono = esRevision && /corregir/i.test(a.titulo) ? '✏️' : (ICONO_AVISO[a.tipo] || '🔔');
          const link = enlaceSeguro(a.link);
          return `
          <div class="card-item aviso-item${a.leido ? '' : ' aviso-nuevo'}" data-i="${i}">
            <div class="card-header">
              <span class="card-title">${icono} ${escapeHtml(a.titulo)}</span>
              ${a.leido ? '' : '<span class="aviso-punto" title="Nuevo"></span>'}
            </div>
            ${a.mensaje ? `<div class="card-desc">${escapeHtml(a.mensaje)}</div>` : ''}
            <div class="card-footer">
              <div class="card-meta"><span>${escapeHtml(haceCuanto(a.fecha))}</span></div>
              ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="btn-meeting-link">🔗 Unirme</a>` : ''}
            </div>
          </div>`;
        }).join('')}
      `;

      document.getElementById('avisos-limpiar').onclick = () => {
        chrome.storage.local.set({ avisos_historial: [] }, () => renderAvisos(list));
      };

      // Clic en un aviso de tarea → lleva a la pestaña de Tareas.
      list.querySelectorAll('.aviso-item').forEach(card => {
        const a = avisos[Number(card.dataset.i)];
        if (a.tipo !== 'tarea' && a.tipo !== 'revision') return;
        card.style.cursor = 'pointer';
        card.onclick = () => { activeMainTab = 'tareas'; activeSubFilter = 'por_hacer'; updateStyles(); loadData(); };
      });

      if (avisos.some(a => !a.leido)) {
        chrome.storage.local.set({ avisos_historial: avisos.map(a => ({ ...a, leido: true })) });
      }
    });
  }

  // Si llega un aviso con el panel abierto se actualiza el contador (y la
  // lista si estás viendo la pestaña).
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local' || !changes.avisos_historial) return;
    actualizarContadorAvisos();
    const idsAntes = new Set((changes.avisos_historial.oldValue || []).map(a => a.id));
    const recien = (changes.avisos_historial.newValue || []).filter(a => !a.leido && !idsAntes.has(a.id));
    if (recien.length === 0) return;
    mostrarToastAviso(recien[0], recien.length);
    const list = document.getElementById('c-contentList');
    if (activeMainTab === 'avisos' && list) renderAvisos(list);
  });

  // Mientras el panel está abierto se revisan avisos cada 15 s.
  setInterval(() => {
    if (usuarioAutenticado) chrome.runtime.sendMessage({ type: 'REVISAR_AVISOS' });
  }, 15000);

  // Banner que baja desde arriba cuando llega un aviso con el panel abierto.
  let toastTimer = null;
  function mostrarToastAviso(aviso, total) {
    if (!usuarioAutenticado) return;
    document.getElementById('toast-aviso')?.remove();
    clearTimeout(toastTimer);
    const icono = aviso.tipo === 'revision' && /corregir/i.test(aviso.titulo) ? '✏️' : (ICONO_AVISO[aviso.tipo] || '🔔');
    const toast = document.createElement('div');
    toast.id = 'toast-aviso';
    toast.className = 'toast-aviso';
    toast.innerHTML = `
      <div class="toast-campana">🔔</div>
      <div class="toast-cuerpo">
        <div class="toast-etiqueta">${total > 1 ? `${total} avisos nuevos` : 'Nuevo aviso'}</div>
        <div class="toast-titulo">${icono} ${escapeHtml(aviso.titulo)}</div>
        ${aviso.mensaje ? `<div class="toast-mensaje">${escapeHtml(aviso.mensaje)}</div>` : ''}
      </div>
      <button class="toast-cerrar" title="Cerrar">✕</button>
      <div class="toast-progreso"></div>`;
    document.body.appendChild(toast);
    const cerrar = () => {
      toast.classList.add('saliendo');
      setTimeout(() => toast.remove(), 250);
    };
    toast.querySelector('.toast-cerrar').onclick = (e) => { e.stopPropagation(); cerrar(); };
    toast.onclick = () => {
      activeMainTab = 'avisos';
      updateStyles();
      loadData();
      cerrar();
    };
    toastTimer = setTimeout(cerrar, 8000);
  }

  // ==========================================
  // 3. SELECCIÓN Y ESTILOS DE PESTAÑAS
  // ==========================================
  function setupEvents() {
    const btnT = document.getElementById('tab-tareas');
    const btnR = document.getElementById('tab-reuniones');
    const btnP = document.getElementById('tab-recompensas');
    if (btnT) btnT.onclick = () => { activeMainTab = 'tareas'; mostrarAsignar = false; updateStyles(); loadData(); };
    if (btnR) btnR.onclick = () => { activeMainTab = 'reuniones'; mostrarAsignar = false; updateStyles(); loadData(); };
    if (btnP) btnP.onclick = () => { activeMainTab = 'recompensas'; mostrarAsignar = false; updateStyles(); loadData(); };
    const btnA = document.getElementById('tab-avisos');
    if (btnA) btnA.onclick = () => { activeMainTab = 'avisos'; mostrarAsignar = false; updateStyles(); loadData(); };
    actualizarContadorAvisos();
    const btnAsignar = document.getElementById('btn-asignar');
    if (btnAsignar) btnAsignar.onclick = () => { activeMainTab = 'tareas'; mostrarAsignar = true; updateStyles(); loadData(); };

    ['por_hacer', 'pendientes', 'completadas'].forEach(filter => {
      const btn = document.getElementById(`sub-${filter}`);
      if (btn) btn.onclick = () => { activeSubFilter = filter; updateStyles(); loadData(); };
    });
  }

  function updateStyles() {
    const btnT = document.getElementById('tab-tareas');
    const btnR = document.getElementById('tab-reuniones');
    const btnP = document.getElementById('tab-recompensas');
    const subContainer = document.getElementById('subfilters-container');
    const asignarBar = document.getElementById('asignar-bar');
    if (asignarBar) asignarBar.style.display = (activeMainTab === 'tareas' && !mostrarAsignar) ? 'block' : 'none';

    const btnA = document.getElementById('tab-avisos');

    if (btnT && btnR && btnP && btnA) {
      [btnT, btnR, btnP, btnA].forEach(b => b.classList.remove('active'));
      if (activeMainTab === 'tareas') {
        btnT.classList.add('active');
        if (subContainer) subContainer.style.display = mostrarAsignar ? 'none' : 'grid';
      } else {
        ({ reuniones: btnR, recompensas: btnP, avisos: btnA })[activeMainTab]?.classList.add('active');
        if (subContainer) subContainer.style.display = 'none';
      }
    }

    ['por_hacer', 'pendientes', 'completadas'].forEach(f => {
      const btn = document.getElementById(`sub-${f}`);
      if (btn) {
        if (activeSubFilter === f) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    });
  }

  // ==========================================
  // 4. TEMPORIZADOR AUTOMÁTICO DE SERVICIO
  // ==========================================
  function setupAutoTimer(targetHours) {
    if (timerInterval) clearInterval(timerInterval);

    // 🛡️ Fix #4: Avisar a background.js que el panel está activo
    chrome.runtime.sendMessage({ type: 'PANEL_ACTIVE', employeeId: usuarioAutenticado?.id });

    timerInterval = setInterval(() => {
      const ahora = new Date();
      const horaActual = ahora.getHours();
      const esHorarioLaboral = horaActual >= 9 && horaActual < 17; // ⏰ 9 AM a 5 PM

      const statusEl = document.getElementById('timer-status');

      if (!esHorarioLaboral) {
        if (statusEl) {
          statusEl.innerText = '⏸️ Fuera de horario (9am-5pm)';
          statusEl.style.color = '#fbbf24';
        }
      } else if (todaySeconds < MAX_DAILY_SECONDS) {
        todaySeconds++;
        if (statusEl) {
          statusEl.innerText = '🟢 Contando';
          statusEl.style.color = '#34d399';
        }
      } else {
        if (statusEl) {
          statusEl.innerText = '🛑 Límite diario (5h max)';
          statusEl.style.color = '#f87171';
        }
      }

      const hrs = Math.floor(todaySeconds / 3600).toString().padStart(2, '0');
      const mins = Math.floor((todaySeconds % 3600) / 60).toString().padStart(2, '0');
      const secs = (todaySeconds % 60).toString().padStart(2, '0');

      const timerDisplay = document.getElementById('timer-display');
      if (timerDisplay) timerDisplay.innerText = `${hrs}:${mins}:${secs}`;

      chrome.storage.local.set({ todaySeconds });

      // Sincronizar horas con el servidor cada SYNC_INTERVAL_MS (15s)
      if (Date.now() - lastSyncTimestamp >= SYNC_INTERVAL_MS) {
        syncHoursToBackend(targetHours, todaySeconds);
        lastSyncTimestamp = Date.now();
      }

      const accumulatedHours = (usuarioAutenticado?.horas_acumuladas || 0) + (todaySeconds / 3600);
      const percent = Math.min(Math.round((accumulatedHours / targetHours) * 100), 100);

      const totalText = document.getElementById('total-hours-text');
      const progressFill = document.getElementById('progress-fill');
      if (totalText) totalText.innerText = `${accumulatedHours.toFixed(1)} / ${targetHours} hrs (${percent}%)`;
      if (progressFill) progressFill.style.width = `${percent}%`;

    }, 1000);
  }

  async function syncHoursToBackend(targetHours, currentTodaySeconds) {
    // 🛡️ Fix #9: Evitar colisiones de sync simultáneas
    if (!usuarioAutenticado?.id || syncInProgress) return;

    const secondsToSync = currentTodaySeconds - lastSyncedSeconds;
    if (secondsToSync <= 0) return;

    syncInProgress = true;
    const incrementHours = secondsToSync / 3600;

    try {
      // Incremento ATÓMICO en el servidor — se manda solo el delta, no el total.
      // Así el panel y el background pueden sincronizar sin pisarse.
      const res = await apiRequest(`${API_BASE_URL}/empleados/horas`, {
        method: 'PATCH',
        body: JSON.stringify({
          employeeId: usuarioAutenticado.id,
          deltaHoras: parseFloat(incrementHours.toFixed(6)),
          targetHours
        })
      });

      // 🛡️ Fix #9: Verificar que el usuario no haya cerrado sesión mientras esperaba
      if (!usuarioAutenticado) return;

      if (res?.ok) {
        // El servidor devuelve el nuevo total ya sumado atómicamente.
        const total = res?.data?.horas_acumuladas;
        usuarioAutenticado.horas_acumuladas =
          typeof total === 'number'
            ? total
            : (usuarioAutenticado.horas_acumuladas || 0) + incrementHours;
        lastSyncedSeconds = currentTodaySeconds; // ✅ Fix #5: Solo avanza si el servidor confirmó éxito
        chrome.storage.local.set({ session_user: usuarioAutenticado });
      } else {
        console.warn('Sync de horas no confirmado, se reintentará en el próximo ciclo.');
      }
    } catch (err) {
      console.error('Error sincronizando horas:', err);
    } finally {
      syncInProgress = false;
    }
  }

  // 🏆 Actualiza el badge de puntos (y lo persiste) cada vez que llega un valor
  // fresco del servidor — los puntos se otorgan por trigger al completar tareas,
  // así que se refrescan solos en cada carga sin necesitar un endpoint aparte.
  function actualizarPuntosUI(puntos) {
    if (typeof puntos !== 'number' || !usuarioAutenticado) return;
    usuarioAutenticado.puntos_recompensa = puntos;
    const el = document.getElementById('rewards-badge');
    if (el) el.textContent = `🏆 ${puntos} pts`;
    chrome.storage.local.set({ session_user: usuarioAutenticado });
  }

  // 🏆 Mismos umbrales de nivel que Panel Principal (src/app/page.tsx,
  // NIVELES_RECOMPENSA) — que coincidan es lo que hace que un empleado vea el mismo
  // nivel en la extensión y en el CRM web.
  const NIVELES_RECOMPENSA = [
    { min: 0, label: 'Bronce', icon: '🥉' },
    { min: 300, label: 'Plata', icon: '🥈' },
    { min: 800, label: 'Oro', icon: '🥇' },
    { min: 1500, label: 'Diamante', icon: '💎' },
  ];

  function getNivelRecompensa(puntos) {
    let actual = NIVELES_RECOMPENSA[0];
    let siguiente = null;
    for (let i = 0; i < NIVELES_RECOMPENSA.length; i++) {
      if (puntos >= NIVELES_RECOMPENSA[i].min) {
        actual = NIVELES_RECOMPENSA[i];
        siguiente = NIVELES_RECOMPENSA[i + 1] || null;
      }
    }
    const progresoPct = siguiente
      ? Math.min(100, Math.round(((puntos - actual.min) / (siguiente.min - actual.min)) * 100))
      : 100;
    return { actual, siguiente, progresoPct };
  }

  // Mismo catálogo (visual, sin canje real todavía) que Panel Principal.
  const CATALOGO_RECOMPENSAS = [
    { icon: '🛒', label: 'Vale de Despensa', desc: 'Apoyo para compras de despensa en supermercados.', cost: 400 },
    { icon: '⛽', label: 'Tarjeta / Vale de Gasolina', desc: 'Apoyo para transporte y movilidad diaria.', cost: 400 },
    { icon: '📚', label: 'Curso o Certificación Profesional', desc: 'Pago de capacitación técnica o profesional.', cost: 900 },
    { icon: '🎟️', label: 'Día Libre', desc: 'Un día de descanso adicional pagado.', cost: 2500 },
    { icon: '🏆', label: 'Bono Colectivo de Equipo', desc: 'Premio acumulativo por cumplimiento de hitos del área o proyecto.', cost: null },
  ];

  function formatFechaCorta(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  async function renderRecompensas(list) {
    const res = await apiRequest(`${API_BASE_URL}/recompensas?employeeId=${usuarioAutenticado.id}`, { method: 'GET' });

    if (!res?.ok) {
      list.innerHTML = `<p style="text-align:center; font-size:11px; color:#64748b; margin-top: 12px;">No se pudo cargar tus recompensas.</p>`;
      return;
    }

    const puntos = res.data?.puntosRecompensa || 0;
    const historial = res.data?.historial || [];
    actualizarPuntosUI(puntos);

    const { actual, siguiente, progresoPct } = getNivelRecompensa(puntos);

    const historialHtml = historial.length === 0
      ? `<p style="font-size:10px; color:#64748b; padding: 2px 2px;">Todavía no has ganado puntos — se otorgan al completar tareas.</p>`
      : historial.map(h => `
          <div style="display:flex; align-items:center; justify-content:space-between; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding: 4px 6px; gap: 4px;">
            <span style="font-size:10px; color:#e2e8f0; flex:1; min-width:0;">${escapeHtml(h.motivo)}</span>
            <div style="display:flex; align-items:center; gap: 3px; flex-shrink:0;">
              <span style="font-size:10px; font-weight:700; color:#6ee7b7;">+${Number(h.puntos) || 0} pts</span>
              <span style="font-size:9px; color:#64748b; font-family:monospace;">${formatFechaCorta(h.created_at)}</span>
            </div>
          </div>
        `).join('');

    const catalogoHtml = CATALOGO_RECOMPENSAS.map(item => `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding: 4px 6px; gap: 4px;">
        <div style="display:flex; align-items:flex-start; gap: 4px; min-width:0;">
          <span>${item.icon}</span>
          <span style="min-width:0;">
            <span style="display:block; font-size:11px; font-weight:700; color:#f8fafc;">${item.label}</span>
            <span style="display:block; font-size:9px; color:#94a3b8; margin-top: 2px; line-height:1.3;">${item.desc}</span>
          </span>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap: 2px; flex-shrink:0;">
          <span style="font-size:9px; font-weight:700; color:#fcd34d; white-space:nowrap;">${item.cost !== null ? `⭐ ${item.cost} pts` : 'Según equipo'}</span>
          <button disabled title="Próximamente" style="font-size:9px; font-weight:700; background:#1e293b; color:#64748b; padding: 2px 4px; border:none; border-radius:6px; cursor:not-allowed;">Canjear</button>
        </div>
      </div>
    `).join('');

    list.innerHTML = `
      <div style="background:linear-gradient(135deg, #4338ca, #2563eb); border-radius:12px; padding: 8px; display:flex; flex-direction:column; gap: 6px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <p style="font-size:9px; font-weight:700; color:#c7d2fe; text-transform:uppercase; letter-spacing:0.5px;">Tus puntos</p>
            <p style="font-size:20px; font-weight:800; color:#fff; margin-top: 2px;">⭐ ${puntos} pts</p>
          </div>
          <span style="font-size:10px; font-weight:700; background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.25); color:#fff; padding: 2px 6px; border-radius:999px; white-space:nowrap;">
            ${actual.icon} Nivel ${actual.label}
          </span>
        </div>
        <div>
          <div style="display:flex; justify-content:space-between; font-size:9px; font-weight:600; color:#c7d2fe; margin-bottom: 2px;">
            <span>${siguiente ? `Progreso a Nivel ${siguiente.label}` : 'Nivel máximo alcanzado'}</span>
            <span>${siguiente ? `${puntos} / ${siguiente.min} pts` : `${puntos} pts`}</span>
          </div>
          <div style="width:100%; height:6px; background:rgba(255,255,255,0.2); border-radius:999px; overflow:hidden;">
            <div style="height:100%; width:${progresoPct}%; background:#fff; border-radius:999px;"></div>
          </div>
        </div>
      </div>

      <p style="font-size:9px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin: 6px 0 3px;">Historial de puntos</p>
      <div style="display:flex; flex-direction:column; gap: 3px;">${historialHtml}</div>

      <p style="font-size:9px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin: 8px 0 3px; display:flex; align-items:center; gap: 3px;">
        Catálogo de Recompensas
        <span style="font-size:8px; font-weight:700; background:rgba(245,158,11,0.15); color:#fcd34d; border:1px solid rgba(245,158,11,0.3); padding: 2px 3px; border-radius:999px; text-transform:none;">Pendiente</span>
      </p>
      <div style="display:flex; flex-direction:column; gap: 3px;">${catalogoHtml}</div>
    `;
  }

  // Convierte un File a base64 (sin el prefijo "data:...;base64,") para mandarlo
  // dentro del JSON de apiRequest — chrome.runtime.sendMessage no transporta bien
  // FormData/Blob entre el panel y el service worker.
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ==========================================
  // 5. CARGA Y DIBUJO DE TAREAS Y REUNIONES
  // ==========================================
  // ➕ Asignar una tarea a alguien del equipo (Gerencia / Coordinación). Usa la
  // misma API que la app móvil, que limita a quién se puede asignar según el área.
  async function renderAsignar(list) {
    list.innerHTML = '<p style="text-align:center; font-size:11px; color:#64748b; margin-top: 12px;">Cargando tu equipo…</p>';
    const res = await apiRequest(`${API_BASE_URL}/movil/equipo`, { method: 'GET' });
    if (!res?.ok) {
      list.innerHTML = '<p style="text-align:center; font-size:11px; color:#fca5a5; margin-top: 12px;">No se pudo cargar tu equipo.</p>';
      return;
    }
    const personas = res.data?.empleados || [];
    const proyectos = res.data?.proyectos || [];
    const opcionesPersonas = personas.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)}${p.id === usuarioAutenticado.id ? ' (yo)' : ''}</option>`).join('');
    const opcionesProyectos = proyectos.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)}</option>`).join('');

    list.innerHTML = `
      <form id="form-asignar" class="card-item" style="gap:6px;">
        <div class="card-title" style="font-size:12px;">Nueva tarea</div>
        <div class="form-group"><label class="form-label">Asignar a</label>
          <select id="as-persona" class="form-input" required><option value="">Elegir persona…</option>${opcionesPersonas}</select></div>
        <div class="form-group"><label class="form-label">Proyecto</label>
          <select id="as-proyecto" class="form-input" required><option value="">Elegir proyecto…</option>${opcionesProyectos}</select></div>
        <div class="form-group"><label class="form-label">Título</label>
          <input id="as-titulo" class="form-input" type="text" maxlength="140" required placeholder="¿Qué hay que hacer?"></div>
        <div class="form-group"><label class="form-label">Descripción (opcional)</label>
          <textarea id="as-desc" class="form-input" rows="3" placeholder="Indicaciones"></textarea></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
          <div class="form-group"><label class="form-label">Prioridad</label>
            <select id="as-prioridad" class="form-input"><option>Baja</option><option selected>Media</option><option>Alta</option><option>Urgente</option></select></div>
          <div class="form-group"><label class="form-label">Fecha límite</label>
            <input id="as-fecha" class="form-input" type="date"></div>
        </div>
        <div id="as-error" style="font-size:11px; color:#fca5a5; display:none;"></div>
        <div style="display:flex; gap:6px;">
          <button type="button" id="as-cancelar" class="btn-action" style="background:#1e293b; flex:1;">Cancelar</button>
          <button type="submit" id="as-enviar" class="btn-action" style="flex:1;">Asignar</button>
        </div>
      </form>`;

    document.getElementById('as-cancelar').onclick = () => { mostrarAsignar = false; updateStyles(); loadData(); };
    document.getElementById('form-asignar').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('as-enviar');
      const err = document.getElementById('as-error');
      if (btn.disabled) return; // evita doble envío
      btn.disabled = true;
      btn.textContent = 'Asignando…';
      err.style.display = 'none';
      const r = await apiRequest(`${API_BASE_URL}/movil/tareas`, {
        method: 'POST',
        body: JSON.stringify({
          empleadoId: document.getElementById('as-persona').value,
          proyectoId: document.getElementById('as-proyecto').value,
          titulo: document.getElementById('as-titulo').value.trim(),
          descripcion: document.getElementById('as-desc').value.trim(),
          prioridad: document.getElementById('as-prioridad').value,
          fechaLimite: document.getElementById('as-fecha').value || null,
        })
      });
      if (r?.ok) {
        alert('Tarea asignada');
        mostrarAsignar = false;
        updateStyles();
        loadData();
      } else {
        err.textContent = r?.data?.error || 'No se pudo asignar la tarea.';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Asignar';
      }
    };
  }

  async function loadData() {
    const list = document.getElementById('c-contentList');
    if (!list) return;
    chrome.runtime.sendMessage({ type: 'REVISAR_AVISOS' });

    if (activeMainTab === 'recompensas') {
      await renderRecompensas(list);
      return;
    }

    if (activeMainTab === 'avisos') {
      renderAvisos(list);
      return;
    }

    if (activeMainTab === 'tareas' && mostrarAsignar && esMando()) {
      await renderAsignar(list);
      return;
    }

    if (activeMainTab === 'tareas') {
      const res = await apiRequest(`${API_BASE_URL}/tareas?employeeId=${usuarioAutenticado.id}`, { method: 'GET' });
      const tareas = (res?.ok && (Array.isArray(res.data) || Array.isArray(res.data?.tareas)))
        ? (res.data.tareas || res.data)
        : [];

      if (res?.ok && typeof res.data?.puntosRecompensa === 'number') {
        actualizarPuntosUI(res.data.puntosRecompensa);
      }

      renderAvisosRevision(tareas);

      const hoyFiltro = new Date().toISOString().split('T')[0];

      const filtered = tareas.filter(t => {
        const st = (t.estado || '').toLowerCase();
        const avance = t.porcentaje_avance ?? 0;
        const isDoneFiltro = st.includes('completa');
        const isOverdueFiltro = t.fecha_limite && t.fecha_limite < hoyFiltro && !isDoneFiltro;
        const porCorregirFiltro = esPorCorregir(t);

        // Las tareas nuevas siempre se crean como 'En Proceso' (ningún flujo del CRM
        // usa 'Por Hacer' como estado real) — se usa el avance para distinguir "sin
        // empezar" (Por Hacer) de "con avance" (Pendientes) dentro de ese mismo estado.
        // Las vencidas necesitan atención inmediata, así que también caen en "Por Hacer"
        // sin importar su avance.
        if (activeSubFilter === 'por_hacer') {
          return st === 'por hacer' || st === 'todo' || st === 'nueva' || st === 'por_hacer' ||
            (st === 'en proceso' && (avance === 0 || isOverdueFiltro || porCorregirFiltro));
        }
        if (activeSubFilter === 'pendientes') {
          return st === 'pendiente' || st === 'en revisión' || st === 'en_revision' ||
            (st === 'en proceso' && avance > 0 && !isOverdueFiltro && !porCorregirFiltro);
        }
        if (activeSubFilter === 'completadas') return st === 'completada' || st === 'finalizada';
        return true;
      });

      if (filtered.length === 0) {
        list.innerHTML = `<p style="text-align:center; font-size:11px; color:#64748b; margin-top: 12px;">Sin tareas en esta categoría.</p>`;
      } else {
        list.innerHTML = '';
        filtered.forEach(t => {
          const item = document.createElement('div');
          item.className = 'card-item';

          const statusLower = (t.estado || '').toLowerCase();
          const isDone = statusLower.includes('completa');
          const isReview = statusLower.includes('revisi') || statusLower.includes('pendiente');
          
          const hoy = new Date().toISOString().split('T')[0];
          const isOverdue = t.fecha_limite && t.fecha_limite < hoy && !isDone;

          const porCorregir = esPorCorregir(t);

          let statusBadgeClass = 'badge-status-pending';
          let statusText = 'Por hacer';

          if (porCorregir) {
            statusBadgeClass = 'badge-status-fix';
            statusText = '↩ Corregir';
          } else if (isDone) {
            statusBadgeClass = 'badge-status-completed';
            statusText = '✓ Completada';
          } else if (isReview) {
            statusBadgeClass = 'badge-status-review';
            statusText = '⏳ En revisión';
          } else if (isOverdue) {
            statusBadgeClass = 'badge-status-overdue';
            statusText = '⚠️ Vencida';
          }

          const desc = t.descripcion ? `<div class="card-desc">${escapeHtml(t.descripcion)}</div>` : '';
          const comentarioRevision = porCorregir ? `
            <div class="review-comment">
              <div class="review-comment-title">💬 Correcciones de ${escapeHtml(t.revision_por || 'tu coordinador')}</div>
              <div class="review-comment-body">${escapeHtml(t.revision_comentario || 'Revisa la tarea y vuelve a enviarla.')}</div>
              ${t.revision_fecha ? `<div class="review-comment-date">${formatFechaHora(t.revision_fecha)}</div>` : ''}
            </div>` : '';
          if (porCorregir) item.classList.add('card-fix');
          const subs = Array.isArray(t.subtareas) ? t.subtareas : [];
          const subsHechas = subs.filter(s => s.completada).length;
          const subsHtml = subs.length ? `
            <div class="subtareas">
              <div class="subtareas-titulo">☑ Subtareas ${subsHechas}/${subs.length}</div>
              ${subs.map(s => `
                <label class="subtarea${s.completada ? ' hecha' : ''}">
                  <input type="checkbox" class="chk-subtarea" data-id="${escapeHtml(s.id)}" ${s.completada ? 'checked' : ''} ${(isDone || isReview) ? 'disabled' : ''}>
                  <span>${escapeHtml(s.titulo)}</span>
                </label>`).join('')}
            </div>` : '';
          const fechaLim = t.fecha_limite ? `<span>📅 ${escapeHtml(t.fecha_limite)}</span>` : '<span>📅 Sin fecha límite</span>';
          const proyectoNombre = t.proyectos?.nombre || t.proyecto_nombre || 'General';

          item.innerHTML = `
            <div class="card-header">
              <span class="card-title">${escapeHtml(t.titulo || t.descripcion || 'Tarea sin título')}</span>
              <span class="card-badge badge-project">📁 ${escapeHtml(proyectoNombre)}</span>
            </div>
            
            ${desc}
            ${comentarioRevision}
            ${subsHtml}

            <div class="card-footer">
              <div class="card-meta">
                <span class="card-badge ${statusBadgeClass}">${statusText}</span>
                ${fechaLim}
              </div>

              ${!isDone && !isReview ? `
                <div class="card-actions">
                  <label class="btn-attach${evidenciasPendientes.has(String(t.id)) ? ' has-file' : ''}" title="Adjuntar evidencia (opcional, máx. 5MB)">
                    📎
                    <input type="file" class="file-evidencia" data-id="${escapeHtml(t.id)}" style="display:none">
                  </label>
                  <span class="evidence-name" data-id="${escapeHtml(t.id)}">${escapeHtml(evidenciasPendientes.get(String(t.id))?.nombre || '')}</span>
                  <button class="btn-action btn-review" data-id="${escapeHtml(t.id)}" data-title="${escapeHtml(t.titulo || t.descripcion)}">
                    ${porCorregir ? '🚀 Reenviar' : '🚀 Enviar a Revisión'}
                  </button>
                </div>
              ` : ''}
            </div>
          `;

          list.appendChild(item);
        });

        document.querySelectorAll('.chk-subtarea').forEach(chk => {
          chk.onchange = async (e) => {
            const el = e.target;
            el.disabled = true;
            const r = await apiRequest(`${API_BASE_URL}/subtareas`, {
              method: 'PATCH',
              body: JSON.stringify({ id: el.dataset.id, completada: el.checked })
            });
            if (!r?.ok) {
              alert('No se pudo actualizar la subtarea' + (r?.data?.error ? `: ${r.data.error}` : ''));
            }
            loadData();
          };
        });

        document.querySelectorAll('.file-evidencia').forEach(input => {
          input.onchange = async (e) => {
            const id = e.target.dataset.id;
            const file = e.target.files?.[0];
            if (!file) return;

            if (file.size > MAX_EVIDENCIA_BYTES) {
              alert('El archivo supera los 5MB permitidos como evidencia.');
              e.target.value = '';
              return;
            }

            const base64 = await fileToBase64(file);
            evidenciasPendientes.set(id, { base64, nombre: file.name, tipo: file.type });

            const nameEl = document.querySelector(`.evidence-name[data-id="${id}"]`);
            if (nameEl) nameEl.textContent = file.name;
            e.target.closest('.btn-attach')?.classList.add('has-file');
          };
        });

        document.querySelectorAll('.btn-review').forEach(btn => {
          btn.onclick = async (e) => {
            const target = e.currentTarget;
            // 🛡️ Evita doble envío: un doble clic rápido antes de que loadData()
            // vuelva a pintar la lista disparaba dos POST a /api/revisiones (bug real
            // detectado: dos filas duplicadas en `revisiones`/`notificaciones`).
            if (target.disabled) return;
            target.disabled = true;
            target.style.opacity = '0.6';
            target.style.cursor = 'not-allowed';
            const textoOriginal = target.textContent;
            target.textContent = 'Enviando...';

            const taskId = target.dataset.id;
            const taskTitle = target.dataset.title;
            const evidencia = evidenciasPendientes.get(taskId);

            const resRev = await apiRequest(`${API_BASE_URL}/revisiones`, {
              method: 'POST',
              body: JSON.stringify({
                taskId,
                taskTitle,
                employeeId: usuarioAutenticado.id,
                employeeName: usuarioAutenticado.nombre || usuarioAutenticado.name,
                ...(evidencia ? {
                  evidenciaBase64: evidencia.base64,
                  evidenciaNombre: evidencia.nombre,
                  evidenciaTipo: evidencia.tipo,
                } : {})
              })
            });

            if (resRev?.ok) {
              evidenciasPendientes.delete(taskId);
              alert('🚀 Tarea enviada a revisión' + (evidencia ? ' con evidencia adjunta' : ''));
              loadData();
            } else {
              alert('Error al enviar la tarea a revisión' + (resRev?.data?.error ? `: ${resRev.data.error}` : ''));
              target.disabled = false;
              target.style.opacity = '';
              target.style.cursor = '';
              target.textContent = textoOriginal;
            }
          };
        });
      }
    } else {
      const resR = await apiRequest(`${API_BASE_URL}/reuniones?employeeId=${usuarioAutenticado.id}`, { method: 'GET' });
      
      const reuniones = (resR?.ok && (Array.isArray(resR.data) || Array.isArray(resR.data?.reuniones)))
        ? (resR.data.reuniones || resR.data)
        : [];

      if (reuniones.length === 0) {
        list.innerHTML = `<p style="text-align:center; font-size:11px; color:#64748b; margin-top: 12px;">Sin reuniones programadas.</p>`;
      } else {
        list.innerHTML = '';
        reuniones.forEach(m => {
          const item = document.createElement('div');
          item.className = 'card-item';

          const horaDisplay = m.hora || (m.fecha_inicio ? new Date(m.fecha_inicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Por definir');
          const fechaDisplay = m.fecha || (m.fecha_inicio ? m.fecha_inicio.split('T')[0] : 'Hoy');

          item.innerHTML = `
            <div class="card-header">
              <span class="card-title" style="color:#a5b4fc;">${escapeHtml(m.titulo || 'Reunión de equipo')}</span>
              <span class="card-badge badge-time">⏰ ${escapeHtml(horaDisplay)}</span>
            </div>

            <div class="card-desc">${escapeHtml(m.descripcion || 'Sin orden del día.')}</div>

            <div class="card-footer">
              <div class="card-meta">
                <span>📅 ${escapeHtml(fechaDisplay)}</span>
              </div>
              ${enlaceSeguro(m.link) ? `
                <a href="${escapeHtml(enlaceSeguro(m.link))}" target="_blank" rel="noopener noreferrer" class="btn-meeting-link">
                  🔗 Unirme a sesión
                </a>
              ` : '<span style="font-size:9px; color:#64748b;">Sin enlace asignado</span>'}
            </div>
          `;

          list.appendChild(item);
        });
      }
    }
  }

  // ==========================================
  // 6. CONTROL DE SESIÓN Y LOGOUT
  // ==========================================
  chrome.storage.local.get(['session_user', 'jwt_token', 'todaySeconds'], (res) => {
    if (res?.session_user?.id && res?.jwt_token) {
      usuarioAutenticado = res.session_user;
      jwtToken = res.jwt_token;
      todaySeconds = res.todaySeconds || 0;
      lastSyncedSeconds = todaySeconds;

      renderDashboard();
    } else {
      renderLogin();
    }
  });

  async function handleLogout() {
    if (timerInterval) clearInterval(timerInterval);

    // 🛡️ Fix #6: Sync final con await para no perder segundos al cerrar sesión
    if (usuarioAutenticado?.id && todaySeconds > lastSyncedSeconds) {
      const targetHours = usuarioAutenticado.horas_totales_objetivo || 480;
      await syncHoursToBackend(targetHours, todaySeconds);
    }

    chrome.runtime.sendMessage({ type: 'PANEL_INACTIVE', employeeId: usuarioAutenticado?.id });
    chrome.storage.local.remove(['session_user', 'jwt_token', 'todaySeconds', 'turnoActivo', 'inicioTurnoTimestamp'], () => {
      usuarioAutenticado = null;
      jwtToken = null;
      renderLogin();
    });
  }


  // 🛡️ Fix #4: Avisar a background.js que el panel se cerró para que retome el conteo
  window.addEventListener('beforeunload', () => {
    chrome.runtime.sendMessage({ type: 'PANEL_INACTIVE', employeeId: usuarioAutenticado?.id });
  });
});