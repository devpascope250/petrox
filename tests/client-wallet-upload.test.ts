import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { parseWalletMovementMultipart } from "../src/modules/client-wallets/client-wallet-upload.js";
import { createWalletMovementSchema } from "../src/modules/client-wallets/client-wallet.schema.js";

it("accepts a deposit with a file in the supportingDocUrl form field", async () => {
  const app = Fastify();
  let uploadedPath: string | undefined;
  await app.register(multipart);
  app.post("/", async (request) => {
    const body = await parseWalletMovementMultipart(request);
    uploadedPath = path.join(process.cwd(), String(body.supportingDocUrl));
    return createWalletMovementSchema.parse(body);
  });

  const boundary = "wallet-upload-test";
  const fields = {
    type: "DEPOSIT",
    amount: "10",
    accountId: "cjld2cjxh0000qzrmn831i7rn",
    referenceId: "DEP-TEST"
  };
  const payload = Object.entries(fields).map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  ).join("") +
    `--${boundary}\r\nContent-Disposition: form-data; name="supportingDocUrl"; filename="receipt.txt"\r\nContent-Type: text/plain\r\n\r\nDeposit receipt\r\n--${boundary}--\r\n`;

  try {
    const response = await app.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().supportingDocUrl).toMatch(/^\/uploads\/receipt-.*\.txt$/);
    expect(await readFile(uploadedPath!, "utf8")).toBe("Deposit receipt");
  } finally {
    await app.close();
    if (uploadedPath) await unlink(uploadedPath);
  }
});
