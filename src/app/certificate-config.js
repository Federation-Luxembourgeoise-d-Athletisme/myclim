import { PARTICIPATION_CERTIFICATE_SIGNATORY, PARTICIPATION_CERTIFICATE_SIGNATORY_TITLE } from "./seed-data";

function normalizeCertificateConfigurationPayload(data = {}) {
  return {
    signatoryName: String(data?.signatoryName || "").trim() || PARTICIPATION_CERTIFICATE_SIGNATORY,
    signatoryTitle: String(data?.signatoryTitle || "").trim() || PARTICIPATION_CERTIFICATE_SIGNATORY_TITLE,
    signatureImageUrl: String(data?.signatureImageUrl || "").trim(),
    signatureImagePath: String(data?.signatureImagePath || "").trim(),
  };
}

export { normalizeCertificateConfigurationPayload };
