// src/utils/routineFamily.js
import { DateTime } from "luxon";
import cron from "node-cron";
import { ObjectId } from "mongodb";

/**
 * Módulo de Rotina & Casa (reminders, chores, shopping lists, menus, reports)
 * - Usa collections MongoDB: reminders, chores, shoppingLists, familyGoals, menus, dailyReports
 * - Roda um cron a cada minuto para enviar lembretes/alertas vencidos
 */

let _db;
let _sendMessage;
let cronTask = null;

export function initRoutineFamily(db, sendMessage) {
  _db = db;
  _sendMessage = sendMessage;

  // garante índices simples
  _db.collection("reminders").createIndex({ userId: 1, dueAt: 1 });
  _db.collection("chores").createIndex({ userId: 1, nextRun: 1 });
  _db.collection("shoppingLists").createIndex({ userId: 1 });

  // Cron que roda a cada minuto e dispara lembretes e tarefas recorrentes
  if (!cronTask) {
    cronTask = cron.schedule("* * * * *", async () => {
      try {
        const nowISO = DateTime.now().toISO();

        // Reminders pontuais vencidos e não enviados
        const due = await _db.collection("reminders")
          .find({ sent: { $ne: true }, dueAt: { $lte: nowISO } })
          .toArray();

        for (const r of due) {
          await _sendMessage(r.userId, `⏰ Lembrete: ${r.text}`);
          await _db.collection("reminders").updateOne({ _id: r._id }, { $set: { sent: true, deliveredAt: new Date() }});
        }

        // Chores recorrentes
        const chores = await _db.collection("chores")
          .find({ active: true, nextRun: { $lte: nowISO } })
          .toArray();

        for (const c of chores) {
          await _sendMessage(c.userId, `🧹 Tarefa: ${c.name} — ${c.note || ""}`);
          const next = DateTime.fromISO(c.nextRun).plus({ days: c.intervalDays || 7 }).toISO();
          await _db.collection("chores").updateOne({ _id: c._id }, { $set: { lastRun: new Date(), nextRun: next }});
        }
      } catch (err) {
        console.error("❌ routineFamily cron error:", err.message || err);
      }
    });
    console.log("✅ routineFamily cron iniciado");
  }
}

/* -------------------- Helpers -------------------- */

function parseRelativeTime(text) {
  text = (text || "").toLowerCase();

  // daqui X horas/minutos
  let m = text.match(/daqui\s+(\d+)\s*(hora|minuto|horas|minutos)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (/min/i.test(m[2])) return DateTime.now().plus({ minutes: n }).toISO();
    return DateTime.now().plus({ hours: n }).toISO();
  }

  // amanhã às HH[:MM]
  m = text.match(/amanh[ãa]\s*(às|as)?\s*(\d{1,2})([:h](\d{1,2}))?/i);
  if (m) {
    const h = parseInt(m[2], 10);
    const min = m[4] ? parseInt(m[4], 10) : 0;
    return DateTime.now().plus({ days: 1 }).set({ hour: h, minute: min, second: 0 }).toISO();
  }

  // hoje às HH
  m = text.match(/hoje\s*(às|as)?\s*(\d{1,2})([:h](\d{1,2}))?/i);
  if (m) {
    const h = parseInt(m[2], 10);
    const min = m[4] ? parseInt(m[4], 10) : 0;
    return DateTime.now().set({ hour: h, minute: min, second: 0 }).toISO();
  }

  // dia da semana
  m = text.match(/(domingo|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado)\s*(às|as)?\s*(\d{1,2})([:h](\d{1,2}))?/i);
  if (m) {
    const names = { domingo: 7, segunda: 1, terca: 2, terça: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, sábado: 6 };
    const target = names[m[1]];
    const h = parseInt(m[3], 10);
    const min = m[5] ? parseInt(m[5], 10) : 0;
    let dt = DateTime.now();
    const delta = (target - dt.weekday + 7) % 7 || 7;
    dt = dt.plus({ days: delta }).set({ hour: h, minute: min, second: 0 });
    return dt.toISO();
  }

  // dd/mm ou dd/mm/aaaa
  m = text.match(/(\d{1,2})\/(\d{1,2})(\/(\d{4}))?/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const year = m[4] ? parseInt(m[4], 10) : DateTime.now().year;
    const dt = DateTime.fromObject({ year, month: mo, day: d, hour: 12, minute: 0 }).setZone(DateTime.now().zone);
    if (dt.isValid) return dt.toISO();
  }

  return null;
}

/* -------------------- CRUD Reminders -------------------- */

export async function createReminder(userId, text, whenText, meta = {}) {
  if (!_db) throw new Error("routineFamily não inicializado");

  let dueISO = parseRelativeTime(whenText);
  if (!dueISO) {
    const dt = DateTime.fromISO(whenText, { zone: DateTime.now().zone });
    dueISO = dt.isValid ? dt.toISO() : DateTime.now().toISO();
  }

  const doc = { userId, text, whenText: whenText || "", dueAt: dueISO, createdAt: new Date(), sent: false, meta };
  const r = await _db.collection("reminders").insertOne(doc);
  return { ok: true, id: r.insertedId, dueAt: dueISO };
}

/* -------------------- Shopping Lists -------------------- */

export async function createShoppingList(userId, name = "Lista", items = []) {
  const doc = { userId, name, items: items.map(i => ({ text: i, checked: false })), createdAt: new Date() };
  const r = await _db.collection("shoppingLists").insertOne(doc);
  return r.insertedId;
}

export async function addItemToShoppingList(userId, listId, item) {
  await _db.collection("shoppingLists").updateOne({ _id: new ObjectId(listId), userId }, { $push: { items: { text: item, checked: false } }});
}

export async function getShoppingLists(userId) {
  return await _db.collection("shoppingLists").find({ userId }).toArray();
}

export async function removeItemFromList(userId, listId, index) {
  const lists = await _db.collection("shoppingLists").find({ userId }).toArray();
  // Implementação simples pelo índice, pode melhorar futuramente
}

/* -------------------- Chores -------------------- */

export async function addChore(userId, name, intervalDays = 7, note = "") {
  const nextRun = DateTime.now().toISO();
  const doc = { userId, name, intervalDays, note, nextRun, active: true, createdAt: new Date() };
  const r = await _db.collection("chores").insertOne(doc);
  return r.insertedId;
}

export async function listChores(userId) {
  return await _db.collection("chores").find({ userId }).sort({ nextRun: 1 }).toArray();
}

/* -------------------- Menus -------------------- */

export async function saveWeeklyMenu(userId, weekKey, menuObj) {
  await _db.collection("menus").updateOne({ userId, weekKey }, { $set: { menu: menuObj, updatedAt: new Date() }}, { upsert: true });
}

/* -------------------- Relatório Diário -------------------- */

export async function createDailyReport(userId, reportText) {
  await _db.collection("dailyReports").insertOne({ userId, reportText, createdAt: new Date() });
}
