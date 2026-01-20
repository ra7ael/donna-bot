"use client";
import React, { useState, useEffect } from 'react';

export default function AmberInterface() {
  const [status, setStatus] = useState("ONLINE");
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<{ role: string, text: string }[]>([
    { role: 'amber', text: 'Sistemas carregados. Aguardando comandos, Rafael.' }
  ]);

  // Função para simular o envio (conecta com aquele /api/chat que criamos)
  const handleCommand = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input) {
      const userMsg = input;
      setInput("");
      setChat(prev => [...prev, { role: 'user', text: userMsg }]);

      // Aqui você chamaria seu backend
      // const res = await fetch('SUA_URL/api/chat', ...);
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] text-cyan-400 font-mono p-4 flex flex-col items-center selection:bg-cyan-500/30">
      
      {/* Luz de fundo decorativa */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-cyan-500/10 blur-[120px] pointer-events-none"></div>

      {/* Header */}
      <header className="w-full max-w-5xl flex justify-between items-center border-b border-cyan-900/50 pb-6 mb-10 z-10">
        <div>
          <h1 className="text-3xl font-black tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-white to-purple-500 drop-shadow-sm">
            AMBER OS
          </h1>
          <div className="flex gap-4 mt-1">
             <p className="text-[10px] text-cyan-700 uppercase tracking-widest">Core: v1.0.4</p>
             <p className="text-[10px] text-cyan-700 uppercase tracking-widest">Loc: Curitiba, BR</p>
          </div>
        </div>
        <div className="bg-cyan-950/20 border border-cyan-500/20 px-4 py-2 rounded-full flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${status === "ONLINE" ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-red-500"}`}></div>
          <span className="text-xs font-bold">{status}</span>
        </div>
      </header>

      {/* Grid de Apps com Efeito Glassmorphism */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl z-10">
        
        {/* Financeiro */}
        <div className="relative group overflow-hidden bg-slate-900/20 border border-white/5 p-6 rounded-2xl transition-all duration-500 hover:border-cyan-500/50 hover:bg-slate-900/40">
          <div className="absolute -right-4 -top-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity">🏦</div>
          <h3 className="text-lg font-bold mb-4 text-white group-hover:text-cyan-400 transition-colors">Financeiro B2B</h3>
          <p className="text-xs text-slate-400 leading-relaxed">Gestão de fluxo e auditoria de NFe integrada.</p>
          <div className="mt-6 flex items-end justify-between">
             <span className="text-[10px] text-cyan-600">STATUS: OTIMIZADO</span>
             <div className="flex gap-1">
                {[1,2,3,4].map(i => <div key={i} className="w-1 h-3 bg-cyan-500/30 rounded-full"></div>)}
             </div>
          </div>
        </div>

        {/* RH - Estilo Purple Glow */}
        <div className="relative group overflow-hidden bg-slate-900/20 border border-white/5 p-6 rounded-2xl transition-all duration-500 hover:border-purple-500/50 hover:bg-slate-900/40">
          <div className="absolute -right-4 -top-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity">⚖️</div>
          <h3 className="text-lg font-bold mb-4 text-white group-hover:text-purple-400 transition-colors">Gestão de RH</h3>
          <p className="text-xs text-slate-400 leading-relaxed">Contratos Lei 6.019 e folha 2026.</p>
          <div className="mt-6 flex gap-2">
             <span className="text-[9px] border border-purple-500/30 px-2 py-1 rounded text-purple-300">MIGUEL OK</span>
             <span className="text-[9px] border border-purple-500/30 px-2 py-1 rounded text-purple-300">RECRUTAMENTO</span>
          </div>
        </div>

        {/* Blogueira - Estilo Pink Glow */}
        <div className="relative group overflow-hidden bg-slate-900/20 border border-white/5 p-6 rounded-2xl transition-all duration-500 hover:border-pink-500/50 hover:bg-slate-900/40">
          <div className="absolute -right-4 -top-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity">📸</div>
          <h3 className="text-lg font-bold mb-4 text-white group-hover:text-pink-400 transition-colors">Amber Social</h3>
          <p className="text-xs text-slate-400 leading-relaxed">IA Criativa e Automação de Influência.</p>
          <div className="mt-6 bg-pink-500/10 h-1.5 w-full rounded-full overflow-hidden">
             <div className="bg-pink-500 h-full w-[80%]"></div>
          </div>
        </div>
      </div>

      {/* Terminal de Chat "Real" */}
      <section className="mt-12 w-full max-w-5xl bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl z-10 overflow-hidden">
        <div className="bg-white/5 p-3 flex items-center justify-between border-b border-white/5">
           <div className="flex gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
           </div>
           <span className="text-[9px] uppercase tracking-[0.3em] text-slate-500 font-bold">Encrypted Connection</span>
        </div>

        <div className="h-64 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-cyan-900">
           {chat.map((m, i) => (
             <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-3 rounded-xl text-xs ${
                  m.role === 'user' 
                  ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-200' 
                  : 'bg-white/5 border border-white/10 text-slate-300'
                }`}>
                  <span className="opacity-50 mr-2">[{m.role.toUpperCase()}]</span>
                  {m.text}
                </div>
             </div>
           ))}
        </div>

        <div className="p-4 bg-white/5 flex items-center gap-4">
           <span className="text-cyan-500 animate-pulse font-bold">❯</span>
           <input 
             type="text"
             value={input}
             onChange={(e) => setInput(e.target.value)}
             onKeyDown={handleCommand}
             placeholder="Inicie um protocolo de pesquisa ou gestão..."
             className="bg-transparent border-none outline-none w-full text-sm placeholder:text-slate-700 text-cyan-100"
           />
        </div>
      </section>
    </main>
  );
}
