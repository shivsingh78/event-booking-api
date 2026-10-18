import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export interface BookingConfirmationParams {
  to: string;
  customerName?: string;
  bookingId: string;
  eventTitle: string;
  venue: string;
  startsAt: string | Date;
  quantity: number;
}

export interface EventUpdateParams {
  to: string;
  eventTitle: string;
  venue: string;
  startsAt: string | Date;
  changeSummary?: string;
}

export async function sendBookingConfirmationEmail(params: BookingConfirmationParams) {
  const fromEmail = env.EMAIL_FROM || "onboarding@resend.dev";
  const formattedDate = new Date(params.startsAt).toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const subject = `Booking Confirmation: ${params.eventTitle}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${subject}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 24px; color: #1a202c; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        .header { background: #4f46e5; padding: 28px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; }
        .content { padding: 32px 24px; }
        .badge { display: inline-block; padding: 6px 12px; background: #e0e7ff; color: #3730a3; border-radius: 9999px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
        .details-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .details-table td { padding: 12px 0; border-bottom: 1px solid #edf2f7; font-size: 15px; }
        .label { color: #718096; width: 35%; font-weight: 500; }
        .value { color: #1a202c; font-weight: 600; }
        .footer { padding: 20px 24px; background: #f8fafc; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #edf2f7; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>Booking Confirmed!</h1>
        </div>
        <div class="content">
          <span class="badge">Confirmed Reference</span>
          <p style="font-size: 16px; line-height: 1.5; margin: 0 0 16px;">
            Thank you for your booking! Your tickets for <strong>${params.eventTitle}</strong> are reserved.
          </p>
          <table class="details-table">
            <tr>
              <td class="label">Booking ID</td>
              <td class="value">${params.bookingId}</td>
            </tr>
            <tr>
              <td class="label">Event</td>
              <td class="value">${params.eventTitle}</td>
            </tr>
            <tr>
              <td class="label">Venue</td>
              <td class="value">${params.venue}</td>
            </tr>
            <tr>
              <td class="label">Date & Time</td>
              <td class="value">${formattedDate}</td>
            </tr>
            <tr>
              <td class="label">Tickets</td>
              <td class="value">${params.quantity}</td>
            </tr>
          </table>
        </div>
        <div class="footer">
          Event Booking API &bull; Please present your Booking ID at the venue gate.
        </div>
      </div>
    </body>
    </html>
  `;

  if (!resend) {
    console.log(
      `[EmailService:Simulated] Booking confirmation email to: ${params.to} for event "${params.eventTitle}" (RESEND_API_KEY not configured)`
    );
    return { id: "simulated_" + Date.now(), to: params.to };
  }

  const response = await resend.emails.send({
    from: fromEmail,
    to: [params.to],
    subject,
    html,
  });

  if (response.error) {
    console.error(`[EmailService] Resend API error sending to ${params.to}:`, response.error);
    throw new Error(`Resend error: ${response.error.message || JSON.stringify(response.error)}`);
  }

  console.log(`[EmailService:Delivered] Booking confirmation sent to ${params.to}, Resend ID: ${response.data?.id}`);
  return response.data;
}

export async function sendEventUpdateEmail(params: EventUpdateParams) {
  const fromEmail = env.EMAIL_FROM || "onboarding@resend.dev";
  const formattedDate = new Date(params.startsAt).toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const subject = `Update for Event: ${params.eventTitle}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${subject}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 24px; color: #1a202c; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        .header { background: #f59e0b; padding: 28px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; }
        .content { padding: 32px 24px; }
        .badge { display: inline-block; padding: 6px 12px; background: #fef3c7; color: #92400e; border-radius: 9999px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
        .details-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .details-table td { padding: 12px 0; border-bottom: 1px solid #edf2f7; font-size: 15px; }
        .label { color: #718096; width: 35%; font-weight: 500; }
        .value { color: #1a202c; font-weight: 600; }
        .footer { padding: 20px 24px; background: #f8fafc; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #edf2f7; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>Important Event Update</h1>
        </div>
        <div class="content">
          <span class="badge">Schedule & Venue Notice</span>
          <p style="font-size: 16px; line-height: 1.5; margin: 0 0 16px;">
            The organizer has updated the event details for <strong>${params.eventTitle}</strong>.
          </p>
          <table class="details-table">
            <tr>
              <td class="label">Event Title</td>
              <td class="value">${params.eventTitle}</td>
            </tr>
            <tr>
              <td class="label">Venue</td>
              <td class="value">${params.venue}</td>
            </tr>
            <tr>
              <td class="label">Date & Time</td>
              <td class="value">${formattedDate}</td>
            </tr>
          </table>
        </div>
        <div class="footer">
          Event Booking API &bull; If you have questions, please contact the event organizer.
        </div>
      </div>
    </body>
    </html>
  `;

  if (!resend) {
    console.log(
      `[EmailService:Simulated] Event update email to: ${params.to} for event "${params.eventTitle}" (RESEND_API_KEY not configured)`
    );
    return { id: "simulated_" + Date.now(), to: params.to };
  }

  const response = await resend.emails.send({
    from: fromEmail,
    to: [params.to],
    subject,
    html,
  });

  if (response.error) {
    console.error(`[EmailService] Resend API error sending event update to ${params.to}:`, response.error);
    throw new Error(`Resend error: ${response.error.message || JSON.stringify(response.error)}`);
  }

  console.log(`[EmailService:Delivered] Event update sent to ${params.to}, Resend ID: ${response.data?.id}`);
  return response.data;
}