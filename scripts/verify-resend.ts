import { Resend } from "resend";
import { env } from "../src/config/env.js";

async function main() {
  console.log("Checking Resend configuration...");
  console.log("RESEND_API_KEY present:", Boolean(env.RESEND_API_KEY));
  console.log("EMAIL_FROM:", env.EMAIL_FROM || "onboarding@resend.dev");

  if (!env.RESEND_API_KEY) {
    console.log("Result: RESEND_API_KEY is not configured in .env.");
    console.log("Email dispatch will use durable Transactional Outbox and log simulation mode until an API key is supplied.");
    return;
  }

  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: env.EMAIL_FROM || "onboarding@resend.dev",
      to: ["delivered@resend.dev"],
      subject: "Test Resend Verification",
      html: "<p>Verification of Resend delivery</p>",
    });

    console.log("Resend API response:", result);
  } catch (err: any) {
    console.error("Resend API error:", err.message);
  }
}

main().catch(console.error);