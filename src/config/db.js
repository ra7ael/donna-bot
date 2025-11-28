// src/config/db.js
import { MongoClient } from "mongodb";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

let mongoClient = null;
let driverDb = null;
let mongooseConnected = false;

export async function connectDB() {
  if (!MONGO_URI) throw new Error("MONGO_URI não definida");

  // conecta driver nativo (para queries diretas, se você usa)
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    await mongoClient.connect();
    driverDb = mongoClient.db("donna"); // ajuste se usa outro db name
    console.log("✅ MongoClient conectado (driver nativo)");
  }

  // tenta conectar o mongoose (não fatal)
  if (!mongooseConnected) {
    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      mongooseConnected = true;
      console.log("✅ Mongoose conectado");
    } catch (err) {
      console.warn("⚠️ Mongoose não conectou rápido (continuando):", err.message);
    }
  }

  return { driverDb, mongoose };
}

export function getDriverDB() {
  return driverDb;
}

export function getMongoClient() {
  return mongoClient;
}

export function isMongooseConnected() {
  return mongooseConnected && mongoose.connection.readyState === 1;
}

