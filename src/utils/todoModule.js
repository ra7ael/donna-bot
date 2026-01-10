import { Todo } from "../models/todo.js";

export async function processarTasks(userId, texto) {
  const textoBaixo = texto.toLowerCase();

  // 1. ADICIONAR TAREFA
  if (textoBaixo.includes("preciso") || textoBaixo.includes("anota aí") || textoBaixo.includes("tarefa:")) {
    const task = texto.replace(/preciso|anota aí|tarefa:/gi, "").trim();
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

// 3. CONCLUIR TAREFA (Melhorado)
  if (textoBaixo.startsWith("feito") || textoBaixo.startsWith("concluí") || textoBaixo.startsWith("check") || textoBaixo.includes("já comprei")) {
    // Limpa o comando e foca na palavra-chave (ex: "pilhas")
    const search = textoBaixo
      .replace(/feito|concluí|check|já comprei|o das|as|os|da|do/gi, "")
      .trim();

    // Busca por qualquer tarefa pendente que contenha essa palavra-chave
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
    
    // Plano B: Se não achou, lista o que tem para o usuário ser mais específico
    return "Não encontrei essa tarefa. Digite 'minhas tarefas' para ver a lista exata.";
  }
