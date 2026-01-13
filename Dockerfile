# 1. Usar a imagem oficial do Node.js (versão estável mais recente)
FROM node:20-slim

# 2. Instalar dependências do sistema para processamento de imagem e vídeo
# (Isso garante que bibliotecas como ffmpeg funcionem bem na nuvem)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 3. Criar e definir o diretório de trabalho dentro do contêiner
WORKDIR /usr/src/app

# 4. Copiar os arquivos de dependências primeiro (otimiza o cache)
COPY package*.json ./

# 5. Instalar as dependências do projeto
RUN npm install --production

# 6. Copiar todo o resto do seu código para dentro do contêiner
COPY . .

# 7. Garantir que as pastas de arquivos temporários existam
RUN mkdir -p public/audio public/images

# 8. Definir a porta padrão que o Google Cloud Run espera (8080)
ENV PORT=8080
EXPOSE 8080

# 9. Comando para iniciar a Amber
CMD [ "node", "src/server.js" ]
