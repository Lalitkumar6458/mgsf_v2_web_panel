import { route, readJson } from "@/lib/http.js";
import { sendMail } from "@/lib/mail.js";
import { badRequest, forbidden } from "@/lib/errors.js";

/** POST { to, subject, htmlContent, textContent?, attachments? } — admin / agent only */
export const POST = route(async ({ request, auth }) => {
  if (auth.role === "member") throw forbidden();
  const { to, subject, htmlContent, textContent, attachments } = await readJson(request);
  if (!to || !subject || !htmlContent) throw badRequest("Missing required fields.");
  const r = await sendMail({ to, subject, html: htmlContent, text: textContent, attachments });
  if (!r.sent) throw badRequest("Email is not configured on the server (SMTP_* in .env)");
  return { success: true, message: "Email sent successfully." };
});
