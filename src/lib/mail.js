import nodemailer from "nodemailer";

let transporter;
function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export async function sendMail({ to, subject, html, text, attachments }) {
  const t = getTransporter();
  if (!t) {
    console.warn("[mail] SMTP not configured — mail to", to, "not sent:", subject);
    return { sent: false };
  }
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html, text, attachments });
  return { sent: true };
}
