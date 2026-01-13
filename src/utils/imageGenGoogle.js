import { PredictionServiceClient } from "@google-cloud/aiplatform";
import { helpers } from "@google-cloud/aiplatform";

const clientOptions = {
  apiEndpoint: "us-central1-aiplatform.googleapis.com",
  credentials: {
    client_email: process.env.GCLOUD_CLIENT_EMAIL,
    private_key: process.env.GCLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }
};

const predictionServiceClient = new PredictionServiceClient(clientOptions);

export async function gerarImagemGoogle(prompt) {
  const project = process.env.GCLOUD_PROJECT_ID;
  const location = "us-central1";

  // --- LÓGICA DE SELEÇÃO DE MODELO ---
  const promptLower = prompt.toLowerCase();
  // Lista de gatilhos para usar o modelo caro (HQ)
  const gatilhosHQ = ["alta qualidade", "hq", "4k", "máxima qualidade", "detalhado", "realista"];
  
  // Define o modelo: se encontrar um gatilho, usa o HQ, senão usa o Fast
  const modeloId = gatilhosHQ.some(g => promptLower.includes(g)) 
    ? "imagen-3.0-generate-001" // High Quality ($$$)
    : "imagen-3.0-fast-generate-001"; // Fast ($)

  console.log(`🎨 Amber solicitando imagem via: ${modeloId}`);

  const endpoint = `projects/${project}/locations/${location}/publishers/google/models/${modeloId}`;

  const instance = { prompt };
  const instances = [helpers.toValue(instance)];

  const parameters = helpers.toValue({
    sampleCount: 1,
    aspectRatio: "1:1",
    safetySetting: "block_most",
  });

  try {
    const [response] = await predictionServiceClient.predict({ endpoint, instances, parameters });
    
    // O Imagen 3 retorna a imagem dentro de 'bytesBase64Encoded'
    const predictions = response.predictions;
    if (!predictions || predictions.length === 0) {
      console.error("❌ Nenhuma predição retornada pelo Google.");
      return null;
    }

    const base64 = predictions[0].structValue.fields.bytesBase64Encoded.stringValue;
    return `data:image/png;base64,${base64}`;
    
  } catch (error) {
    // Se o erro for de faturamento ou permissão, ele aparecerá aqui
    console.error(`❌ Erro no ${modeloId}:`, error.message);
    return null;
  }
}
