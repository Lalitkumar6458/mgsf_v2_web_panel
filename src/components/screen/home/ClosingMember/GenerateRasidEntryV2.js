"use client";
// Replaces the old GenerateRasidEntry tool. Payment entries are now created by the
// server automatically (closing recorded / member accepted), so bulk "generate" and
// "cleanup" runs are no longer needed. Per-member fixes: Members → ⋯ → Payment Details → Correct Payments.
import { Drawer, Alert, Typography } from "antd";

const { Paragraph } = Typography;

export default function GenerateRasidEntryV2({ open, setOpen }) {
  return (
    <Drawer title="Payment Entries" open={open} onClose={() => setOpen(false)} width={520}>
      <Alert
        type="success"
        showIcon
        message="Entries are created automatically now"
        description="जब किसी सदस्य की closing दर्ज होती है, सर्वर उसी समय सभी योग्य सदस्यों की payment entries बना देता है। अलग से generate करने की ज़रूरत नहीं है।"
        style={{ marginBottom: 16 }}
      />
      <Paragraph>
        किसी एक सदस्य की entries ठीक करनी हों (missing / extra): <b>Members → ⋯ → Payment Details → Correct Payments</b>।
      </Paragraph>
      <Paragraph>
        Closing की तारीख बदलने पर (Edit), उस closing की entries सर्वर अपने-आप दोबारा मिला देता है। Paid entries कभी नहीं हटतीं।
      </Paragraph>
    </Drawer>
  );
}
