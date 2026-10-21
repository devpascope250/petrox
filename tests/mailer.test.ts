import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailConfig } from "../src/config/mail_config.js";
import { sendMail } from "../src/utils/mailer.js";

const config: MailConfig = {
  appName: "IKWIM Energies",
  siteUrl: "https://petrox.example.rw",
  transport: "resend",
  apiKey: "re_test",
  from: "noreply@example.rw",
  fromName: "IKWIM Energies",
  replyTo: "",
};
const message = { to: "driver@example.rw", subject: "Reset Your Password", html: "<p>hi</p>" };

/** Stands in for the Resend API, and keeps what was posted to it. */
function resend(status = 200, body = '{"id":"fake"}') {
  const calls: { url: string; headers: Record<string, string>; payload: any }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init.headers, payload: JSON.parse(init.body) });
    return new Response(body, { status });
  }) as never);
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("the mailer", () => {
  it("posts the message to Resend, with the sender and reply-to from the config", async () => {
    const calls = resend();
    await expect(sendMail(message, { ...config, replyTo: "info@example.rw" })).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].headers.Authorization).toBe("Bearer re_test");
    expect(calls[0].payload).toEqual({
      from: "IKWIM Energies <noreply@example.rw>",
      to: ["driver@example.rw"],
      subject: "Reset Your Password",
      html: "<p>hi</p>",
      reply_to: "info@example.rw",
    });
  });

  it("sends the bare address when no display name is set, and lets the caller override the sender", async () => {
    const calls = resend();
    await sendMail(message, { ...config, fromName: "" });
    expect(calls[0].payload.from).toBe("noreply@example.rw");
    await sendMail({ ...message, from: '"Other" <other@example.rw>' }, config);
    expect(calls[1].payload.from).toBe('"Other" <other@example.rw>');
    // Nothing is sent as a reply-to when none is configured.
    expect(calls[0].payload).not.toHaveProperty("reply_to");
  });

  it("attaches readable files as base64 and skips the ones it cannot read", async () => {
    const calls = resend();
    await expect(
      sendMail(
        { ...message, attachments: [{ path: "package.json", filename: "p.json" }, { path: "/nope/missing.pdf" }] },
        config,
      ),
    ).resolves.toBe(true);
    const attachments = calls[0].payload.attachments;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe("p.json");
    expect(Buffer.from(attachments[0].content, "base64").toString()).toContain('"name"');
  });

  it("names the file itself when no filename is given, and sends no attachments when none can be read", async () => {
    const calls = resend();
    await sendMail({ ...message, attachments: [{ path: "package.json" }] }, config);
    expect(calls[0].payload.attachments[0].filename).toBe("package.json");
    await sendMail({ ...message, attachments: [{ path: "/nope/missing.pdf" }] }, config);
    expect(calls[1].payload).not.toHaveProperty("attachments");
  });

  it("writes the message to the log instead of sending it under the log transport", async () => {
    const calls = resend();
    const logged = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(sendMail(message, { ...config, transport: "log" })).resolves.toBe(true);
    expect(calls).toHaveLength(0);
    expect(logged.mock.calls[0][0]).toContain("driver@example.rw");
  });

  it("refuses without a key, and reports a refusal or a network failure as one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = resend();
    await expect(sendMail(message, { ...config, apiKey: "" })).resolves.toBe(false);
    await expect(sendMail(message, { ...config, apiKey: "re_xxxx" })).resolves.toBe(false);
    expect(calls).toHaveLength(0);

    resend(422, '{"message":"domain is not verified"}');
    await expect(sendMail(message, config)).resolves.toBe(false);

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    await expect(sendMail(message, config)).resolves.toBe(false);
  });
});
