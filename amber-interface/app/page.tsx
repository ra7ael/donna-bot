"use client";
import React, { useState } from 'react';

export default function AmberInterface() {
  const [status, setStatus] = useState("ONLINE");

  return (
    <main className="min-h-screen bg-black text-cyan-400 font-mono p-4 flex flex-col items-center">
      {/* Header - Identidade da Amber */}
      <header className="w-full max-w-5xl flex justify-between items-center border-b border-cyan-900 pb-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
            AMBER SYSTEM OS v1.0
          </h1>
          <p className="text-xs text-cyan-700">COORDENADA: CURITIBA, BR [2026]</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full animate-pulse ${status === "ONLINE" ? "bg-green-500" : "bg-red-500"}`}></div>
          <span className="text-sm tracking-tighter">{status}</span>
        </div>
      </header>

      {/* Grid Principal de Apps */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        
        {/* App 1: Concierge Financeiro */}
        <div className="bg-slate-900/50 border border-cyan-500/30 p-6 rounded-xl hover:border-cyan-400 transition-all cursor-pointer backdrop-blur-sm group">
          <h3 className="text-xl mb-2 flex items-center gap-2">
            🏦 <span>Financeiro B2B</span>
          </h3>
          <p className="text-sm text-cyan-700 mb-4">Cashflow preditivo (3 meses) e emissão de NFe.</p>
          <div className="h-1 w-full bg-cyan-950 rounded overflow-hidden">
            <div className="h-full bg-cyan-500 w-[65%] group-hover:w-full transition-all duration-700"></div>
          </div>
        </div>

        {/* App 2: RH & Trabalho Temporário */}
        <div className="bg-slate-900/50 border border-purple-500/30 p-6 rounded-xl hover:border-purple-400 transition-all cursor-pointer backdrop-blur-sm group">
          <h3 className="text-xl mb-2 flex items-center gap-2 text-purple-400">
            ⚖️ <span>Gestão de RH</span>
          </h3>
          <p className="text-sm text-purple-900 mb-4">Cálculo de folha 2026 e contratos Lei 6.019.</p>
          <div className="flex gap-2 text-xs">
            <span className="bg-purple-900/30 px-2 py-1 rounded">MIGUEL: ATIVO</span>
            <span className="bg-purple-900/30 px-2 py-1 rounded">IR: ISENTO</span>
          </div>
        </div>

        {/* App 3: Estúdio Instagram */}
        <div className="bg-slate-900/50 border border-pink-500/30 p-6 rounded-xl hover:border-pink-400 transition-all cursor-pointer backdrop-blur-sm group">
          <h3 className="text-xl mb-2 flex items-center gap-2 text-pink-400">
            📸 <span>Amber Blogueira</span>
          </h3>
          <p className="text-sm text-pink-900 mb-4">Automação de posts e geração de imagens IA.</p>
          <button className="text-[10px] border border-pink-500/50 px-2 py-1 rounded hover:bg-pink-500/20">
            AGENDAR NOVO POST
          </button>
        </div>

      </div>

      {/* Terminal de Chat Central */}
      <section className="mt-12 w-full max-w-5xl bg-slate-900/30 border border-cyan-900 rounded-lg overflow-hidden">
        <div className="bg-cyan-900/20 p-2 text-xs border-b border-cyan-900 flex justify-between">
          <span>CONSOLE_OUTPUT_AMBER</span>
          <span>SYSTEM_LOG</span>
        </div>
        <div className="p-4 h-48 overflow-y-auto text-sm space-y-2">
          <p className="text-cyan-600 italic">[{new Date().toLocaleTimeString()}] Inicializando módulos de gestão...</p>
          <p className="text-cyan-400 animate-pulse font-bold tracking-widest text-center mt-8 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
            "OLÁ, RAFAEL. QUAL EMPRESA VAMOS GERENCIAR HOJE?"
          </p>
        </div>
        <div className="p-4 border-t border-cyan-900 flex gap-4">
          <span className="text-cyan-500 font-bold">{">"}</span>
          <input 
            type="text" 
            placeholder="Digite um comando para a Amber..." 
            className="bg-transparent border-none outline-none w-full placeholder:text-cyan-900"
          />
        </div>
      </section>
    </main>
  );
}