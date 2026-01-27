const fs = require('fs');
const path = require('path');

// Fallback local em arquivo (para uso fora do Render, se não houver DATABASE_URL)
const DATA_PATH = path.join(__dirname, '..', 'recruits-data.json');

const useDb = !!process.env.DATABASE_URL;
let pool = null;

if (useDb) {
  try {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === 'false'
          ? false
          : {
              rejectUnauthorized: false,
            },
    });
  } catch (err) {
    console.error('Erro ao configurar Postgres para recruits:', err);
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ---------- Fallback arquivo ----------
function readFileSafe() {
  try {
    if (!fs.existsSync(DATA_PATH)) return [];
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Erro ao ler recruits-data.json:', err);
    return [];
  }
}

function writeFileSafe(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao escrever recruits-data.json:', err);
  }
}

async function ensureTable() {
  if (!useDb || !pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recruits (
      id TEXT PRIMARY KEY,
      recruiter_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      passport TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      rejected_by TEXT,
      rejected_at TIMESTAMPTZ,
      reject_reason TEXT,
      blacklist_flag BOOLEAN NOT NULL DEFAULT FALSE,
      blacklist_reason TEXT,
      approval_channel_id TEXT,
      approval_message_id TEXT
    );
  `);
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    recruiterId: row.recruiter_id,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name,
    phone: row.phone,
    passport: row.passport,
    status: row.status,
    createdAt: row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    rejectReason: row.reject_reason,
    blacklistFlag: row.blacklist_flag,
    blacklistReason: row.blacklist_reason,
    approvalChannelId: row.approval_channel_id,
    approvalMessageId: row.approval_message_id,
  };
}

async function addRecruit({
  id,
  recruiterId,
  candidateId,
  candidateName,
  phone,
  passport,
  blacklistFlag,
  blacklistReason,
  approvalChannelId,
  approvalMessageId,
}) {
  const finalId = id || generateId();
  const createdAt = new Date();

  if (!useDb || !pool) {
    const all = readFileSafe();
    const entry = {
      id: finalId,
      recruiterId,
      candidateId,
      candidateName,
      phone,
      passport,
      status: 'pending',
      createdAt: createdAt.toISOString(),
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      blacklistFlag: !!blacklistFlag,
      blacklistReason: blacklistReason || null,
      approvalChannelId,
      approvalMessageId,
    };
    all.push(entry);
    writeFileSafe(all);
    return entry;
  }

  await ensureTable();
  await pool.query(
    `
      INSERT INTO recruits (
        id, recruiter_id, candidate_id, candidate_name,
        phone, passport, status, created_at,
        approved_by, approved_at, rejected_by, rejected_at, reject_reason,
        blacklist_flag, blacklist_reason,
        approval_channel_id, approval_message_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    `,
    [
      finalId,
      recruiterId,
      candidateId,
      candidateName,
      phone,
      passport,
      'pending',
      createdAt.toISOString(),
      null,
      null,
      null,
      null,
      null,
      !!blacklistFlag,
      blacklistReason || null,
      approvalChannelId,
      approvalMessageId,
    ],
  );

  return {
    id: finalId,
    recruiterId,
    candidateId,
    candidateName,
    phone,
    passport,
    status: 'pending',
    createdAt: createdAt.toISOString(),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectReason: null,
    blacklistFlag: !!blacklistFlag,
    blacklistReason: blacklistReason || null,
    approvalChannelId,
    approvalMessageId,
  };
}

async function updateRecruitStatus(id, { status, approvedBy, rejectedBy, rejectReason }) {
  if (!useDb || !pool) {
    const all = readFileSafe();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const now = new Date().toISOString();
    if (status === 'approved') {
      all[idx].status = 'approved';
      all[idx].approvedBy = approvedBy;
      all[idx].approvedAt = now;
    } else if (status === 'rejected') {
      all[idx].status = 'rejected';
      all[idx].rejectedBy = rejectedBy;
      all[idx].rejectedAt = now;
      all[idx].rejectReason = rejectReason || null;
    }
    writeFileSafe(all);
    return all[idx];
  }

  await ensureTable();
  const now = new Date().toISOString();
  if (status === 'approved') {
    await pool.query(
      `
        UPDATE recruits
        SET status = 'approved',
            approved_by = $2,
            approved_at = $3
        WHERE id = $1
      `,
      [id, approvedBy, now],
    );
  } else if (status === 'rejected') {
    await pool.query(
      `
        UPDATE recruits
        SET status = 'rejected',
            rejected_by = $2,
            rejected_at = $3,
            reject_reason = $4
        WHERE id = $1
      `,
      [id, rejectedBy, now, rejectReason || null],
    );
  }

  const { rows } = await pool.query('SELECT * FROM recruits WHERE id = $1', [id]);
  return rows[0] ? normalizeRow(rows[0]) : null;
}

async function getRecruitById(id) {
  if (!useDb || !pool) {
    const all = readFileSafe();
    return all.find((r) => r.id === id) || null;
  }
  await ensureTable();
  const { rows } = await pool.query('SELECT * FROM recruits WHERE id = $1', [id]);
  return rows[0] ? normalizeRow(rows[0]) : null;
}

async function getRecruitRanking(limit = 10) {
  if (!useDb || !pool) {
    const all = readFileSafe();
    const counts = new Map();
    all
      .filter((r) => r.status === 'approved')
      .forEach((r) => {
        counts.set(r.recruiterId, (counts.get(r.recruiterId) || 0) + 1);
      });
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return entries.slice(0, limit).map(([recruiterId, total]) => ({ recruiterId, total }));
  }

  await ensureTable();
  const { rows } = await pool.query(
    `
      SELECT recruiter_id, COUNT(*) AS total
      FROM recruits
      WHERE status = 'approved'
      GROUP BY recruiter_id
      ORDER BY total DESC
      LIMIT $1
    `,
    [limit],
  );
  return rows.map((r) => ({ recruiterId: r.recruiter_id, total: Number(r.total) }));
}

module.exports = {
  generateId,
  addRecruit,
  updateRecruitStatus,
  getRecruitById,
  getRecruitRanking,
};

