const fs = require('fs');
const path = require('path');

// Modo 1: arquivo JSON (fallback local)
const DATA_PATH = path.join(__dirname, '..', 'blacklist-data.json');

// Modo 2: Postgres (para produção/Render)
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
    console.error('Erro ao configurar Postgres para blacklist:', err);
  }
}

// ---------- MODO ARQUIVO (fallback) ----------
function readFileSafe() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Erro ao ler blacklist-data.json:', err);
    return [];
  }
}

function writeFileSafe(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao escrever blacklist-data.json:', err);
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

async function ensureTable() {
  if (!useDb || !pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blacklists (
      id TEXT PRIMARY KEY,
      passport_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      motivo TEXT NOT NULL,
      author_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      removed BOOLEAN NOT NULL DEFAULT FALSE,
      removed_by TEXT,
      removed_at TIMESTAMPTZ,
      remove_reason TEXT
    );
  `);
}

async function getAllBlacklists() {
  if (!useDb || !pool) {
    // fallback para arquivo local
    return readFileSafe();
  }

  await ensureTable();
  const { rows } = await pool.query('SELECT * FROM blacklists ORDER BY created_at DESC');
  return rows.map(normalizeRow);
}

async function addBlacklistEntry({
  passportId,
  nome,
  motivo,
  authorId,
  guildId,
  channelId,
  messageId,
}) {
  const id = generateId();
  const createdAt = new Date();

  if (!useDb || !pool) {
    const all = readFileSafe();
    const entry = {
      id,
      passportId,
      nome,
      motivo,
      authorId,
      guildId,
      channelId,
      messageId,
      createdAt: createdAt.toISOString(),
      removed: false,
      removedBy: null,
      removedAt: null,
      removeReason: null,
    };
    all.push(entry);
    writeFileSafe(all);
    return entry;
  }

  await ensureTable();
  await pool.query(
    `
      INSERT INTO blacklists (
        id, passport_id, nome, motivo,
        author_id, guild_id, channel_id, message_id,
        created_at, removed, removed_by, removed_at, remove_reason
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `,
    [
      id,
      passportId,
      nome,
      motivo,
      authorId,
      guildId,
      channelId,
      messageId,
      createdAt.toISOString(),
      false,
      null,
      null,
      null,
    ],
  );

  return normalizeRow({
    id,
    passport_id: passportId,
    nome,
    motivo,
    author_id: authorId,
    guild_id: guildId,
    channel_id: channelId,
    message_id: messageId,
    created_at: createdAt.toISOString(),
    removed: false,
    removed_by: null,
    removed_at: null,
    remove_reason: null,
  });
}

async function markBlacklistRemoved(id, { removedBy, reason }) {
  const removedAt = new Date();

  if (!useDb || !pool) {
    const all = readFileSafe();
    const idx = all.findIndex((e) => e.id === id);
    if (idx === -1) {
      return null;
    }

    all[idx].removed = true;
    all[idx].removedBy = removedBy;
    all[idx].removedAt = removedAt.toISOString();
    all[idx].removeReason = reason;

    writeFileSafe(all);
    return all[idx];
  }

  await ensureTable();
  const { rowCount } = await pool.query(
    `
      UPDATE blacklists
      SET removed = TRUE,
          removed_by = $2,
          removed_at = $3,
          remove_reason = $4
      WHERE id = $1
    `,
    [id, removedBy, removedAt.toISOString(), reason],
  );

  if (rowCount === 0) return null;

  const { rows } = await pool.query('SELECT * FROM blacklists WHERE id = $1', [id]);
  return rows[0] ? normalizeRow(rows[0]) : null;
}

async function getBlacklistById(id) {
  if (!useDb || !pool) {
    const all = readFileSafe();
    return all.find((e) => e.id === id) || null;
  }

  await ensureTable();
  const { rows } = await pool.query('SELECT * FROM blacklists WHERE id = $1', [id]);
  return rows[0] ? normalizeRow(rows[0]) : null;
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    passportId: row.passport_id,
    nome: row.nome,
    motivo: row.motivo,
    authorId: row.author_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    createdAt: row.created_at,
    removed: row.removed,
    removedBy: row.removed_by,
    removedAt: row.removed_at,
    removeReason: row.remove_reason,
  };
}

module.exports = {
  getAllBlacklists,
  addBlacklistEntry,
  markBlacklistRemoved,
  getBlacklistById,
};

