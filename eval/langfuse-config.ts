import { Langfuse } from "langfuse";

export const langfuse = new Langfuse({
  baseUrl: process.env.LANGFUSE_HOST || "http://localhost:3000",
  publicKey: process.env.LANGFUSE_PUBLIC_KEY || "",
  secretKey: process.env.LANGFUSE_SECRET_KEY || "",
});
