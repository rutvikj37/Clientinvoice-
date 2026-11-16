const router = require('express').Router();
const { db, logActivity } = require('../db');
const { HttpError, today } = require('../services/util');

const STATUSES = new Set(['todo', 'in_progress', 'done', 'cancelled']);
const PRIORITIES = new Set(['low', 'medium', 'high']);

async function getTask(companyId, id) {
  return db.prepare(`SELECT t.*,
      a.name AS assignee_name, a.email AS assignee_email,
      c.name AS creator_name
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assigned_to
    LEFT JOIN users c ON c.id = t.created_by
    WHERE t.id = ? AND t.company_id = ?`).get(id, companyId);
}

async function assertAssignee(companyId, userId) {
  if (userId == null || userId === '') return null;
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid assignee');
  const u = await db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(id, companyId);
  if (!u) throw new HttpError(400, 'Assignee must be a team member');
  return id;
}

function cleanBody(body = {}) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim() || null;
  const status = String(body.status || 'todo');
  const priority = String(body.priority || 'medium');
  const due_date = body.due_date ? String(body.due_date).slice(0, 10) : null;
  if (!STATUSES.has(status)) throw new HttpError(400, 'Invalid status');
  if (!PRIORITIES.has(priority)) throw new HttpError(400, 'Invalid priority');
  return { title, description, status, priority, due_date };
}

router.get('/', async (req, res) => {
  const params = [req.companyId];
  let where = 't.company_id = ?';
  const q = String(req.query.q || '').trim();
  if (q) {
    where += ' AND (t.title LIKE ? OR IFNULL(t.description,\'\') LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (req.query.status && STATUSES.has(String(req.query.status))) {
    where += ' AND t.status = ?';
    params.push(req.query.status);
  } else if (req.query.status === 'open') {
    where += " AND t.status IN ('todo','in_progress')";
  }
  if (req.query.priority && PRIORITIES.has(String(req.query.priority))) {
    where += ' AND t.priority = ?';
    params.push(req.query.priority);
  }
  if (req.query.mine === '1') {
    where += ' AND t.assigned_to = ?';
    params.push(req.user.id);
  } else if (req.query.assigned_to) {
    where += ' AND t.assigned_to = ?';
    params.push(Number(req.query.assigned_to));
  }
  if (req.query.overdue === '1') {
    where += " AND t.due_date IS NOT NULL AND t.due_date < ? AND t.status IN ('todo','in_progress')";
    params.push(today());
  }

  const rows = await db.prepare(`SELECT t.*,
      a.name AS assignee_name, c.name AS creator_name,
      CASE WHEN t.due_date IS NOT NULL AND t.due_date < ? AND t.status IN ('todo','in_progress') THEN 1 ELSE 0 END AS is_overdue
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assigned_to
    LEFT JOIN users c ON c.id = t.created_by
    WHERE ${where}
    ORDER BY
      CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
      CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date ASC,
      t.id DESC`).all(today(), ...params);

  const counts = await db.prepare(`SELECT
      SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? AND status IN ('todo','in_progress') THEN 1 ELSE 0 END) AS overdue
    FROM tasks WHERE company_id = ?`).get(today(), req.companyId);

  res.json({
    tasks: rows,
    counts: {
      todo: Number(counts?.todo || 0),
      in_progress: Number(counts?.in_progress || 0),
      done: Number(counts?.done || 0),
      cancelled: Number(counts?.cancelled || 0),
      overdue: Number(counts?.overdue || 0),
      open: Number(counts?.todo || 0) + Number(counts?.in_progress || 0),
    },
  });
});

router.get('/:id', async (req, res) => {
  const t = await getTask(req.companyId, req.params.id);
  if (!t) throw new HttpError(404, 'Task not found');
  res.json(t);
});

router.post('/', async (req, res) => {
  const d = cleanBody(req.body);
  if (!d.title) throw new HttpError(400, 'Task title is required');
  const assigned_to = await assertAssignee(req.companyId, req.body.assigned_to ?? req.user.id);
  const completed_at = d.status === 'done' ? today() : null;
  const r = await db.prepare(`INSERT INTO tasks
    (company_id, title, description, status, priority, due_date, assigned_to, created_by, completed_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(req.companyId, d.title, d.description, d.status, d.priority, d.due_date, assigned_to, req.user.id, completed_at);
  await logActivity(req.companyId, 'task', r.lastInsertRowid, 'created', d.title, req.user.id);
  res.json(await getTask(req.companyId, r.lastInsertRowid));
});

router.put('/:id', async (req, res) => {
  const existing = await getTask(req.companyId, req.params.id);
  if (!existing) throw new HttpError(404, 'Task not found');
  const d = cleanBody({ ...existing, ...req.body });
  if (!d.title) throw new HttpError(400, 'Task title is required');
  const assigned_to = await assertAssignee(req.companyId, req.body.assigned_to !== undefined ? req.body.assigned_to : existing.assigned_to);
  let completed_at = existing.completed_at;
  if (d.status === 'done' && existing.status !== 'done') completed_at = today();
  if (d.status !== 'done') completed_at = null;
  await db.prepare(`UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?,
      assigned_to = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND company_id = ?`)
    .run(d.title, d.description, d.status, d.priority, d.due_date, assigned_to, completed_at, req.params.id, req.companyId);
  await logActivity(req.companyId, 'task', existing.id, 'updated', d.title, req.user.id);
  res.json(await getTask(req.companyId, req.params.id));
});

router.post('/:id/status', async (req, res) => {
  const existing = await getTask(req.companyId, req.params.id);
  if (!existing) throw new HttpError(404, 'Task not found');
  const status = String(req.body?.status || '');
  if (!STATUSES.has(status)) throw new HttpError(400, 'Invalid status');
  let completed_at = existing.completed_at;
  if (status === 'done' && existing.status !== 'done') completed_at = today();
  if (status !== 'done') completed_at = null;
  await db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?')
    .run(status, completed_at, req.params.id, req.companyId);
  await logActivity(req.companyId, 'task', existing.id, 'status', status, req.user.id);
  res.json(await getTask(req.companyId, req.params.id));
});

router.delete('/:id', async (req, res) => {
  const existing = await getTask(req.companyId, req.params.id);
  if (!existing) throw new HttpError(404, 'Task not found');
  await db.prepare('DELETE FROM tasks WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
  await logActivity(req.companyId, 'task', existing.id, 'deleted', existing.title, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
