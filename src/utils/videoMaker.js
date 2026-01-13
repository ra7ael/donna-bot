import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';

export async function criarVideoAmber(imagensUrls, nomeArquivo) {
    const tempFolder = path.join(process.cwd(), 'temp_images');
    const outputPath = path.join(process.cwd(), 'public/videos', `${nomeArquivo}.mp4`);
    
    // Garante que as pastas existem
    await fs.ensureDir(tempFolder);
    await fs.ensureDir(path.dirname(outputPath));

    try {
        // 1. Descarrega as imagens do Google para o servidor
        const caminhosLocais = [];
        for (let i = 0; i < imagensUrls.length; i++) {
            const localPath = path.join(tempFolder, `img${i}.png`);
            const response = await axios({ url: imagensUrls[i], responseType: 'stream' });
            const writer = fs.createWriteStream(localPath);
            response.data.pipe(writer);
            await new Promise((resolve) => writer.on('finish', resolve));
            caminhosLocais.push(localPath);
        }

        // 2. Monta o vídeo usando o FFmpeg
        return new Promise((resolve, reject) => {
            let command = ffmpeg();

            caminhosLocais.forEach(img => {
                command = command.input(img).loop(5); // 5 segundos por imagem
            });

            command
                .fps(25)
                .videoCodec('libx264')
                .outputOptions(['-pix_fmt yuv420p']) // Compatível com WhatsApp
                .on('start', (cmd) => console.log('🎬 FFmpeg iniciado:', cmd))
                .on('error', (err) => reject(err))
                .on('end', async () => {
                    await fs.remove(tempFolder); // Limpa as imagens temporárias
                    resolve(`/videos/${nomeArquivo}.mp4`);
                })
                .save(outputPath);
        });
    } catch (error) {
        await fs.remove(tempFolder);
        throw error;
    }
}
