(function () {
  const CSV_COLUMNS = [
    'id',
    'title',
    'date',
    'deadline',
    'status',
    'priority',
    'difficulty',
    'project',
    'notes',
    'tags',
    'subtasks',
    'recurrence',
    'alertLevel',
    'metadata'
  ];

  const ACTIVE_STATUSES = ['Em Andamento', 'Recorrente'];
  const STORAGE_KEY = 'taskmaster-drive-csv-state';
  const FILE_KEY = 'taskmaster-drive-csv-file-id';

  const config = window.TASKMASTER_CONFIG || {};
  const state = {
    accessToken: '',
    tokenClient: null,
    fileId: localStorage.getItem(FILE_KEY) || '',
    fileName: '',
    tasks: [],
    dirty: false,
    filters: {
      project: 'Todos',
      status: 'Aberta',
      search: ''
    }
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', () => {
    bindElements();
    bindEvents();
    restoreLocalState();
    syncFileInput();
    render();
  });

  function bindElements() {
    [
      'connectDriveBtn',
      'createCsvBtn',
      'loadCsvBtn',
      'saveCsvBtn',
      'importLocalBtn',
      'exportLocalBtn',
      'localCsvInput',
      'fileIdInput',
      'openByIdBtn',
      'fileStatus',
      'saveStatus',
      'projectFilter',
      'statusFilter',
      'searchInput',
      'newTaskBtn',
      'taskList',
      'openCount',
      'reserveCount',
      'todayCount',
      'lateCount',
      'taskDialog',
      'taskForm',
      'dialogTitle',
      'closeDialogBtn',
      'cancelDialogBtn',
      'deleteTaskBtn',
      'taskId',
      'taskTitle',
      'taskProject',
      'projectOptions',
      'taskStatus',
      'taskDate',
      'taskDeadline',
      'taskPriority',
      'taskDifficulty',
      'taskNotes',
      'toast'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.connectDriveBtn.addEventListener('click', connectDrive);
    els.createCsvBtn.addEventListener('click', createCsvOnDrive);
    els.loadCsvBtn.addEventListener('click', loadCsvFromDrive);
    els.saveCsvBtn.addEventListener('click', saveCsvToDrive);
    els.importLocalBtn.addEventListener('click', () => els.localCsvInput.click());
    els.exportLocalBtn.addEventListener('click', exportCsvLocal);
    els.localCsvInput.addEventListener('change', importCsvLocal);
    els.openByIdBtn.addEventListener('click', openFileById);
    els.fileIdInput.addEventListener('change', syncFileFromInput);
    els.projectFilter.addEventListener('change', () => {
      state.filters.project = els.projectFilter.value;
      renderTasks();
    });
    els.statusFilter.addEventListener('change', () => {
      state.filters.status = els.statusFilter.value;
      renderTasks();
    });
    els.searchInput.addEventListener('input', () => {
      state.filters.search = els.searchInput.value;
      renderTasks();
    });
    els.newTaskBtn.addEventListener('click', () => openTaskDialog());
    els.closeDialogBtn.addEventListener('click', closeDialog);
    els.cancelDialogBtn.addEventListener('click', closeDialog);
    els.deleteTaskBtn.addEventListener('click', deleteCurrentTask);
    els.taskForm.addEventListener('submit', saveTaskFromDialog);
  }

  function connectDrive() {
    if (!config.googleClientId || config.googleClientId === 'COLE_SEU_CLIENT_ID_AQUI') {
      showToast('Configure o Google Client ID em config.js.');
      return;
    }

    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      showToast('Biblioteca do Google ainda carregando. Tente novamente em alguns segundos.');
      return;
    }

    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: config.driveScope || 'https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (response.error) {
          showToast('Falha ao conectar com Google Drive.');
          return;
        }
        state.accessToken = response.access_token;
        setDriveButtons(true);
        showToast('Drive conectado.');
      }
    });

    state.tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  function setDriveButtons(enabled) {
    els.createCsvBtn.disabled = !enabled;
    els.openByIdBtn.disabled = !enabled;
    els.loadCsvBtn.disabled = !enabled || !state.fileId;
    els.saveCsvBtn.disabled = !enabled || !state.fileId;
    renderSaveStatus();
  }

  async function createCsvOnDrive() {
    try {
      const csv = tasksToCsv(state.tasks);
      const fileName = config.defaultCsvName || 'taskmaster-drive.csv';
      const boundary = 'taskmaster_' + Date.now();
      const metadata = {
        name: fileName,
        mimeType: 'text/csv'
      };
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        'Content-Type: text/csv; charset=UTF-8',
        '',
        csv,
        `--${boundary}--`
      ].join('\r\n');

      const result = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,modifiedTime', {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      });

      state.fileId = result.id;
      state.fileName = result.name;
      state.dirty = false;
      localStorage.setItem(FILE_KEY, state.fileId);
      syncFileInput();
      setDriveButtons(true);
      showToast('CSV criado no Drive.');
    } catch (error) {
      handleDriveError(error);
    }
  }

  async function openFileById() {
    syncFileFromInput();
    if (!state.fileId) {
      showToast('Informe o ID do arquivo CSV.');
      return;
    }
    await loadCsvFromDrive();
  }

  function syncFileFromInput() {
    state.fileId = els.fileIdInput.value.trim();
    if (state.fileId) localStorage.setItem(FILE_KEY, state.fileId);
    syncFileInput();
    setDriveButtons(Boolean(state.accessToken));
  }

  function syncFileInput() {
    els.fileIdInput.value = state.fileId || '';
    els.fileStatus.textContent = state.fileId
      ? `Arquivo conectado: ${state.fileName || state.fileId}`
      : 'Nenhum arquivo conectado.';
    renderSaveStatus();
  }

  function renderSaveStatus() {
    if (!els.saveStatus) return;
    els.saveStatus.textContent = state.dirty
      ? 'Alterações pendentes de salvar.'
      : 'Sem alterações pendentes.';
  }

  async function loadCsvFromDrive() {
    if (!state.fileId) {
      showToast('Nenhum arquivo CSV conectado.');
      return;
    }

    try {
      const meta = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(state.fileId)}?fields=id,name,modifiedTime,webViewLink,mimeType`);
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(state.fileId)}?alt=media`, {
        headers: authHeaders()
      });
      if (!response.ok) throw await driveError(response);
      const csv = await response.text();
      state.tasks = csvToTasks(csv);
      state.fileName = meta.name;
      state.dirty = false;
      persistLocalState();
      syncFileInput();
      render();
      showToast('CSV carregado do Drive.');
    } catch (error) {
      handleDriveError(error);
    }
  }

  async function saveCsvToDrive() {
    if (!state.fileId) {
      showToast('Nenhum arquivo CSV conectado.');
      return;
    }

    try {
      await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(state.fileId)}?uploadType=media&fields=id,name,modifiedTime`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'text/csv; charset=UTF-8'
        },
        body: tasksToCsv(state.tasks)
      });
      state.dirty = false;
      persistLocalState();
      renderSaveStatus();
      showToast('CSV salvo no Drive.');
    } catch (error) {
      handleDriveError(error);
    }
  }

  function authHeaders(extra) {
    return {
      Authorization: `Bearer ${state.accessToken}`,
      ...(extra || {})
    };
  }

  async function driveFetch(url, options) {
    const request = options || {};
    const headers = authHeaders(request.headers);
    const response = await fetch(url, { ...request, headers });
    if (!response.ok) throw await driveError(response);
    return response.status === 204 ? null : response.json();
  }

  async function driveError(response) {
    let message = `Erro Google Drive (${response.status})`;
    try {
      const payload = await response.json();
      message = payload.error && payload.error.message ? payload.error.message : message;
    } catch (error) {
      message = await response.text();
    }
    return new Error(message);
  }

  function handleDriveError(error) {
    console.error(error);
    showToast(error.message || 'Erro ao acessar Google Drive.');
  }

  function restoreLocalState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      state.tasks = Array.isArray(saved.tasks) ? saved.tasks.map(normalizeTask) : [];
    } catch (error) {
      state.tasks = [];
    }
  }

  function persistLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: state.tasks }));
  }

  async function importCsvLocal() {
    const [file] = els.localCsvInput.files;
    if (!file) return;

    try {
      const csv = await file.text();
      state.tasks = csvToTasks(csv);
      state.fileName = file.name;
      state.fileId = '';
      state.dirty = true;
      localStorage.removeItem(FILE_KEY);
      persistLocalState();
      syncFileInput();
      setDriveButtons(Boolean(state.accessToken));
      render();
      showToast('CSV importado.');
    } catch (error) {
      console.error(error);
      showToast('Não foi possível importar o CSV.');
    } finally {
      els.localCsvInput.value = '';
    }
  }

  function exportCsvLocal() {
    const blob = new Blob([tasksToCsv(state.tasks)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = state.fileName || 'taskmaster-drive.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function render() {
    renderProjectControls();
    renderStats();
    renderTasks();
  }

  function renderProjectControls() {
    const projects = getProjects();
    els.projectFilter.innerHTML = [
      '<option value="Todos">Todos Projetos</option>',
      ...projects.map((project) => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`)
    ].join('');
    els.projectFilter.value = state.filters.project;
    els.projectOptions.innerHTML = projects.map((project) => `<option value="${escapeHtml(project)}"></option>`).join('');
  }

  function renderStats() {
    const today = todayStr();
    els.openCount.textContent = state.tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length;
    els.reserveCount.textContent = state.tasks.filter((task) => task.status === 'Reserva').length;
    els.todayCount.textContent = state.tasks.filter((task) => ACTIVE_STATUSES.includes(task.status) && task.date === today).length;
    els.lateCount.textContent = state.tasks.filter((task) => ACTIVE_STATUSES.includes(task.status) && task.date && task.date < today).length;
  }

  function renderTasks() {
    const search = state.filters.search.trim().toLowerCase();
    const visible = state.tasks
      .filter((task) => {
        const matchProject = state.filters.project === 'Todos' || task.project === state.filters.project;
        const matchStatus = state.filters.status === 'Todos'
          || (state.filters.status === 'Aberta' ? ACTIVE_STATUSES.includes(task.status) : task.status === state.filters.status);
        const matchSearch = !search || `${task.title} ${task.notes} ${task.project}`.toLowerCase().includes(search);
        return matchProject && matchStatus && matchSearch;
      })
      .sort(compareTasks);

    if (!visible.length) {
      els.taskList.innerHTML = '<div class="empty-state">Nenhuma tarefa encontrada.</div>';
      renderStats();
      return;
    }

    els.taskList.innerHTML = visible.map(renderTaskCard).join('');
    els.taskList.querySelectorAll('[data-edit-id]').forEach((button) => {
      button.addEventListener('click', () => openTaskDialog(button.dataset.editId));
    });
    els.taskList.querySelectorAll('[data-status-id]').forEach((select) => {
      select.addEventListener('change', () => {
        updateTask(select.dataset.statusId, { status: select.value });
      });
    });
    renderStats();
  }

  function renderTaskCard(task) {
    const classes = [
      'task-card',
      task.status === 'Reserva' ? 'reserve' : '',
      task.status === 'Concluída' ? 'done' : '',
      task.status === 'Cancelada' ? 'cancelled' : ''
    ].filter(Boolean).join(' ');

    const statusClass = task.status === 'Reserva'
      ? 'reserve'
      : task.status === 'Concluída'
        ? 'done'
        : task.status === 'Cancelada'
          ? 'cancelled'
          : 'open';

    return `
      <article class="${classes}">
        <header>
          <div>
            <div class="task-meta">
              <span>${escapeHtml(task.project || 'R&D')}</span>
              <span class="badge ${statusClass}">${escapeHtml(task.status)}</span>
            </div>
            <h2 class="task-title">${escapeHtml(task.title)}</h2>
          </div>
          <div class="task-actions">
            <select data-status-id="${escapeHtml(task.id)}" aria-label="Alterar status">
              ${statusOptionsHtml(task.status)}
            </select>
            <button data-edit-id="${escapeHtml(task.id)}">Editar</button>
          </div>
        </header>
        <div class="task-meta">
          <span>Execução: ${formatDate(task.date)}</span>
          <span>Deadline: ${formatDate(task.deadline)}</span>
          <span>Prioridade: ${task.priority || 1}/5</span>
          <span>Dificuldade: ${task.difficulty || 1}/5</span>
        </div>
        ${task.notes ? `<p>${escapeHtml(task.notes)}</p>` : ''}
      </article>
    `;
  }

  function statusOptionsHtml(current) {
    return ['Em Andamento', 'Reserva', 'Recorrente', 'Concluída', 'Cancelada']
      .map((status) => `<option ${status === current ? 'selected' : ''}>${status}</option>`)
      .join('');
  }

  function openTaskDialog(taskId) {
    const task = taskId ? state.tasks.find((item) => item.id === taskId) : null;
    els.dialogTitle.textContent = task ? 'Editar Tarefa' : 'Nova Tarefa';
    els.taskId.value = task ? task.id : '';
    els.taskTitle.value = task ? task.title : '';
    els.taskProject.value = task ? task.project : (getProjects()[0] || 'R&D');
    els.taskStatus.value = task ? task.status : 'Em Andamento';
    els.taskDate.value = task ? task.date : todayStr();
    els.taskDeadline.value = task ? task.deadline : '';
    els.taskPriority.value = task ? task.priority : 3;
    els.taskDifficulty.value = task ? task.difficulty : 3;
    els.taskNotes.value = task ? task.notes : '';
    els.deleteTaskBtn.hidden = !task;
    els.taskDialog.showModal();
  }

  function closeDialog() {
    els.taskDialog.close();
  }

  function saveTaskFromDialog(event) {
    event.preventDefault();
    const id = els.taskId.value || generateId();
    const task = normalizeTask({
      id,
      title: els.taskTitle.value.trim(),
      date: els.taskDate.value,
      deadline: els.taskDeadline.value,
      status: els.taskStatus.value,
      priority: parseInt(els.taskPriority.value, 10) || 1,
      difficulty: parseInt(els.taskDifficulty.value, 10) || 1,
      project: els.taskProject.value.trim() || 'R&D',
      notes: els.taskNotes.value.trim(),
      tags: [],
      subtasks: [],
      recurrence: { frequency: 'Nenhuma', daysOfWeek: [], daysOfMonth: [] },
      alertLevel: '',
      metadata: {}
    });

    const index = state.tasks.findIndex((item) => item.id === id);
    if (index >= 0) {
      state.tasks[index] = task;
    } else {
      state.tasks.push(task);
    }

    markDirty();
    persistLocalState();
    closeDialog();
    render();
  }

  function deleteCurrentTask() {
    const id = els.taskId.value;
    if (!id) return;
    if (!confirm('Excluir esta tarefa?')) return;
    state.tasks = state.tasks.filter((task) => task.id !== id);
    markDirty();
    persistLocalState();
    closeDialog();
    render();
  }

  function updateTask(id, changes) {
    state.tasks = state.tasks.map((task) => task.id === id ? normalizeTask({ ...task, ...changes }) : task);
    markDirty();
    persistLocalState();
    render();
  }

  function markDirty() {
    state.dirty = true;
    renderSaveStatus();
  }

  function normalizeTask(task) {
    return {
      id: task.id || generateId(),
      title: task.title || '',
      date: task.date || '',
      deadline: task.deadline || '',
      status: task.status === 'Pendente' ? 'Em Andamento' : (task.status || 'Em Andamento'),
      priority: Number(task.priority) || 1,
      difficulty: Number(task.difficulty) || 1,
      project: task.project || 'R&D',
      notes: task.notes || '',
      tags: Array.isArray(task.tags) ? task.tags : parseList(task.tags),
      subtasks: Array.isArray(task.subtasks) ? task.subtasks : parseJson(task.subtasks, []),
      recurrence: typeof task.recurrence === 'object' && task.recurrence
        ? task.recurrence
        : parseJson(task.recurrence, { frequency: 'Nenhuma', daysOfWeek: [], daysOfMonth: [] }),
      alertLevel: task.alertLevel || '',
      metadata: typeof task.metadata === 'object' && task.metadata ? task.metadata : parseJson(task.metadata, {})
    };
  }

  function compareTasks(a, b) {
    const dateCompare = (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31');
    if (dateCompare) return dateCompare;
    const statusCompare = statusWeight(a.status) - statusWeight(b.status);
    if (statusCompare) return statusCompare;
    return (a.title || '').localeCompare(b.title || '');
  }

  function statusWeight(status) {
    return {
      'Em Andamento': 1,
      Recorrente: 2,
      Reserva: 3,
      Concluída: 4,
      Cancelada: 5
    }[status] || 9;
  }

  function getProjects() {
    const projects = state.tasks.map((task) => task.project || 'R&D');
    return Array.from(new Set(['R&D', ...projects])).sort((a, b) => a.localeCompare(b));
  }

  function tasksToCsv(tasks) {
    return [
      CSV_COLUMNS.join(','),
      ...tasks.map((task) => CSV_COLUMNS.map((column) => csvEscape(serializeValue(task[column], column))).join(','))
    ].join('\r\n');
  }

  function csvToTasks(csv) {
    const rows = parseCsv(csv);
    if (!rows.length) return [];
    const header = rows[0].map((cell) => cell.trim());
    return rows.slice(1)
      .filter((row) => row.some((cell) => cell.trim()))
      .map((row) => {
        const task = {};
        header.forEach((column, index) => {
          task[column] = row[index] || '';
        });
        return normalizeTask(task);
      });
  }

  function serializeValue(value, column) {
    if (['subtasks', 'recurrence', 'metadata'].includes(column)) {
      return JSON.stringify(value || (column === 'subtasks' ? [] : {}));
    }
    if (column === 'tags') {
      return Array.isArray(value) ? value.join(', ') : (value || '');
    }
    return value == null ? '' : String(value);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (quoted) {
        if (char === '"' && next === '"') {
          value += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          value += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(value);
        value = '';
      } else if (char === '\n') {
        row.push(value);
        rows.push(row);
        row = [];
        value = '';
      } else if (char !== '\r') {
        value += char;
      }
    }

    row.push(value);
    rows.push(row);
    return rows;
  }

  function csvEscape(value) {
    const text = value == null ? '' : String(value);
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function parseList(value) {
    if (!value) return [];
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return 'sem data';
    const parts = value.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      els.toast.hidden = true;
    }, 3600);
  }
}());
