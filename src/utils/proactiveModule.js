import { Todo } from "../models/todo.js";

export async function verificarContextoProativo(userId) {
  const agora = new Date();
  
  // 1. Verificar tarefas criadas há muito tempo e não concluídas
  const tarefasEsquecidas = await Todo.find({
    userId,
    status: "pendente",
    createdAt: { $lt: new Date(agora.getTime() - 24 * 60 * 60 * 1000) } // +24 horas
  });

  if (tarefasEsquecidas.length > 0) {
    const task = tarefasEsquecidas[Math.floor(Math.random() * tarefasEsquecidas.length)];
    return `💡 *Insight da Amber:* Percebi que você anotou "${task.task}" ontem e ainda não terminamos. Quer resolver isso agora ou prefere que eu adie?`;
  }

  // 2. Sugestão baseada no horário (ex: Gastos de Almoço)
  if (agora.getHours() === 14 && agora.getMinutes() < 10) {
    return "🍽️ *Lembrete Financeiro:* Acabou de almoçar? Não esqueça de me passar o valor para eu anotar na sua planilha!";
  }

  return null;
}
