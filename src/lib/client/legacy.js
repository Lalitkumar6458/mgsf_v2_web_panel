// The old screens were written for Firestore documents (photoURL, delete_flag,
// marriage_flag, "DD-MM-YYYY" dates …). These helpers turn API rows into that
// old shape so the screens work with only small changes.

/** "YYYY-MM-DD" (or ISO) → "DD-MM-YYYY" */
export function dmy(v) {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v);
}

/** ISO string → object that behaves like a Firestore Timestamp (toDate(), seconds) */
export function ts(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  return {
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(d),
    toMillis: () => d.getTime(),
    toISOString: () => d.toISOString(),
    toString: () => d.toISOString(),
  };
}

export function toLegacyMember(m) {
  if (!m) return m;
  const closed = !!m.closingDate;
  return {
    ...(m.extra || {}),
    ...m,
    photoURL: m.photoUrl || "",
    extraImageURL: m.extraImageUrl || "",
    documentFrontURL: m.documentFrontUrl || "",
    documentBackURL: m.documentBackUrl || "",
    guardianDocumentURL: m.guardianDocumentUrl || "",
    guardianDocumentBackURL: m.guardianDocumentBackUrl || "",
    invitationCardURL: m.invitationCardUrl || "",
    bobDate: dmy(m.birthDate),
    dateJoin: dmy(m.dateJoin),
    membershipClosingDate: m.membershipClosingDate ? dmy(m.membershipClosingDate) : null,
    locactionGroupId: m.locationGroupId || "",
    joinFeesTxtId: m.joinFeesTxnId || "",
    delete_flag: !!m.deleted,
    // old meaning: false for requests (pending), rejected, removed and blocked members
    active_flag: !!m.active && !m.blocked && !["pending", "rejected", "removed"].includes(m.status),
    isBlocked: !!m.blocked,
    status: m.blocked ? "blocked" : m.status,
    marriage_flag: closed,
    marriage_date: closed ? dmy(m.closingDate) : null,
    closing_date: closed ? dmy(m.closingDate) : null,
    closing_date_query: closed ? m.closingDate : null,
    closingAt: ts(m.closingAt),
    closingGroupName: m.closingGroupName || "",
    createdAt: ts(m.createdAt),
    updatedAt: ts(m.updatedAt),
    requestCreatedAt: ts(m.extra?.requestCreatedAt || m.createdAt),
  };
}

export function toLegacyAgent(a, programId) {
  if (!a) return a;
  return {
    ...(a.extra || {}),
    ...a,
    uid: a.id, // old screens used the Firebase uid as the agent id
    photoURL: a.photoUrl || "",
    signatureURL: a.signatureUrl || "",
    documentURLs: a.documentUrls || [],
    dateJoin: dmy(a.dateJoin),
    active_flags: !!a.active,
    delete_flags: !!a.deleted,
    programCounts: programId ? { [programId]: a.activeMembers ?? 0 } : {},
    createdAt: ts(a.createdAt),
  };
}

export function toLegacyProgram(p) {
  if (!p) return p;
  return {
    ...(p.extra || {}),
    ...p,
    memberCount: p.activeMembers ?? 0,
    inactivemembercount: p.inactiveMembers ?? 0,
    createdAt: ts(p.createdAt),
    updatedAt: ts(p.updatedAt),
  };
}

/** Due row (GET /members/:id/dues) → old payment_pending document */
export function toLegacyDue(d, payerId) {
  return {
    id: d.id,
    closingMemberId: d.closingMemberId,
    memberId: payerId,
    status: d.status,
    payAmount: d.amount,
    paidAmount: d.paidAmount,
    dueDate: dmy(d.dueDate),
    addedManually: d.addedManually,
    paymentFor: d.closingMemberName,
    closingRegNo: d.closingRegNo,
    closingApplicationNumber: d.closingApplicationNumber,
    closingFatherName: d.closingFatherName,
    closing_date: dmy(d.closingDate),
    village: d.closingVillage,
    closingGroupId: d.closingGroupId,
    delete_flag: false,
  };
}

/** Transaction row (GET /programs/:id/transactions) → old transactions document */
export function toLegacyTransaction(t) {
  return {
    ...(t.extra || {}),
    ...t,
    payerId: t.payerMemberId,
    payerName: t.payerName || "",
    payerFatherName: t.payerFatherName || "",
    payerRegistrationNumber: t.payerRegistrationNumber || "",
    payerPhone: t.payerPhone || "",
    payerPhoto: t.payerPhoto || "",
    marriageId: t.closingMemberId,
    marriageMemberName: t.closingMemberName || "",
    marriageRegistrationNumber: t.closingMemberRegistrationNumber || "",
    closingMemberFatherName: t.closingMemberFatherName || "",
    marriageDate: dmy(t.marriageDate),
    paymentPendingId: t.dueId || "",
    active_flag: t.status === "completed",
    delete_flag: t.status !== "completed",
    createdAt: ts(t.createdAt),
    updatedAt: ts(t.updatedAt),
  };
}

/** Row from GET /members/:closingId/closing-dues → old payment_pending document (with memberDetails) */
export function toLegacyClosingDue(d) {
  return {
    id: d.id,
    key: d.id,
    closingMemberId: d.closingMemberId,
    memberId: d.payerMemberId,
    status: d.status,
    payAmount: d.amount,
    paidAmount: d.paidAmount,
    dueDate: dmy(d.dueDate),
    paymentDate: d.paidAt || null,
    paymentMethod: d.paymentMethod || "",
    onlineReference: d.onlineReference || "",
    addedManually: d.addedManually,
    delete_flag: false,
    memberDetails: {
      displayName: d.payerName || "Unknown",
      registrationNumber: d.payerRegNo || "N/A",
      applicationNumber: d.payerApplicationNumber || "N/A",
      fatherName: d.payerFatherName || "N/A",
      phone: d.payerPhone || "N/A",
      village: d.payerVillage || "N/A",
      district: d.payerDistrict || "N/A",
      photoURL: d.payerPhoto || "",
      agentId: d.agentId || "",
      addedByName: d.addedByName || "N/A",
      dateJoin: dmy(d.payerDateJoin),
      currentStatus: d.payerStatus,
    },
  };
}
