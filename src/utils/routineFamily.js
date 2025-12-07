// src/utils/routineFamily.js
import { DateTime } from "luxon";
import cron from "node-cron";
import { ObjectId } from "mongodb";

/**
 * Módulo: rotinaFamily
 * - Lembretes (reminders), tarefas recorrentes (chores), listas de compras (shoppingLists),
 *   menus semanais e relatórios diários.
 * - Inicialize chamando initRoutineFamily(db, sendMessage)
 *   onde sendMessage(to, text) é a função que envia a mensagem (ex: WhatsApp).
 *
 * Observação: initRoutineFamily pode ser chamado sem sendMessage (útil para testes);
 * nesse caso o cron roda, mas não enviará mensagens (apenas log).
 */

let _db = null;
let _sendMessage = null;
let cronTask = null;

const ZONE = "America/Sao_Paulo"; // fuso horário padrão

export function initRoutineFamily(db, sendMessage) {
  if (!db) throw new Error("db é obrigatório para initRoutineFamily");
  _db = db;
  if (sendMessage) _sendMessage = sendMessage;

  // índices (não bloqueantes)
  try {
    _db.collection("reminders").createIndex({ userId: 1, dueAt: 1 });
    _db.collection("chores").createIndex({ userId: 1, nextRun: 1 });
    _db.collection("shoppingLists").createIndex({ userId: 1 });
  } catch (e) {
    console.warn("Não foi possível criar índices agora:", e.message || e);
  }

  // Cron que roda a cada minuto — apenas uma instância
  if (!cronTask) {
    cronTask = cron.schedule("* * * * *", async () => {
      try {
        const nowISO = DateTime.now().setZone(ZONE).toISO();

        // ----------------- Reminders pontuais -----------------
        const due = await _db
          .collection("reminders")
          .find({ sent: { $ne: true }, dueAt: { $lte: nowISO } })
          .toArray();

        for (const r of due) {
          if (_sendMessage) {
            await _sendMessage(r.userId, `⏰ Lembrete: ${r.text}`);
          } else {
            console.log(`[routineFamily] (simulação) enviar para ${r.userId}: ⏰ ${r.text}`);
          }
          await _db.collection("reminders").updateOne(
            { _id: r._id },
            { $set: { sent: true, deliveredAt: new Date() } }
          );
        }

        // ----------------- Chores (tarefas recorrentes) -----------------
        const chores = await _db
          .collection("chores")
          .find({ active: true, nextRun: { $lte: nowISO } })
          .toArray();

        for (const c of chores) {
          if (_sendMessage) {
            await _sendMessage(c.userId, `🧹 Tarefa: ${c.name}${c.note ? ` — ${c.note}` : ""}`);
          } else {
            console.log(`[routineFamily] (simulação) tarefa para ${c.userId}: ${c.name}`);
          }
          const next = DateTime.fromISO(c.nextRun).setZone(ZONE).plus({ days: c.intervalDays || 7 }).toISO();
          await _db.collection("chores").updateOne(
            { _id: c._id },
            { $set: { lastRun: new Date(), nextRun: next } }
          );
        }
      } catch (err) {
        console.error("❌ routineFamily cron error:", err.message || err);
      }
    });
    console.log("✅ routineFamily cron iniciado");
  }
}

/* -------------------- Helpers de Data -------------------- */
function parseRelativeTime(text) {
  text = (text || "").toLowerCase();
  let m;

  // "daqui X minutos/horas" ou "em X minutos/horas"
  m = text.match(/(?:daqui|em)\s+(\d+)\s*(hora|minuto|horas|minutos)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (/min/i.test(m[2])) return DateTime.now().setZone(ZONE).plus({ minutes: n }).toISO();
    return DateTime.now().setZone(ZONE).plus({ hours: n }).toISO();
  }

  // "amanhã às HH[:MM]"
  m = text.match(/amanh[ãa]\s*(?:às|as)?\s*(\d{1,2})(?:[:h](\d{1,2}))?/i);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    return DateTime.now().setZone(ZONE).plus({ days: 1 }).set({ hour: h, minute: min, second: 0 }).toISO();
  }

  // "hoje às HH[:MM]"
  m = text.match(/hoje\s*(?:às|as)?\s*(\d{1,2})(?:[:h](\d{1,2}))?/i);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    return DateTime.now().setZone(ZONE).set({ hour: h, minute: min, second: 0 }).toISO();
  }

  // Dias da semana (ex: quinta às 14h)
  m = text.match(/(domingo|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado)\s*(?:às|as)?\s*(\d{1,2})(?:[:h](\d{1,2}))?/i);
  if (m) {
    const names = { domingo: 7, segunda: 1, terca: 2, terça: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, sábado: 6 };
    const target = names[m[1]];
    const h = parseInt(m[2], 10);
    const min = m[3] ? parseInt(m[3], 10) : 0;
    let dt = DateTime.now().setZone(ZONE);
    const delta = (target - dt.weekday + 7) % 7 || 7;
    dt = dt.plus({ days: delta }).set({ hour: h, minute: min, second: 0 });
    return dt.toISO();
  }

  // dd/mm ou dd/mm/aaaa
  m = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const year = m[3] ? parseInt(m[3], 10) : DateTime.now().setZone(ZONE).year;
    const dt = DateTime.fromObject({ year, month: mo, day: d, hour: 12, minute: 0 }).setZone(ZONE);
    if (dt.isValid) return dt.toISO();
  }

  return null;
}

/* -------------------- CRUD Reminders -------------------- */
export async function createReminder(userId, text, whenText, meta = {}) {
  if (!_db) throw new Error("routineFamily não inicializado (chame initRoutineFamily)");
  let dueISO = parseRelativeTime(whenText);
  if (!dueISO) {
    // tenta interpretar como ISO ou string de data
    const dt = DateTime.fromISO(whenText).setZone(ZONE);
    dueISO = dt.isValid ? dt.toISO() : DateTime.now().setZone(ZONE).toISO();
  }
  const doc = { userId, text, whenText: whenText || "", dueAt: dueISO, createdAt: new Date(), sent: false, meta };
  const r = await _db.collection("reminders").insertOne(doc);
  return { ok: true, id: r.insertedId, dueAt: dueISO };
}

/* -------------------- Shopping Lists -------------------- */
export async function createShoppingList(userId, name = "Lista", items = []) {
  if (!_db) throw new Error("routineFamily não inicializado");
  const doc = { userId, name, items: items.map(i => ({ text: i, checked: false })), createdAt: new Date() };
  const r = await _db.collection("shoppingLists").insertOne(doc);
  return r.insertedId;
}

export async function addItemToShoppingList(userId, listId, item) {
  if (!_db) throw new Error("routineFamily não inicializado");
  const _id = typeof listId === "string" ? new ObjectId(listId) : listId;
  await _db.collection("shoppingLists").updateOne(
    { _id, userId },
    { $push: { items: { text: item, checked: false } } }
  );
}

export async function getShoppingLists(userId) {
  if (!_db) throw new Error("routineFamily não inicializado");
  return await _db.collection("shoppingLists").find({ userId }).toArray();
}

/* -------------------- Chores -------------------- */
export async function addChore(userId, name, intervalDays = 7, note = "") {
  if (!_db) throw new Error("routineFamily não inicializado");
  const nextRun = DateTime.now().setZone(ZONE).toISO();
  const doc = { userId, name, intervalDays, note, nextRun, active: true, createdAt: new Date() };
  const r = await _db.collection("chores").insertOne(doc);
  return r.insertedId;
}

export async function listChores(userId) {
  if (!_db) throw new Error("routineFamily não inicializado");
  return await _db.collection("chores").find({ userId }).sort({ nextRun: 1 }).toArray();
}

/* -------------------- Menus -------------------- */
export async function saveWeeklyMenu(userId, weekKey, menuObj) {
  if (!_db) throw new Error("routineFamily não inicializado");
  await _db.collection("menus").updateOne(
    { userId, weekKey },
    { $set: { menu: menuObj, updatedAt: new Date() } },
    { upsert: true }
  );
}

/* -------------------- Relatório Diário -------------------- */
export async function createDailyReport(userId, reportText) {
  if (!_db) throw new Error("routineFamily não inicializado");
  await _db.collection("dailyReports").insertOne({ userId, reportText, createdAt: new Date() });
}

/* -------------------- Comando de alto nível (parser de texto) -------------------- */
export async function handleCommand(text, from) {
  if (!_db) throw new Error("routineFamily não inicializado");
  const t = (text || "").toLowerCase();

  /* -------------------- LEMBRETES -------------------- */
  if (t.startsWith("me lembra") || t.startsWith("lembrete:") || t.includes("lembre me") || t.includes("não me deixe")) {
    const m = text.match(/(me lembra|lembrete:|não me deixe lembrar de|não me deixe esquecer de)\s*(.*)/i);
    const body = m ? m[2] : text;

    const whenMatch = body.match(/daqui.*|em.*|amanh.*|hoje.*|domingo|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|\d{1,2}\/\d{1,2}/i);
    const whenText = whenMatch ? whenMatch[0] : "daqui 1 hora";

    const textOnly = body.replace(whenText, "").trim() || body.trim();
    const created = await createReminder(from, textOnly, whenText);

    if (_sendMessage) {
      await _sendMessage(from, `✅ Lembrete criado para ${DateTime.fromISO(created.dueAt).setZone(ZONE).toFormat("dd/MM/yyyy HH:mm")}`);
    } else {
      console.log(`[routineFamily] Lembrete criado para ${from}: ${created.dueAt} -> ${textOnly}`);
    }
    return true;
  }

  /* -------------------- LISTAS DE COMPRAS -------------------- */
  // criar lista: "criar lista NOME [com item1, item2]"
  if (t.startsWith("criar lista")) {
    const m = text.match(/criar lista\s+([^\s:]+)\s*(?:com\s*(.*))?/i);
    if (!m) {
      if (_sendMessage) await _sendMessage(from, "❌ Use: 'criar lista NOME [com item1, item2,...]'");
      return true;
    }
    const name = m[1];
    const items = m[2] ? m[2].split(",").map(i => i.trim()).filter(Boolean) : [];
    const listId = await createShoppingList(from, name, items);
    if (_sendMessage) {
      await _sendMessage(from, `✅ Lista "${name}" criada com ${items.length} itens.`);
    } else {
      console.log(`[routineFamily] Lista criada (${name}) para ${from}`);
    }
    return true;
  }

  // adicionar item: "adicionar item ITEM na lista NOME"
  if (t.startsWith("adicionar item")) {
    const m = text.match(/adicionar item\s+(.+?)\s+na lista\s+([^\s]+)/i);
    if (!m) {
      if (_sendMessage) await _sendMessage(from, "❌ Use: 'adicionar item ITEM na lista NOME'");
      return true;
    }
    const item = m[1].trim();
    const name = m[2].trim();
    const lists = await getShoppingLists(from);
    const list = lists.find(l => l.name === name);
    if (list) {
      await addItemToShoppingList(from, list._id, item);
      if (_sendMessage) await _sendMessage(from, `✅ Item "${item}" adicionado à lista "${name}".`);
    } else {
      if (_sendMessage) await _sendMessage(from, `❌ Lista "${name}" não encontrada.`);
    }
    return true;
  }

  /* -------------------- TAREFAS (CHORES) -------------------- */
  // adicionar tarefa: "adicionar tarefa NOME [intervalo N] [nota TEXTO]"
  if (t.startsWith("adicionar tarefa")) {
    const m = text.match(/adicionar tarefa\s+(.+?)(?:\s+intervalo\s+(\d+))?(?:\s+nota\s+(.+))?$/i);
    if (!m) {
      if (_sendMessage) await _sendMessage(from, "❌ Use: 'adicionar tarefa NOME [intervalo DIAS] [nota NOTA]'");
      return true;
    }
    const name = m[1].trim();
    const intervalDays = m[2] ? parseInt(m[2], 10) : 7;
    const note = m[3] ? m[3].trim() : "";
    await addChore(from, name, intervalDays, note);
    if (_sendMessage) await _sendMessage(from, `✅ Tarefa "${name}" adicionada, repetindo a cada ${intervalDays} dias.`);
    return true;
  }

  // listar tarefas: "listar tarefas" ou "tarefas"
  if (t.startsWith("listar tarefas") || t === "tarefas") {
    const chores = await listChores(from);
    if (!chores.length) {
      if (_sendMessage) await _sendMessage(from, "📋 Nenhuma tarefa cadastrada.");
    } else {
      const listText = chores
        .map(c => `- ${c.name} (próxima: ${DateTime.fromISO(c.nextRun).setZone(ZONE).toFormat("dd/MM/yyyy HH:mm")})`)
        .join("\n");
      if (_sendMessage) await _sendMessage(from, `📋 Suas tarefas:\n${listText}`);
    }
    return true;
  }

  /* -------------------- MENUS -------------------- */
  // salvar menu: "salvar menu WEEKKEY: item1, item2"
  if (t.startsWith("salvar menu")) {
    const m = text.match(/salvar menu\s+([^\s:]+)\s*:\s*(.+)/i);
    if (!m) {
      if (_sendMessage) await _sendMessage(from, "❌ Use: 'salvar menu SEMANA: item1, item2, ...'");
      return true;
    }
    const weekKey = m[1];
    const items = m[2].split(",").map(i => i.trim()).filter(Boolean);
    const menuObj = { items };
    await saveWeeklyMenu(from, weekKey, menuObj);
    if (_sendMessage) await _sendMessage(from, `✅ Menu da semana "${weekKey}" salvo.`);
    return true;
  }

  /* -------------------- RELATÓRIO DIÁRIO -------------------- */
  if (t.startsWith("relatório") || t.startsWith("meu diário")) {
    const m = text.match(/(?:relatório|meu diário)\s*:\s*(.+)/i);
    if (!m) {
      if (_sendMessage) await _sendMessage(from, "❌ Use: 'relatório: texto do diário'");
      return true;
    }
    await createDailyReport(from, m[1]);
    if (_sendMessage) await _sendMessage(from, "✅ Relatório diário salvo.");
    return true;
  }

  return false;
}

// alias para compatibilidade (algumas partes do código importam handleReminder)
export const handleReminder = handleCommand;
