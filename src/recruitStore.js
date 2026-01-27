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
      approval_message_id TEXT,
      first_race TEXT,
      first_farm TEXT,
      first_dismantle TEXT,
      kit_delivered BOOLEAN NOT NULL DEFAULT FALSE,
      kit_delivered_by TEXT,
      kit_delivered_at TIMESTAMPTZ
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
    firstRace: row.first_race,
    firstFarm: row.first_farm,
    firstDismantle: row.first_dismantle,
    kitDelivered: row.kit_delivered,
    kitDeliveredBy: row.kit_delivered_by,
    kitDeliveredAt: row.kit_delivered_at,
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

async function updateRecruitStatus(id, { status, approvedBy, rejectedBy, rejectReason, firstRace, firstFarm, firstDismantle }) {
  if (!useDb || !pool) {
    const all = readFileSafe();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const now = new Date().toISOString();
    if (status === 'approved') {
      all[idx].status = 'approved';
      all[idx].approvedBy = approvedBy;
      all[idx].approvedAt = now;
      all[idx].firstRace = firstRace || null;
      all[idx].firstFarm = firstFarm || null;
      all[idx].firstDismantle = firstDismantle || null;
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
            approved_at = $3,
            first_race = $4,
            first_farm = $5,
            first_dismantle = $6
        WHERE id = $1
      `,
      [id, approvedBy, now, firstRace || null, firstFarm || null, firstDismantle || null],
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

async function markKitDelivered(id, deliveredBy) {
  if (!useDb || !pool) {
    const all = readFileSafe();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    all[idx].kitDelivered = true;
    all[idx].kitDeliveredBy = deliveredBy;
    all[idx].kitDeliveredAt = new Date().toISOString();
    writeFileSafe(all);
    return all[idx];
  }

  await ensureTable();
  const now = new Date().toISOString();
  await pool.query(
    `
      UPDATE recruits
      SET kit_delivered = TRUE,
          kit_delivered_by = $2,
          kit_delivered_at = $3
      WHERE id = $1
    `,
    [id, deliveredBy, now],
  );

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

async function adjustRankingPoints(recruiterId, quantity, adjustedBy) {
  // Cria registros "fantasma" para ajustar o ranking
  // Se quantity > 0, adiciona pontos; se < 0, remove pontos
  const absQuantity = Math.abs(quantity);
  const isAdding = quantity > 0;

  if (!useDb || !pool) {
    // Para modo arquivo, não fazemos ajuste manual
    console.warn('Ajuste manual de ranking não suportado em modo arquivo');
    return { success: false, message: 'Ajuste manual requer banco de dados' };
  }

  await ensureTable();
  const now = new Date().toISOString();

  if (isAdding) {
    // Adiciona pontos: cria registros "fantasma" aprovados
    for (let i = 0; i < absQuantity; i++) {
      const id = generateId();
      await pool.query(
        `
          INSERT INTO recruits (
            id, recruiter_id, candidate_id, candidate_name,
            phone, passport, status, created_at,
            approved_by, approved_at,
            blacklist_flag, approval_channel_id, approval_message_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `,
        [
          id,
          recruiterId,
          'manual_adjustment',
          `Ajuste manual (${adjustedBy})`,
          'N/A',
          'N/A',
          'approved',
          now,
          adjustedBy,
          now,
          false,
          null,
          null,
        ],
      );
    }
  } else {
    // Remove pontos: marca registros aprovados como rejeitados (começando pelos mais antigos)
    const { rows } = await pool.query(
      `
        SELECT id FROM recruits
        WHERE recruiter_id = $1
          AND status = 'approved'
          AND candidate_id = 'manual_adjustment'
        ORDER BY approved_at ASC
        LIMIT $2
      `,
      [recruiterId, absQuantity],
    );

    if (rows.length < absQuantity) {
      // Se não há ajustes manuais suficientes, busca recrutamentos normais
      const { rows: normalRows } = await pool.query(
        `
          SELECT id FROM recruits
          WHERE recruiter_id = $1
            AND status = 'approved'
          ORDER BY approved_at ASC
          LIMIT $2
        `,
        [recruiterId, absQuantity - rows.length],
      );
      rows.push(...normalRows);
    }

    for (const row of rows) {
      await pool.query(
        `
          UPDATE recruits
          SET status = 'rejected',
              rejected_by = $2,
              rejected_at = $3,
              reject_reason = 'Removido manualmente do ranking'
          WHERE id = $1
        `,
        [row.id, adjustedBy, now],
      );
    }
  }

  return { success: true, message: `${isAdding ? 'Adicionados' : 'Removidos'} ${absQuantity} ponto(s) do ranking` };
}

module.exports = {
  generateId,
  addRecruit,
  updateRecruitStatus,
  getRecruitById,
  getRecruitRanking,
  markKitDelivered,
  adjustRankingPoints,
};

