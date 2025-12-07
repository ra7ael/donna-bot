// src/utils/routineFamily.js
import { DateTime } from "luxon";
import cron from "node-cron";

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
        // Reminders pontuais vencidos e não enviados
        const nowISO = DateTime.now().toISO();
        const due = await _db.collection("reminders")
          .find({ sent: { $ne: true }, dueAt: { $lte: nowISO } })
          .toArray();

        for (const r of due) {
          await _sendMessage(r.userId, `⏰ Lembrete: ${r.text}`);
          await _db.collection("reminders").updateOne({ _id: r._id }, { $set: { sent: true, deliveredAt: new Date() }});
        }

        // Chores (tarefas recorrentes) — executa quando nextRun <= now
        const chores = await _db.collection("chores")
          .find({ active: true, nextRun: { $lte: nowISO } })
          .toArray();

        for (const c of chores) {
          await _sendMessage(c.userId, `🧹 Tarefa: ${c.name} — ${c.note || ""}`);
          // atualiza nextRun somando intervalDays
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

  // dia da semana (ex: quinta às 14h)
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

  // garante ISO válida
  let dueISO = parseRelativeTime(whenText);
  if (!dueISO) {
    const dt = DateTime.fromISO(whenText, { zone: DateTime.now().zone });
    dueISO = dt.isValid ? dt.toISO() : DateTime.now().toISO();
  }

  const doc = { userId, text, whenText: whenText || "", dueAt: dueISO, createdAt: new Date(), sent: false, meta };
  const r = await _db.collection("reminders").insertOne(doc);
  return { ok: true, id: r.insertedId, dueAt: dueISO };
}

/* -------------------- Comando de alto nível -------------------- */

export async function handleCommand(text, from) {
  const t = (text || "").toLowerCase();

  // lembretes smart
  if (t.startsWith("me lembra") || t.startsWith("lembrete:") || t.includes("lembre me") || t.includes("não me deixe")) {
    const m = text.match(/(me lembra|lembrete:|não me deixe lembrar de|não me deixe esquecer de)\s*(.*)/i);
    const body = m ? m[2] : text;

    // extrai a parte temporal
    const whenMatch = body.match(/daqui.*|amanh.*|hoje.*|domingo|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|\d{1,2}\/\d{1,2}/i);
    const whenText = whenMatch ? whenMatch[0] : "daqui 1 hora";

    // texto real sem a parte de tempo
    const textOnly = body.replace(whenText, "").trim() || body.trim();

    const created = await createReminder(from, textOnly, whenText);
    await _sendMessage(from, `✅ Lembrete criado para ${DateTime.fromISO(created.dueAt).toFormat("dd/MM/yyyy HH:mm")}`);
    return true;
  }

/* -------------------- Shopping Lists -------------------- */

export async function createShoppingList(userId, name = "Lista", items = []) {
  const doc = { userId, name, items: items.map(i => ({ text: i, checked: false })), createdAt: new Date() };
  const r = await _db.collection("shoppingLists").insertOne(doc);
  return r.insertedId;
}

export async function addItemToShoppingList(userId, listId, item) {
  const { ObjectId } = require("mongodb");
  await _db.collection("shoppingLists").updateOne({ _id: new ObjectId(listId), userId }, { $push: { items: { text: item, checked: false } }});
}

export async function getShoppingLists(userId) {
  return await _db.collection("shoppingLists").find({ userId }).toArray();
}

export async function removeItemFromList(userId, listId, index) {
  const lists = await _db.collection("shoppingLists").find({ userId }).toArray();
  // simplicidade: remover pelo índice (pode melhorar)
  // implementado client-side quando necessário
}

/* -------------------- Chores (tarefas recorrentes) -------------------- */

export async function addChore(userId, name, intervalDays = 7, note = "") {
  const nextRun = DateTime.now().toISO();
  const doc = { userId, name, intervalDays, note, nextRun, active: true, createdAt: new Date() };
  const r = await _db.collection("chores").insertOne(doc);
  return r.insertedId;
}

export async function listChores(userId) {
  return await _db.collection("chores").find({ userId }).sort({ nextRun: 1 }).toArray();
}

/* -------------------- Menus (planejamento de cardápio) -------------------- */

export async function saveWeeklyMenu(userId, weekKey, menuObj) {
  // weekKey = 'YYYY-WW' por exemplo
  await _db.collection("menus").updateOne({ userId, weekKey }, { $set: { menu: menuObj, updatedAt: new Date() }}, { upsert: true });
}

/* -------------------- Relatório Diário -------------------- */

export async function createDailyReport(userId, reportText) {
  await _db.collection("dailyReports").insertOne({ userId, reportText, createdAt: new Date() });
}

/* -------------------- Comando de alto nível (parser simples) -------------------- */

export async function handleCommand(text, from) {
  const t = (text || "").toLowerCase();

  // lembretes smart
  if (t.startsWith("me lembra") || t.startsWith("lembrete:") || t.includes("lembre me") || t.includes("não me deixe")) {
    // extrai algo como: "me lembra daqui 2 horas de pagar o boleto"
    const m = text.match(/(me lembra|lembrete:|não me deixe lembrar de|não me deixe esquecer de)\s*(.*)/i);
    const body = m ? m[2] : text;
    // tenta isolar a parte temporal (daqui 2 horas / amanhã às 9 / quinta às 14h)
    const whenMatch = body.match(/daqui.*|amanh.*|hoje.*|quinta.*|segunda.*|\d{1,2}\/\d{1,2}/i);
    const whenText = whenMatch ? whenMatch[0] : "daqui 1 hora";
    // descreve o texto real removendo a parte de tempo
    const textOnly = body.replace(whenText, "").trim() || body.trim();
    const created = await createReminder(from, textOnly, whenText);
    await _sendMessage(from, `✅ Lembrete criado para ${created.dueAt}`);
    return true;
  }

  // agendar compromisso (interpretação simples)
  if (t.startsWith("agendar") || t.startsWith("marcar") || t.includes("agende")) {
    // ex: "agendar consultoria quinta às 14h"
    const m = text.match(/(agendar|marcar|agende)\s+(.*?)\s+(amanh[ãa]|hoje|daqui|domingo|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|\d{1,2}\/\d{1,2})\s*(.*)/i);
    const title = m ? m[2] : text;
    const whenText = m ? (m[3] + " " + (m[4] || "")) : "amanhã às 09:00";
    const created = await createReminder(from, `Compromisso: ${title}`, whenText, { type: "appointment" });
    await _sendMessage(from, `📅 Compromisso agendado: ${title} — ${created.dueAt}`);
    return true;
  }

  // lista de compras
  if (t.startsWith("lista de compras") || t.startsWith("cria lista de compras") || t.startsWith("adiciona na lista")) {
    // cria lista ou adiciona item
    if (t.includes("cria") || t.includes("criar") || t.includes("crie")) {
      const nameMatch = text.match(/cria(?:r|)|cria lista(?: de compras)?(?: chamada)?(?: (.+))?/i);
      const name = nameMatch && nameMatch[1] ? nameMatch[1] : "Lista de compras";
      const id = await createShoppingList(from, name, []);
      await _sendMessage(from, `🛒 Lista criada: ${name} (id: ${id})`);
      return true;
    }
    // adiciona item (ex: "adiciona arroz na lista")
    const addMatch = text.match(/adiciona\s+(.+?)\s+(?:na|na lista|na lista de compras|a lista)/i);
    if (addMatch) {
      const item = addMatch[1].trim();
      // pega primeira lista do usuário
      const lists = await getShoppingLists(from);
      if (!lists || lists.length === 0) {
        const id = await createShoppingList(from, "Lista de compras", [item]);
        await _sendMessage(from, `🛒 Lista criada e item adicionado: ${item}`);
        return true;
      } else {
        const listId = lists[0]._id.toString();
        await addItemToShoppingList(from, listId, item);
        await _sendMessage(from, `✅ Adicionado à sua lista: ${item}`);
        return true;
      }
    }

    // comando para mostrar listas
    if (t.includes("mostra") || t.includes("mostrar") || t.includes("minha lista")) {
      const lists = await getShoppingLists(from);
      if (!lists.length) {
        await _sendMessage(from, "📭 Você não tem listas salvas.");
        return true;
      }
      const summary = lists.map(l => `• ${l.name} (${l.items.length} itens):\n   ${l.items.map((it, i) => `${i+1}. ${it.text}${it.checked ? " ✅" : ""}`).join("\n   ")}`).join("\n\n");
      await _sendMessage(from, `🛒 Suas listas:\n\n${summary}`);
      return true;
    }
  }

  // tarefas recorrentes (chore)
  if (t.startsWith("cria tarefa") || t.startsWith("adicionar tarefa") || t.includes("todo") || t.includes("tarefa") || t.includes("tarefa")) {
    // ex: "cria tarefa tirar lixo a cada 2 dias"
    const m = text.match(/(cria|adiciona|criar)\s+(?:tarefa\s+)?(.+?)\s+(?:a cada|a cada|aCada|a cada)\s+(\d+)\s*dias?/i);
    if (m) {
      const name = m[2].trim();
      const days = parseInt(m[3], 10);
      const id = await addChore(from, name, days, "");
      await _sendMessage(from, `🔁 Tarefa recorrente criada: ${name} (a cada ${days} dias).`);
      return true;
    }
    // simples listar tarefas
    if (t.includes("listar tarefas") || t.includes("minhas tarefas")) {
      const chores = await listChores(from);
      if (!chores.length) {
        await _sendMessage(from, "Nenhuma tarefa recorrente encontrada.");
        return true;
      }
      const textOut = chores.map(c => `• ${c.name} — próximo: ${c.nextRun}`).join("\n");
      await _sendMessage(from, `🔁 Suas tarefas:\n${textOut}`);
      return true;
    }
  }

  // planejamento de cardápio (salvar menu semanal)
  if (t.includes("cardápio") || t.includes("cardapio") || t.includes("menu semanal") || t.includes("planejamento")) {
    // comando simples: "salva cardápio segunda: arroz; terça: feijoada; ..."
    const m = text.match(/salva(?:r)?\s+card(?:á|a)pio\s+(.+)/i);
    if (m) {
      // parse básico: "segunda: arroz; terça: X"
      const parts = m[1].split(/;|,/).map(p => p.trim()).filter(Boolean);
      const menu = {};
      for (const p of parts) {
        const mm = p.match(/(segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\s*[:\-]\s*(.+)/i);
        if (mm) menu[mm[1]] = mm[2];
      }
      const weekKey = DateTime.now().toFormat("kkkk-'W'WW");
      await saveWeeklyMenu(from, weekKey, menu);
      await _sendMessage(from, `🍽️ Cardápio salvo para a semana ${weekKey}.`);
      return true;
    }
  }

  // diário familiar simples
  if (t.startsWith("diario:") || t.startsWith("diário:") || t.startsWith("registro:") || t.startsWith("registra")) {
    const m = text.match(/(?:diario|diário|registro|registra)[:\s]*(.+)/i);
    if (m) {
      await createDailyReport(from, m[1]);
      await _sendMessage(from, "📝 Registro diário salvo.");
      return true;
    }
  }

  // solicitação de relatório diário/semana
  if (t.includes("relatório diário") || t.includes("relatorio diario") || t.includes("me conta o dia") || t.includes("como foi meu dia")) {
    // agregamos últimas mensagens / memórias + reminders do dia
    const today = DateTime.now().startOf("day").toJSDate();
    const reports = await _db.collection("dailyReports").find({ userId: from, createdAt: { $gte: today } }).toArray();
    const reminders = await _db.collection("reminders").find({ userId: from, dueAt: { $gte: DateTime.now().startOf("day").toISO() } }).toArray();
    let textOut = `🗒️ Relatório do dia:\n\nRegistros:\n${reports.map(r => `• ${r.reportText}`).join("\n") || "Nenhum."}\n\nLembretes agendados:\n${reminders.map(r => `• ${r.text} — ${r.dueAt}`).join("\n") || "Nenhum."}`;
    await _sendMessage(from, textOut);
    return true;
  }

  return false;
}
