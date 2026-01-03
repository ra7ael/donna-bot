import dotenv from "dotenv";
dotenv.config();

export const config = {
  token: process.env.META_ACCESS_TOKEN,
  igBusinessId: process.env.INSTAGRAM_BUSINESS_ID,
  baseUrl: "https://graph.facebook.com/v19.0"
};
