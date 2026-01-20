"use client";
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === '123') { 
      // Cria o "crachá" para o segurança (middleware) deixar você passar
      document.cookie = "amber_session=true; path=/; max-age=86400; SameSite=Lax"; 
      router.push('/');
    } else {
      alert('ACESSO NEGADO: Chave Inválida');
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center font-sans p-4">
      <div className="w-full max-w-md bg-[#111] border border-cyan-900/50 p-8 rounded-2xl backdrop-blur-md text-white">
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-cyan-500 rounded-2xl mx-auto mb-6 rotate-45 shadow-[0_0_30px_rgba(6,182,212,0.3)]"></div>
          <h1 className="text-2xl font-bold tracking-widest uppercase">Amber Secure</h1>
          <p className="text-[10px] text-cyan-600 mt-2 uppercase tracking-[0.3em]">Protocolo de Identificação</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="DIGITE A CHAVE MESTRA"
            className="w-full bg-black border border-cyan-900/30 rounded-xl p-4 text-cyan-400 text-center outline-none focus:border-cyan-500 transition-all"
          />
          <button 
            type="submit"
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-black font-black py-4 rounded-xl transition-all uppercase"
          >
            Acessar Sistema
          </button>
        </form>
      </div>
    </main>
  );
}
