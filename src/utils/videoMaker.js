import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs-extra';

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
            .outputOptions(['-pix_fmt yuv420p']) // Formato compatível com WhatsApp/Celular
            .on('start', (cmd) => console.log('🎬 FFmpeg iniciado:', cmd))
            .on('error', (err) => {
                console.error('❌ Erro FFmpeg:', err);
                reject(err);
            })
            .on('end', () => {
                console.log('✅ Vídeo finalizado!');
                // Retorna o caminho relativo para a URL
                resolve(`/images/${nomeArquivo}.mp4`);
            })
            .save(outputPath);
    });
}
