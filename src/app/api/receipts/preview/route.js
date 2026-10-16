// Settings → Rasid live preview: POST { settings, status } → a sample receipt PDF with the draft design.
import { route, readJson } from "@/lib/http.js";
import { adminOnly, publicOrigin } from "@/lib/access.js";
import { getTrustProfile } from "@/services/trust.js";
import { renderPdf } from "@/services/receiptJobs.js";
import { receiptSettingsForPdf } from "@/services/receiptSettings.js";

export const runtime = "nodejs";

const SAMPLE = (status) => ({
  memberId: "sample", registrationNumber: "R100042", applicationNumber: "42", displayName: "रमेश कुमार", fatherName: "मोहन लाल",
  phone: "9876543210", payAmount: 200, guardian: "सीता देवी", guardianRelation: "पत्नी", currentAddress: "मुख्य बाजार", village: "पाली",
  district: "pali", state: "rajasthan", agentName: "सुरेश घांची", agentPhone: "9999999999",
  marriages: [
    ["ईशा कुमारी", "राम लाल", "R200101", "जोधपुर", "05-08-2026", 200],
    ["पूजा", "भेरा राम", "R200117", "बालोतरा", "12-08-2026", 250],
    ["सीमा", "कालू राम", "R200130", "सोजत", "21-08-2026", 200],
    ["मंजू", "हीरा लाल", "R200152", "पाली", "02-09-2026", 300],
  ].map(([n, f, r, v, d, a], i) => ({
    paymentId: `s${i}`, status, amount: a, closingMemberName: n, closingFatherName: f, closingRegNo: r, closingVillage: v,
    closingState: "rajasthan", closingGuardian: f, closingGuardianRelation: "पिता", closingPhone: "9000000000", marriageDate: d,
  })),
});

export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  const { settings: raw, status: st } = await readJson(request);
  const status = st === "paid" ? "paid" : "pending";
  const settings = await receiptSettingsForPdf(auth.adminId, auth.features, raw);
  const pdf = await renderPdf({
    members: [SAMPLE(status)], programInfo: { name: "नमूना योजना" }, paymentStatus: status, receiptStartNo: 1,
    TrustData: await getTrustProfile(auth.adminId), settings,
    verify: { baseUrl: publicOrigin(request), codes: { "0001": "SAMPLE0001" } },
  }, "receipts");
  return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
});
