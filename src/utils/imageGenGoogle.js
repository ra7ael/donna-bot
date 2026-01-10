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
  const endpoint = `projects/${project}/locations/${location}/publishers/google/models/imagen-3.0-generate-001`;

  const instance = { prompt };
  const instances = [helpers.toValue(instance)];

  const parameters = helpers.toValue({
    sampleCount: 1,
    aspectRatio: "1:1",
    safetySetting: "block_most",
  });

  try {
    const [response] = await predictionServiceClient.predict({ endpoint, instances, parameters });
    const base64 = response.predictions[0].structValue.fields.bytesBase64Encoded.stringValue;
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error("❌ Erro no Imagen 3:", error.message);
    return null;
  }
}
