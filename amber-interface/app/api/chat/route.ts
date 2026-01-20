import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Aqui o Next.js envia a mensagem para o seu servidor Express
    // Usamos localhost se estiver no mesmo servidor ou a URL da Vercel
    const backendUrl = process.env.SERVER_URL || 'https://donna-bot.vercel.app/api/chat-backend';

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro na ponte da Amber:', error);
    return NextResponse.json({ text: "Tive um erro ao contatar o núcleo." }, { status: 500 });
  }
}
