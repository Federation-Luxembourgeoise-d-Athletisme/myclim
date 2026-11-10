import nodemailer from "nodemailer";

let transporterPromise;
let graphAccessToken;
let graphAccessTokenExpiresAt = 0;

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readOptionalEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function buildHtmlFromText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join("");
}

function getMailTransport() {
  const configuredTransport = readOptionalEnv("MAIL_TRANSPORT").toLowerCase();
  if (configuredTransport) return configuredTransport;

  if (
    readOptionalEnv("MICROSOFT_GRAPH_TENANT_ID") &&
    readOptionalEnv("MICROSOFT_GRAPH_CLIENT_ID") &&
    readOptionalEnv("MICROSOFT_GRAPH_CLIENT_SECRET") &&
    readOptionalEnv("MICROSOFT_GRAPH_SENDER")
  ) {
    return "graph";
  }

  return "smtp";
}

function getDefaultFromAddress() {
  if (getMailTransport() === "graph") {
    return readOptionalEnv("MICROSOFT_GRAPH_FROM") || readRequiredEnv("MICROSOFT_GRAPH_SENDER");
  }

  return process.env.SMTP_FROM || readRequiredEnv("SMTP_USER");
}

async function createSmtpTransporter() {
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const nextTransporter = nodemailer.createTransport({
    host: readRequiredEnv("SMTP_HOST"),
    port: smtpPort,
    secure: smtpSecure,
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 2),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 20),
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
    auth: {
      user: readRequiredEnv("SMTP_USER"),
      pass: readRequiredEnv("SMTP_PASS"),
    },
  });

  return nextTransporter;
}

async function getSmtpTransporter() {
  if (!transporterPromise) {
    transporterPromise = createSmtpTransporter().catch((error) => {
      transporterPromise = undefined;
      throw error;
    });
  }

  return transporterPromise;
}

async function fetchGraphAccessToken() {
  const tenantId = readRequiredEnv("MICROSOFT_GRAPH_TENANT_ID");
  const clientId = readRequiredEnv("MICROSOFT_GRAPH_CLIENT_ID");
  const clientSecret = readRequiredEnv("MICROSOFT_GRAPH_CLIENT_SECRET");

  if (graphAccessToken && Date.now() < graphAccessTokenExpiresAt) {
    return graphAccessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.error_description || payload?.error?.message || "Unable to fetch Microsoft Graph access token.",
    );
  }

  graphAccessToken = payload.access_token;
  graphAccessTokenExpiresAt =
    Date.now() + Math.max((Number(payload.expires_in) || 3600) - 120, 60) * 1000;
  return graphAccessToken;
}

function toGraphRecipients(addresses) {
  return String(addresses || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

// Pièces jointes acceptées (décompte Excel / PDF) : 3 au plus, 3 Mo chacune,
// envoyées en base64 par l'application.
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
]);
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  if (attachments.length > MAX_ATTACHMENTS) {
    const error = new Error("Too many attachments.");
    error.statusCode = 400;
    throw error;
  }
  return attachments.map((attachment) => {
    const filename = String(attachment?.filename || "").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
    const contentType = String(attachment?.contentType || "");
    const content = String(attachment?.contentBase64 || "");
    const bytes = Math.floor((content.length * 3) / 4);
    if (!filename || !ALLOWED_ATTACHMENT_TYPES.has(contentType) || !/^[A-Za-z0-9+/=]+$/.test(content) || bytes > MAX_ATTACHMENT_BYTES) {
      const error = new Error("Invalid attachment.");
      error.statusCode = 400;
      throw error;
    }
    return { filename, contentType, contentBase64: content };
  });
}

async function sendMailWithGraph({ to, cc, subject, text, html, attachments = [] }) {
  const sender = readRequiredEnv("MICROSOFT_GRAPH_SENDER");
  const fromAddress = getDefaultFromAddress();
  const accessToken = await fetchGraphAccessToken();
  const recipients = toGraphRecipients(to);
  const ccRecipients = toGraphRecipients(cc);

  if (!recipients.length) {
    throw new Error("At least one recipient email address is required.");
  }

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: {
            contentType: html ? "HTML" : "Text",
            content: html || text || "",
          },
          toRecipients: recipients,
          ...(ccRecipients.length ? { ccRecipients } : {}),
          ...(attachments.length
            ? {
                attachments: attachments.map((attachment) => ({
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  name: attachment.filename,
                  contentType: attachment.contentType,
                  contentBytes: attachment.contentBase64,
                })),
              }
            : {}),
          from: {
            emailAddress: {
              address: fromAddress,
            },
          },
        },
        saveToSentItems: true,
      }),
    },
  );

  if (!response.ok) {
    let errorMessage = "Unable to send email with Microsoft Graph.";

    try {
      const payload = await response.json();
      errorMessage = payload?.error?.message || errorMessage;
    } catch {
      // Ignore JSON parsing errors and use the default message.
    }

    throw new Error(errorMessage);
  }

  return {
    messageId: `graph-${Date.now()}`,
    accepted: [...recipients, ...ccRecipients].map((recipient) => recipient.emailAddress.address),
    rejected: [],
  };
}

function normalizeMailPayload(payload) {
  const to = String(payload?.to || "").trim();
  const cc = String(payload?.cc || "").trim();
  const subject = String(payload?.subject || "").trim();
  const text = String(payload?.body || payload?.text || "").trim();
  const html = String(payload?.html || "").trim() || buildHtmlFromText(text);

  if (!to || !subject || (!text && !html)) {
    const error = new Error("Missing required fields: to, subject, and body or html.");
    error.statusCode = 400;
    throw error;
  }

  const attachments = normalizeAttachments(payload?.attachments);
  return { to, ...(cc ? { cc } : {}), subject, text: text || subject, html, ...(attachments.length ? { attachments } : {}) };
}

export async function sendTransactionalMail(payload) {
  const normalizedPayload = normalizeMailPayload(payload);

  if (getMailTransport() === "graph") {
    return sendMailWithGraph(normalizedPayload);
  }

  const transporter = await getSmtpTransporter();
  const { attachments = [], ...message } = normalizedPayload;
  const info = await transporter.sendMail({
    from: getDefaultFromAddress(),
    ...message,
    ...(attachments.length
      ? {
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.contentBase64,
            encoding: "base64",
            contentType: attachment.contentType,
          })),
        }
      : {}),
  });

  return {
    messageId: info.messageId || "",
    accepted: Array.isArray(info.accepted) ? info.accepted : [],
    rejected: Array.isArray(info.rejected) ? info.rejected : [],
  };
}
