import { useEffect, useState } from 'react';
import { api, fmtDate, today } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Empty, Field, Modal, PageHead, useLoad, useToast, ActionMenu } from '../components/ui.jsx';

const EMPTY = { title: '', description: '', status: 'todo', priority: 'medium', due_date: '', assigned_to: '' };
const STATUS_TABS = [
  ['open', 'Open'],
  ['todo', 'To do'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
  ['cancelled', 'Cancelled'],
  ['', 'All'],
];

function TaskForm({ initial, team, currentUserId, onSaved, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({
    ...EMPTY,
    ...(initial || {}),
    assigned_to: initial?.assigned_to != null ? String(initial.assigned_to) : String(currentUserId || ''),
    due_date: initial?.due_date || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return toast('Enter a task title', 'error');
    setSaving(true);
    try {
      const body = {
        title: f.title.trim(),
        description: f.description,
        status: f.status,
        priority: f.priority,
        due_date: f.due_date || null,
        assigned_to: f.assigned_to ? Number(f.assigned_to) : null,
      };
      const t = initial?.id ? await api.put(`/tasks/${initial.id}`, body) : await api.post('/tasks', body);
      toast(initial?.id ? 'Task updated' : 'Task created');
      onSaved(t);
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={save}>
      <div className="form-grid">
        <Field label="Title *" span={2}><input required autoFocus value={f.title} onChange={set('title')} placeholder="What needs to be done?" /></Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Priority">
          <select value={f.priority} onChange={set('priority')}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </Field>
        <Field label="Due date"><input type="date" value={f.due_date || ''} onChange={set('due_date')} /></Field>
        <Field label="Assigned to">
          <select value={f.assigned_to} onChange={set('assigned_to')}>
            <option value="">Unassigned</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Notes" span={2}><textarea rows={4} value={f.description || ''} onChange={set('description')} placeholder="Details, checklist, links…" /></Field>
      </div>
      <div className="modal-foot inline-foot">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save task'}</button>
      </div>
    </form>
  );
}

export default function Tasks() {
  const toast = useToast();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('open');
  const [mine, setMine] = useState(false);
  const [edit, setEdit] = useState(null);
  const [team, setTeam] = useState([]);

  useEffect(() => { api.get('/auth/users').then(setTeam).catch(() => {}); }, []);

  const { data, reload } = useLoad(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (mine) params.set('mine', '1');
    return api.get(`/tasks?${params}`);
  }, [q, status, mine]);

  const tasks = data?.tasks || [];
  const counts = data?.counts || {};

  const setStatusQuick = async (t, next) => {
    try {
      await api.post(`/tasks/${t.id}/status`, { status: next });
      toast(next === 'done' ? 'Marked done' : `Moved to ${next.replace(/_/g, ' ')}`);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const del = async (t) => {
    if (!confirm(`Delete task “${t.title}”?`)) return;
    try {
      await api.del(`/tasks/${t.id}`);
      toast('Task deleted');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="Tasks" sub="Write down work, assign it, and track it to done">
        <button className="btn btn-primary" onClick={() => setEdit({})}>+ New task</button>
      </PageHead>

      <div className="task-stats">
        <div className="task-stat"><b>{counts.open || 0}</b><span>Open</span></div>
        <div className="task-stat"><b>{counts.in_progress || 0}</b><span>In progress</span></div>
        <div className="task-stat warn"><b>{counts.overdue || 0}</b><span>Overdue</span></div>
        <div className="task-stat ok"><b>{counts.done || 0}</b><span>Done</span></div>
      </div>

      <div className="tabs">
        {STATUS_TABS.map(([k, label]) => (
          <button key={k || 'all'} type="button" className={`tab${status === k ? ' active' : ''}`} onClick={() => setStatus(k)}>
            {label}{k === 'open' && counts.open != null ? ` (${counts.open})` : ''}
          </button>
        ))}
      </div>

      <div className="filters">
        <input className="search" placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
      </div>

      <div className="card no-pad">
        {!data ? <p className="pad muted">Loading…</p> : tasks.length === 0 ? (
          <Empty title="No tasks yet">Add a task to keep follow-ups, reminders, and team work in one place.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Task</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th>Assignee</th>
                  <th>Status</th>
                  <th className="row-actions-head">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const overdue = !!Number(t.is_overdue);
                  return (
                    <tr key={t.id} className={t.status === 'done' ? 'task-row-done' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={t.status === 'done'}
                          title={t.status === 'done' ? 'Reopen' : 'Mark done'}
                          onChange={() => setStatusQuick(t, t.status === 'done' ? 'todo' : 'done')}
                          aria-label={t.status === 'done' ? 'Reopen task' : 'Mark done'}
                        />
                      </td>
                      <td>
                        <button type="button" className="linkish" onClick={() => setEdit(t)}><b>{t.title}</b></button>
                        {t.description && <div className="muted small task-desc">{t.description}</div>}
                        <div className="muted small">Created by {t.creator_name || '—'}{t.created_at ? ` · ${fmtDate(String(t.created_at).slice(0, 10))}` : ''}</div>
                      </td>
                      <td><span className={`prio prio-${t.priority}`}>{t.priority}</span></td>
                      <td className={`nowrap${overdue ? ' text-danger' : ''}`}>
                        {t.due_date ? fmtDate(t.due_date) : '—'}
                        {overdue && <div className="small text-danger">Overdue</div>}
                        {!overdue && t.due_date === today() && <div className="small muted">Due today</div>}
                      </td>
                      <td>{t.assignee_name || <span className="muted">Unassigned</span>}</td>
                      <td><Badge status={t.status} overdue={overdue && t.status !== 'done'} /></td>
                      <td className="row-actions">
                        <ActionMenu items={[
                          { label: 'Edit', onClick: () => setEdit(t) },
                          t.status !== 'in_progress' && { label: 'Start', onClick: () => setStatusQuick(t, 'in_progress') },
                          t.status !== 'done' && { label: 'Mark done', onClick: () => setStatusQuick(t, 'done') },
                          t.status === 'done' && { label: 'Reopen', onClick: () => setStatusQuick(t, 'todo') },
                          t.status !== 'cancelled' && { label: 'Cancel', onClick: () => setStatusQuick(t, 'cancelled') },
                          { label: 'Delete', danger: true, onClick: () => del(t) },
                        ].filter(Boolean)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edit && (
        <Modal title={edit.id ? 'Edit task' : 'New task'} onClose={() => setEdit(null)} wide>
          <TaskForm
            initial={edit.id ? edit : null}
            team={team}
            currentUserId={user?.id}
            onCancel={() => setEdit(null)}
            onSaved={() => { setEdit(null); reload(); }}
          />
        </Modal>
      )}
    </>
  );
}
