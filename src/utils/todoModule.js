import { Todo } from "../models/todo.js";

export async function processarTasks(userId, texto) {
  // Limpa o nome da Amber e espaços extras para a tarefa ficar limpa
  const textoLimpo = texto.replace(/amber,?\s?/gi, "").trim();
  const textoBaixo = textoLimpo.toLowerCase();

  // 1. ADICIONAR TAREFA
  if (textoBaixo.includes("preciso") || textoBaixo.includes("anota aí") || textoBaixo.startsWith("tarefa:")) {
    const task = textoLimpo.replace(/preciso|anota aí|tarefa:/gi, "").trim();
    if (!task) return "O que exatamente você precisa que eu anote?";
    
    await Todo.create({ userId, task });
    return `✅ Deixei anotado: "${task}"`;
  }

  // 2. LISTAR TAREFAS
  if (textoBaixo.includes("o que eu tenho") || textoBaixo.includes("minhas tarefas") || textoBaixo.includes("lista de tarefas")) {
    const tasks = await Todo.find({ userId, status: "pendente" });
    if (tasks.length === 0) return "Você não tem tarefas pendentes! ☕";
    
    const lista = tasks.map((t, i) => `${i + 1}. ${t.task}`).join("\n");
    return `📝 Suas tarefas pendentes:\n\n${lista}`;
  }

  // 3. CONCLUIR TAREFA
  if (textoBaixo.startsWith("feito") || textoBaixo.startsWith("concluí") || textoBaixo.startsWith("check") || textoBaixo.includes("já comprei")) {
    // Pegamos apenas a palavra principal (ex: pilhas)
    const search = textoBaixo
      .replace(/feito|concluí|check|já comprei|o das|as|os|da|do|de|do/gi, "")
      .trim();

    if (!search) return "Diga o nome da tarefa que você concluiu.";

    const task = await Todo.findOneAndUpdate(
      { 
        userId, 
        status: "pendente", 
        task: new RegExp(search, "i") 
      },
      { status: "concluido", completedAt: new Date() },
      { new: true }
    );

    if (task) return `✔️ Marquei como feito: "${task.task}"`;
    
    return "Não encontrei essa tarefa pendente. Digite 'minhas tarefas' para ver a lista.";
  }

  return null;
}
