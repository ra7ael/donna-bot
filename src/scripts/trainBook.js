import fs from "fs";
import { embedBook } from "../utils/embedBook.js";

(async () => {
  try {
    const embeddings = await embedBook();

    fs.writeFileSync(
      "data/book_embeddings.json",
      JSON.stringify(embeddings, null, 2)
    );

    console.log("📚 Livro estudado com sucesso!");
  } catch (err) {
    console.error("❌ Erro ao estudar o livro:", err);
  }
})();
