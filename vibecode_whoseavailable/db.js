/**
 * SQLite persistence layer for Who's Available / Big Schmooze.
 * Uses better-sqlite3 (synchronous, single-file, zero-config).
 * DB file: $STORAGE_DIR/schmooze.db (or ./data/schmooze.db locally).
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'data');
const DATA_DIR = path.join(STORAGE_DIR, 'db');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'schmooze.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---

db.exec(`
  CREATE TABLE IF NOT EXISTS topics (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    prompt     TEXT NOT NULL DEFAULT '',
    maxMinutes INTEGER NOT NULL DEFAULT 5,
    room       TEXT NOT NULL DEFAULT 'main',
    dueAt      INTEGER,
    createdBy  TEXT NOT NULL DEFAULT 'anon',
    createdAt  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS responses (
    id        TEXT PRIMARY KEY,
    topicId   TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    room      TEXT NOT NULL DEFAULT 'main',
    name      TEXT NOT NULL,
    tags      TEXT NOT NULL DEFAULT '',
    note      TEXT NOT NULL DEFAULT '',
    audioUrl  TEXT NOT NULL,
    duration  INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_topics_room ON topics(room);
  CREATE INDEX IF NOT EXISTS idx_responses_topic ON responses(topicId);
  CREATE INDEX IF NOT EXISTS idx_responses_room ON responses(room);
`);

// --- Prepared statements ---

const stmts = {
  insertTopic: db.prepare(`
    INSERT INTO topics (id, title, prompt, maxMinutes, room, dueAt, createdBy, createdAt)
    VALUES (@id, @title, @prompt, @maxMinutes, @room, @dueAt, @createdBy, @createdAt)
  `),
  getTopicsByRoom: db.prepare('SELECT * FROM topics WHERE room = ? ORDER BY createdAt DESC'),
  getTopicById: db.prepare('SELECT * FROM topics WHERE id = ?'),
  getRecentDuplicateTopic: db.prepare(`
    SELECT * FROM topics
    WHERE room = ?
      AND title = ?
      AND prompt = ?
      AND createdBy = ?
      AND createdAt >= ?
    ORDER BY createdAt DESC
    LIMIT 1
  `),
  deleteTopic: db.prepare('DELETE FROM topics WHERE id = ?'),

  insertResponse: db.prepare(`
    INSERT INTO responses (id, topicId, room, name, tags, note, audioUrl, duration, createdAt)
    VALUES (@id, @topicId, @room, @name, @tags, @note, @audioUrl, @duration, @createdAt)
  `),
  getResponsesByRoom: db.prepare('SELECT * FROM responses WHERE room = ? ORDER BY createdAt ASC'),
  getResponsesByRoomAndTopic: db.prepare('SELECT * FROM responses WHERE room = ? AND topicId = ? ORDER BY createdAt ASC'),
  deleteResponse: db.prepare('DELETE FROM responses WHERE id = ?'),
  getResponseById: db.prepare('SELECT * FROM responses WHERE id = ?'),
};

// --- Public API ---

module.exports = {
  // Topics
  insertTopic(topic) {
    stmts.insertTopic.run(topic);
    return topic;
  },
  getTopicsByRoom(room) {
    return stmts.getTopicsByRoom.all(room);
  },
  getTopicById(id) {
    return stmts.getTopicById.get(id);
  },
  getRecentDuplicateTopic(room, title, prompt, createdBy, since) {
    return stmts.getRecentDuplicateTopic.get(room, title, prompt, createdBy, since);
  },
  deleteTopic(id) {
    // CASCADE deletes responses too
    return stmts.deleteTopic.run(id);
  },

  // Responses
  insertResponse(resp) {
    stmts.insertResponse.run(resp);
    return resp;
  },
  getResponsesByRoom(room, topicId) {
    if (topicId) return stmts.getResponsesByRoomAndTopic.all(room, topicId);
    return stmts.getResponsesByRoom.all(room);
  },
  getResponseById(id) {
    return stmts.getResponseById.get(id);
  },
  deleteResponse(id) {
    return stmts.deleteResponse.run(id);
  },

  // For graceful shutdown
  close() {
    db.close();
  },
};
