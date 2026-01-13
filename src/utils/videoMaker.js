import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import path from 'path';
import fs from 'fs-extra';

// Configura o caminho do executável do FFmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller);

export async function criarVideoAmber(caminhosImagens, nomeArquivo) {
    // Pasta onde o vídeo final será salvo
    const outputPath = path.join(process.cwd(), 'public/images', `${nomeArquivo}.mp4`);
    await fs.ensureDir(path.dirname(outputPath));

    return new Promise((resolve, reject) => {
        let command = ffmpeg();

        // Adiciona as imagens que já estão no disco
        caminhosImagens.forEach(img => {
            command = command.input(img).loop(5); // 5 segundos por imagem
        });

        command
            .fps(25)
            .videoCodec('libx264')
            // Redimensiona para 720p (HD) - É o equilíbrio perfeito entre qualidade e leveza
            .size('1280x720') 
            .outputOptions([
                '-pix_fmt yuv420p',   // Formato compatível com WhatsApp/Celular
                '-preset ultrafast',  // Processamento o mais rápido possível (poupa CPU)
                '-tune stillimage',   // Otimização para slideshows (poupa muita RAM)
                '-shortest'           // Garante que o vídeo termine no tempo certo
            ])
            .on('start', (cmd) => console.log('🎬 FFmpeg iniciado (Modo Leve):', cmd))
            .on('error', (err) => {
                console.error('❌ Erro FFmpeg:', err);
                reject(err);
            })
            .on('end', () => {
                console.log('✅ Vídeo finalizado com sucesso!');
                // Retorna o caminho relativo para a URL
                resolve(`/images/${nomeArquivo}.mp4`);
            })
            .save(outputPath);
    });
}
