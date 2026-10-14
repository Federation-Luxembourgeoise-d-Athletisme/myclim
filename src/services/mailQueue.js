import { getAppBaseUrl } from "./app-url";

function getMailFunctionUrl() {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  const configuredUrl = String(env.VITE_MAIL_FUNCTION_URL || "").trim();
  return configuredUrl || "/.netlify/functions/send-transactional-mail";
}

function getMailRequestTimeoutMs() {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  const configuredTimeout = Number(env.VITE_MAIL_REQUEST_TIMEOUT_MS || 8000);
  return Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 8000;
}

function getMeetingLogoUrl() {
  return `${getAppBaseUrl()}/cmcm-logo.png`;
}

function englishBox(content) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 24px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:16px;">
          <p style="margin:0 0 14px 0;font-size:13px;letter-spacing:1.4px;text-transform:uppercase;color:#6a7890;">English</p>
          ${content}
        </td>
      </tr>
    </table>`;
}

function buildBrandedEmailShell({ title, preheader, content }) {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
      </head>
      <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#10233f;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;">
                <tr>
                  <td style="background:linear-gradient(135deg,#0d6fb8 0%,#e30d25 100%);padding:32px 32px 24px 32px;text-align:center;">
                    <img src="${getMeetingLogoUrl()}" alt="CMCM Luxembourg Indoor Meeting" width="88" height="88" style="display:block;margin:0 auto 16px auto;border:0;" />
                    <p style="margin:0;color:#dcecff;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;">CMCM Luxembourg Indoor Meeting</p>
                    <h1 style="margin:12px 0 0 0;color:#ffffff;font-size:28px;line-height:1.2;">${title}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px;">
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 32px 32px;">
                    <p style="margin:0;padding-top:20px;border-top:1px solid #dbe4f0;color:#5d6b82;font-size:13px;line-height:1.6;">
                      CMCM Luxembourg Indoor Meeting<br />
                      MyCLIM volunteer platform
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export async function enqueueTransactionalMail(payload) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), getMailRequestTimeoutMs());
  let response;

  try {
    response = await fetch(getMailFunctionUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Le service mail n'a pas répondu assez vite.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorMessage = "Impossible d'envoyer le mail pour le moment.";

    try {
      const data = await response.json();
      errorMessage = data?.error || errorMessage;
    } catch {
      // Ignore parsing failures and use the default message.
    }

    throw new Error(errorMessage);
  }
}

// ─── Invitation admin ────────────────────────────────────────────────────────

export function buildInvitationMail({ email, firstName, roles, activationUrl }) {
  const displayName = String(firstName || "").trim() || "bonjour";
  const roleLabels = Array.isArray(roles) && roles.length
    ? roles.join(", ")
    : "Accès plateforme";

  return {
    type: "admin-invitation",
    to: email,
    subject: "Votre invitation MyCLIM / Your MyCLIM invitation",
    body: `Bonjour ${displayName},

Un administrateur de la plateforme MyCLIM vous a créé un compte avec les accès suivants : ${roleLabels}.

Cliquez sur le lien ci-dessous pour activer votre compte et choisir votre mot de passe :
${activationUrl}

Ce lien est valable 7 jours.

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting`,
    html: buildBrandedEmailShell({
      title: "Votre invitation MyCLIM",
      preheader: "Activez votre compte MyCLIM / Activate your MyCLIM account.",
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour ${displayName},</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Un administrateur vous a créé un compte sur <strong>MyCLIM</strong> avec les accès suivants&nbsp;:
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:16px 20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:12px;font-size:15px;line-height:1.6;">
              ${roleLabels}
            </td>
          </tr>
        </table>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Cliquez sur le bouton ci-dessous pour activer votre compte et choisir votre mot de passe. Ce lien est valable <strong>7 jours</strong>.
        </p>
        <p style="margin:0 0 28px 0;">
          <a href="${activationUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700;font-size:15px;">
            Activer mon compte →
          </a>
        </p>
        <p style="margin:0 0 8px 0;font-size:13px;color:#5d6b82;">
          Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br />
          <a href="${activationUrl}" style="color:#0f5f9c;word-break:break-all;">${activationUrl}</a>
        </p>
        <p style="margin:24px 0 0 0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

// ─── Compte créé (tous parcours) ────────────────────────────────────────────

export function buildAccountCreatedMail({ firstName, email }) {
  const displayName = String(firstName || "").trim() || "bonjour";
  const loginUrl = `${getAppBaseUrl()}/login`;

  return {
    type: "account-created",
    to: email,
    subject: "Votre compte MyCLIM a été créé / Your MyCLIM account has been created",
    body: `Bonjour ${displayName},

Merci d'avoir créé votre compte sur MyCLIM.

Vous retrouverez toutes les informations vous concernant durant le CMCM Luxembourg Indoor Meeting 2027 directement sur votre espace MyCLIM.

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello ${displayName},

Thank you for creating your account on MyCLIM.

You will find all information about your participation in the CMCM Luxembourg Indoor Meeting 2027 directly in your MyCLIM space.

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
    html: buildBrandedEmailShell({
      title: "Bienvenue sur MyCLIM",
      preheader: "Votre compte MyCLIM est prêt / Your MyCLIM account is ready.",
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour ${displayName},</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Merci d'avoir créé votre compte sur <strong>MyCLIM</strong>.
        </p>
        <p style="margin:0 0 28px 0;font-size:16px;line-height:1.7;">
          Vous retrouverez toutes les informations vous concernant durant le
          <strong>CMCM Luxembourg Indoor Meeting 2027</strong> directement sur votre espace MyCLIM.
        </p>
        <p style="margin:0 0 28px 0;">
          <a href="${loginUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">
            Accéder à MyCLIM
          </a>
        </p>
        ${englishBox(`
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello ${displayName},</p>
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
            Thank you for creating your account on <strong>MyCLIM</strong>.
          </p>
          <p style="margin:0;font-size:16px;line-height:1.7;">
            You will find all information about your participation in the
            <strong>CMCM Luxembourg Indoor Meeting 2027</strong> directly in your MyCLIM space.
          </p>
        `)}
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

// Keep old name as alias for backward compatibility
export function buildVolunteerAccountCreatedMail({ firstName, email }) {
  return buildAccountCreatedMail({ firstName, email });
}

// ─── Module bénévole complété ────────────────────────────────────────────────

export function buildVolunteerModuleCompletedMail({
  email,
  firstName,
  missionPreferences,
  availability,
  status,
}) {
  const displayName = String(firstName || "").trim() || "bonjour";
  const appUrl = `${getAppBaseUrl()}/app`;
  const prefList = Array.isArray(missionPreferences) && missionPreferences.length
    ? missionPreferences.join(", ")
    : "Not specified / Non renseigné";
  const prefListEn = Array.isArray(missionPreferences) && missionPreferences.length
    ? missionPreferences.join(", ")
    : "Not specified";
  const prefListFr = Array.isArray(missionPreferences) && missionPreferences.length
    ? missionPreferences.join(", ")
    : "Non renseigné";
  const availList = Array.isArray(availability) && availability.length
    ? availability.join(", ")
    : "Non renseigné";
  const availListEn = Array.isArray(availability) && availability.length
    ? availability.join(", ")
    : "Not specified";
  const statusLabel = status || "Candidature reçue";

  return {
    type: "volunteer-module-completed",
    to: email,
    subject: "Votre dossier bénévole MyCLIM a été enregistré / Your volunteer application has been saved",
    body: `Bonjour ${displayName},

Votre dossier bénévole a bien été enregistré sur MyCLIM.

Statut : ${statusLabel}
Préférences de mission : ${prefListFr}
Disponibilités : ${availList}

Vous retrouverez toutes les informations vous concernant durant le CMCM Luxembourg Indoor Meeting 2027 directement sur votre espace MyCLIM.

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello ${displayName},

Your volunteer application has been saved on MyCLIM.

Status: ${statusLabel}
Mission preferences: ${prefListEn}
Availability: ${availListEn}

You will find all information about your participation in the CMCM Luxembourg Indoor Meeting 2027 directly in your MyCLIM space.

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
    html: buildBrandedEmailShell({
      title: "Dossier bénévole enregistré",
      preheader: "Votre candidature bénévole a bien été reçue / Your volunteer application has been received.",
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour ${displayName},</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Votre <strong>dossier bénévole</strong> a bien été enregistré sur MyCLIM.
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:16px;">
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Statut</strong></p>
              <p style="margin:0 0 16px 0;font-size:16px;">${statusLabel}</p>
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Préférences de mission</strong></p>
              <p style="margin:0 0 16px 0;font-size:16px;">${prefListFr}</p>
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Disponibilités</strong></p>
              <p style="margin:0;font-size:16px;">${availList}</p>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 28px 0;">
          <a href="${appUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">
            Accéder à MyCLIM
          </a>
        </p>
        ${englishBox(`
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello ${displayName},</p>
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
            Your <strong>volunteer application</strong> has been saved on MyCLIM.
          </p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Status</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${statusLabel}</p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Mission preferences</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${prefListEn}</p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Availability</strong></p>
          <p style="margin:0;font-size:16px;">${availListEn}</p>
        `)}
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

// ─── Module pré-programme complété ──────────────────────────────────────────

export function buildPreProgramAccountCreatedMail({ parentFirstName, parentEmail, children }) {
  const displayName = String(parentFirstName || "").trim() || "bonjour";
  const appUrl = `${getAppBaseUrl()}/app`;

  const childSummaryFr = Array.isArray(children) && children.length
    ? children.map((child) => {
        const childName = [child.firstName, child.lastName].filter(Boolean).join(" ").trim();
        return child.requestType === "porte_panier"
          ? `- ${childName} : demande porte-panier`
          : `- ${childName} : ${child.requestedEvent || "pré-programme"}`;
      }).join("\n")
    : "- Aucun enfant enregistré";

  const childSummaryEn = Array.isArray(children) && children.length
    ? children.map((child) => {
        const childName = [child.firstName, child.lastName].filter(Boolean).join(" ").trim();
        return child.requestType === "porte_panier"
          ? `- ${childName}: basket carrier request`
          : `- ${childName}: ${child.requestedEvent || "pre-programme"}`;
      }).join("\n")
    : "- No child registered";

  const childRows = Array.isArray(children) && children.length
    ? children.map((child) => {
        const childName = [child.firstName, child.lastName].filter(Boolean).join(" ").trim();
        const request = child.requestType === "porte_panier"
          ? "Porte-panier"
          : child.requestedEvent || "Pré-programme";
        return `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #dbe4f0;font-size:15px;">${childName}</td>
          <td style="padding:8px 0;border-bottom:1px solid #dbe4f0;font-size:15px;text-align:right;">${request}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="2" style="padding:8px 0;font-size:15px;color:#5d6b82;">Aucun enfant enregistré</td></tr>`;

  return {
    type: "preprogram-account-created",
    to: parentEmail,
    subject: "Votre dossier pré-programme MyCLIM a été enregistré / Your pre-programme application has been saved",
    body: `Bonjour ${displayName},

Merci d'avoir créé votre compte sur MyCLIM.
Votre dossier pré-programme a bien été enregistré.

Demandes reçues :
${childSummaryFr}

Vous retrouverez toutes les informations vous concernant durant le CMCM Luxembourg Indoor Meeting 2027 directement sur votre espace MyCLIM.

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello ${displayName},

Thank you for creating your account on MyCLIM.
Your pre-programme application has been saved.

Requests received:
${childSummaryEn}

You will find all information about your participation in the CMCM Luxembourg Indoor Meeting 2027 directly in your MyCLIM space.

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
    html: buildBrandedEmailShell({
      title: "Dossier pré-programme enregistré",
      preheader: "Votre compte parent MyCLIM est prêt / Your MyCLIM parent account is ready.",
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour ${displayName},</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Merci d'avoir créé votre compte sur <strong>MyCLIM</strong>.
          Votre <strong>dossier pré-programme</strong> a bien été enregistré.
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:16px;">
              <p style="margin:0 0 14px 0;font-size:13px;letter-spacing:1.4px;text-transform:uppercase;color:#6a7890;">Demandes reçues</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${childRows}
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 28px 0;">
          <a href="${appUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">
            Accéder à MyCLIM
          </a>
        </p>
        ${englishBox(`
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello ${displayName},</p>
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
            Thank you for creating your account on <strong>MyCLIM</strong>.
            Your <strong>pre-programme application</strong> has been saved.
          </p>
          <p style="margin:0 0 8px 0;font-size:14px;letter-spacing:1.4px;text-transform:uppercase;color:#6a7890;">Requests received</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            ${childRows}
          </table>
          <p style="margin:12px 0 0 0;font-size:16px;line-height:1.7;">
            You will find all information about your participation in the
            <strong>CMCM Luxembourg Indoor Meeting 2027</strong> directly in your MyCLIM space.
          </p>
        `)}
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

// ─── Affectation bénévole ────────────────────────────────────────────────────

export function buildVolunteerRoleAssignmentMail({ email, firstName, assignedRole, teamRole }) {
  const displayName = String(firstName || "").trim() || "bonjour";
  const appUrl = `${getAppBaseUrl()}/app`;

  return {
    type: "volunteer-role-assigned",
    to: email,
    subject: "Votre affectation bénévole MyCLIM / Your volunteer assignment",
    body: `Bonjour ${displayName},

Une affectation vient d'être préparée pour vous sur MyCLIM.

Rôle principal : ${assignedRole || "À confirmer"}
Fonction : ${teamRole || "Bénévole"}

Connectez-vous à votre espace MyCLIM pour consulter les détails de mission et les informations utiles.

${appUrl}

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello ${displayName},

A volunteer assignment has been prepared for you on MyCLIM.

Main role: ${assignedRole || "To be confirmed"}
Function: ${teamRole || "Volunteer"}

Log in to your MyCLIM space to view your mission details and useful information.

${appUrl}

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
    html: buildBrandedEmailShell({
      title: "Votre affectation bénévole",
      preheader: "Une affectation a été préparée pour vous / An assignment has been prepared for you.",
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour ${displayName},</p>
        <p style="margin:0 0 22px 0;font-size:16px;line-height:1.7;">
          Une <strong>affectation bénévole</strong> vient d'être préparée pour vous sur MyCLIM.
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:16px;">
              <p style="margin:0 0 10px 0;font-size:13px;letter-spacing:1.4px;text-transform:uppercase;color:#6a7890;">Votre mission</p>
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Rôle principal</strong></p>
              <p style="margin:0 0 16px 0;font-size:16px;">${assignedRole || "À confirmer"}</p>
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Fonction</strong></p>
              <p style="margin:0;font-size:16px;">${teamRole || "Bénévole"}</p>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 28px 0;font-size:16px;line-height:1.7;">
          Connectez-vous à votre espace MyCLIM pour consulter les détails de mission et les informations utiles.
        </p>
        <p style="margin:0 0 28px 0;">
          <a href="${appUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">
            Accéder à MyCLIM
          </a>
        </p>
        ${englishBox(`
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello ${displayName},</p>
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
            A <strong>volunteer assignment</strong> has been prepared for you on MyCLIM.
          </p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Main role</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${assignedRole || "To be confirmed"}</p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Function</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${teamRole || "Volunteer"}</p>
          <p style="margin:0;font-size:16px;line-height:1.7;">
            Log in to your MyCLIM space to view your mission details and useful information.
          </p>
        `)}
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

// ─── Pré-programme U14 ───────────────────────────────────────────────────────

export function buildU14PreprogramAcceptanceMail({ parentEmail, childName, raceLabel }) {
  const appUrl = `${getAppBaseUrl()}/app`;

  return {
    type: "u14-confirmation-request",
    to: parentEmail,
    subject: "Votre enfant est retenu pour le pré-programme / Your child has been selected for the pre-programme",
    body: `Bonjour,

Votre enfant ${childName} est retenu(e) pour ${raceLabel}.

Merci de confirmer sa participation dans votre espace parent MyCLIM.

${appUrl}

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello,

Your child ${childName} has been selected for ${raceLabel}.

Please confirm their participation in your MyCLIM parent space.

${appUrl}

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
    html: buildBrandedEmailShell({
      title: "Place retenue — pré-programme",
      preheader: `${childName} est retenu(e) pour ${raceLabel} / ${childName} has been selected for ${raceLabel}.`,
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour,</p>
        <p style="margin:0 0 22px 0;font-size:16px;line-height:1.7;">
          Votre enfant <strong>${childName}</strong> est retenu(e) pour participer au pré-programme du
          <strong>CMCM Luxembourg Indoor Meeting 2027</strong>.
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:16px;">
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Enfant</strong></p>
              <p style="margin:0 0 16px 0;font-size:16px;">${childName}</p>
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Épreuve</strong></p>
              <p style="margin:0;font-size:16px;">${raceLabel}</p>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 28px 0;font-size:16px;line-height:1.7;">
          Merci de confirmer sa participation dans votre espace parent MyCLIM.
        </p>
        <p style="margin:0 0 28px 0;">
          <a href="${appUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">
            Confirmer la participation
          </a>
        </p>
        ${englishBox(`
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello,</p>
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
            Your child <strong>${childName}</strong> has been selected to participate in the pre-programme of the
            <strong>CMCM Luxembourg Indoor Meeting 2027</strong>.
          </p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Child</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${childName}</p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Event</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${raceLabel}</p>
          <p style="margin:0;font-size:16px;line-height:1.7;">
            Please confirm their participation in your MyCLIM parent space.
          </p>
        `)}
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

export function buildU14BasketAcceptanceMail({ parentEmail, childName }) {
  const appUrl = `${getAppBaseUrl()}/app`;

  return {
    type: "u14-basket-accepted",
    to: parentEmail,
    subject: "Votre enfant est retenu comme porte-panier / Your child has been selected as basket carrier",
    body: `Bonjour,

Votre enfant ${childName} est retenu(e) comme porte-panier pour le CMCM Luxembourg Indoor Meeting 2027.

Merci de confirmer sa participation dans votre espace parent MyCLIM.

${appUrl}

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello,

Your child ${childName} has been selected as a basket carrier for the CMCM Luxembourg Indoor Meeting 2027.

Please confirm their participation in your MyCLIM parent space.

${appUrl}

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
    html: buildBrandedEmailShell({
      title: "Place retenue — porte-panier",
      preheader: `${childName} est retenu(e) comme porte-panier / ${childName} has been selected as basket carrier.`,
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour,</p>
        <p style="margin:0 0 22px 0;font-size:16px;line-height:1.7;">
          Votre enfant <strong>${childName}</strong> est retenu(e) comme
          <strong>porte-panier</strong> pour le <strong>CMCM Luxembourg Indoor Meeting 2027</strong>.
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:16px;">
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Enfant</strong></p>
              <p style="margin:0 0 16px 0;font-size:16px;">${childName}</p>
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Rôle</strong></p>
              <p style="margin:0;font-size:16px;">Porte-panier</p>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 28px 0;font-size:16px;line-height:1.7;">
          Merci de confirmer sa participation dans votre espace parent MyCLIM.
        </p>
        <p style="margin:0 0 28px 0;">
          <a href="${appUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">
            Confirmer la participation
          </a>
        </p>
        ${englishBox(`
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello,</p>
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
            Your child <strong>${childName}</strong> has been selected as a
            <strong>basket carrier</strong> for the <strong>CMCM Luxembourg Indoor Meeting 2027</strong>.
          </p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Child</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${childName}</p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Role</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">Basket carrier</p>
          <p style="margin:0;font-size:16px;line-height:1.7;">
            Please confirm their participation in your MyCLIM parent space.
          </p>
        `)}
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

export function buildVipInvitationMail({
  category,
  email,
  firstName,
  greetingLabel,
  invitationUrl,
  language,
  lastName,
  organization,
}) {
  const invitationLanguage = String(language || "fr").trim().toLowerCase() === "en" ? "en" : "fr";
  const fullName = [String(firstName || "").trim(), String(lastName || "").trim()].filter(Boolean).join(" ").trim();
  const customGreetingLabel = String(greetingLabel || "").trim();
  const categoryLabel = String(category || "VIP").trim();
  const organizationLabel = String(organization || "").trim();
  const vipUrl = String(invitationUrl || `${getAppBaseUrl()}/vip`).trim();
  const automaticGreetingLabel =
    invitationLanguage === "en"
      ? categoryLabel
        ? `Dear ${categoryLabel}`
        : organizationLabel
          ? `Dear ${organizationLabel}`
          : "Hello"
      : categoryLabel
        ? `Cher ${categoryLabel}`
        : organizationLabel
          ? `Cher ${organizationLabel}`
          : "Bonjour";
  const greetingLine =
    customGreetingLabel || (fullName ? `${invitationLanguage === "en" ? "Dear" : "Bonjour"} ${fullName}` : automaticGreetingLabel);
  const greetingWithComma = /[,;:]$/.test(greetingLine) ? greetingLine : `${greetingLine},`;
  const meetingPlaceFr = "à la Coque, à Luxembourg";
  const meetingPlaceEn = "at the Coque in Luxembourg";

  return {
    type: "vip-invitation",
    to: email,
    subject:
      invitationLanguage === "en"
        ? "VIP Invitation - CMCM Luxembourg Indoor Meeting"
        : "Invitation VIP - CMCM Luxembourg Indoor Meeting",
    body:
      invitationLanguage === "en"
        ? `${greetingWithComma}

The Luxembourg Athletics Federation is delighted to invite you to the CMCM Luxembourg Indoor Meeting.

The meeting will take place ${meetingPlaceEn}.
We would be pleased to welcome you for this major athletics event.

Doors open from 2:00 PM.
Tours start at 2:15 PM and last around 40 minutes.
The pre-programme starts around 3:00 PM and the international programme at 4:00 PM.

Website: https://www.cmcm-luxembourg-indoor-meeting.lu

Please confirm your attendance using the link below:
${vipUrl}

This form also allows you to register a companion if needed.

We look forward to welcoming you,
The CMCM Luxembourg Indoor Meeting team`
        : `${greetingWithComma}

La Fédération Luxembourgeoise d'Athlétisme est heureuse de vous inviter au CMCM Luxembourg Indoor Meeting.

Le meeting se déroulera ${meetingPlaceFr}.
Nous serions ravis de vous accueillir à cette occasion pour partager ensemble ce grand rendez-vous de l'athlétisme.

Les portes ouvrent à partir de 14h00.
Les visites commencent à 14h15 et durent environ 40 min.
Le pré-programme commencera vers 15h00 et le programme international à 16h00.

Site internet : https://www.cmcm-luxembourg-indoor-meeting.lu

Merci de bien vouloir confirmer votre présence via le lien ci-dessous :
${vipUrl}

Ce formulaire permet également d'ajouter un accompagnant si nécessaire.

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting`,
    html: buildBrandedEmailShell({
      title: invitationLanguage === "en" ? "VIP Invitation" : "Invitation VIP",
      preheader:
        invitationLanguage === "en"
          ? "Confirm your attendance for the CMCM Luxembourg Indoor Meeting."
          : "Confirmez votre présence au CMCM Luxembourg Indoor Meeting.",
      content:
        invitationLanguage === "en"
          ? `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">${greetingWithComma}</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          The <strong>Luxembourg Athletics Federation</strong> is delighted to invite you to the
          <strong>CMCM Luxembourg Indoor Meeting</strong>.
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          The meeting will take place <strong>${meetingPlaceEn}</strong>. We would be pleased to welcome you for this major athletics event.
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Doors open from <strong>2:00 PM</strong>.<br />
          Tours start at <strong>2:15 PM</strong> and last around <strong>40 minutes</strong>.<br />
          The pre-programme starts around <strong>3:00 PM</strong> and the international programme at <strong>4:00 PM</strong>.
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Website:
          <a href="https://www.cmcm-luxembourg-indoor-meeting.lu" style="color:#0f5f9c;">
            www.cmcm-luxembourg-indoor-meeting.lu
          </a>
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Please confirm your attendance through the VIP form below. You may also add a companion there if needed.
        </p>
        <p style="margin:0 0 28px 0;">
          <a href="${vipUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">
            Confirm my attendance
          </a>
        </p>
        <p style="margin:0;font-size:15px;line-height:1.7;">
          Best regards,<br />
          <strong>The CMCM Luxembourg Indoor Meeting team</strong>
        </p>
      `
          : `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">${greetingWithComma}</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          La <strong>Fédération Luxembourgeoise d'Athlétisme</strong> est heureuse de vous inviter au
          <strong>CMCM Luxembourg Indoor Meeting</strong>.
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Le meeting se déroulera <strong>${meetingPlaceFr}</strong>. Nous serions ravis de vous accueillir à cette occasion pour partager ensemble ce grand rendez-vous de l'athlétisme.
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Les portes ouvrent à partir de <strong>14h00</strong>.<br />
          Les visites commencent à <strong>14h15</strong> et durent environ <strong>40 min</strong>.<br />
          Le pré-programme commencera vers <strong>15h00</strong> et le programme international à <strong>16h00</strong>.
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Site internet :
          <a href="https://www.cmcm-luxembourg-indoor-meeting.lu" style="color:#0f5f9c;">
            www.cmcm-luxembourg-indoor-meeting.lu
          </a>
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Merci de confirmer votre présence via le formulaire VIP ci-dessous. Vous pourrez également y ajouter un accompagnant si nécessaire.
        </p>
         <p style="margin:0 0 28px 0;">
          <a href="${vipUrl}" style="display:inline-block;background:#e30d25;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">
            Confirmer ma présence
          </a>
        </p>
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

export function buildVipRegistrationConfirmationMail({ email, firstName, language }) {
  const confirmationLanguage = String(language || "fr").trim().toLowerCase();
  const displayName = String(firstName || "").trim();
  const appGreeting =
    confirmationLanguage === "en"
      ? displayName
        ? `Dear ${displayName},`
        : "Hello,"
      : confirmationLanguage === "de"
        ? displayName
          ? `Hallo ${displayName},`
          : "Hallo,"
        : displayName
          ? `Bonjour ${displayName},`
          : "Bonjour,";
  const vipUrl = `${getAppBaseUrl()}/vip`;

  if (confirmationLanguage === "en") {
    return {
      type: "vip-registration-confirmation",
      to: email,
      subject: "VIP registration confirmed - CMCM Luxembourg Indoor Meeting",
      body: `${appGreeting}

Your VIP registration for the CMCM Luxembourg Indoor Meeting has been recorded successfully.

Doors open from 2:00 PM.
Tours start at 2:15 PM and last around 40 minutes.
The pre-programme starts around 3:00 PM and the international programme at 4:00 PM.

Website: https://www.cmcm-luxembourg-indoor-meeting.lu

If needed, you can use the following link again:
${vipUrl}

We look forward to welcoming you,
The CMCM Luxembourg Indoor Meeting team`,
      html: buildBrandedEmailShell({
        title: "VIP Registration Confirmed",
        preheader: "Your VIP registration has been recorded.",
        content: `
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">${appGreeting}</p>
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
            Your VIP registration for the <strong>CMCM Luxembourg Indoor Meeting</strong> has been recorded successfully.
          </p>
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
            Doors open from <strong>2:00 PM</strong>.<br />
            Tours start at <strong>2:15 PM</strong> and last around <strong>40 minutes</strong>.<br />
            The pre-programme starts around <strong>3:00 PM</strong> and the international programme at <strong>4:00 PM</strong>.
          </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Website:
          <a href="https://www.cmcm-luxembourg-indoor-meeting.lu" style="color:#0f5f9c;">
            www.cmcm-luxembourg-indoor-meeting.lu
          </a>
        </p>
        <p style="margin:0;font-size:15px;line-height:1.7;">
          Best regards,<br />
          <strong>The CMCM Luxembourg Indoor Meeting team</strong>
          </p>
        `,
      }),
    };
  }

  if (confirmationLanguage === "de") {
    return {
      type: "vip-registration-confirmation",
      to: email,
      subject: "VIP-Anmeldung bestätigt - CMCM Luxembourg Indoor Meeting",
      body: `${appGreeting}

Ihre VIP-Anmeldung für das CMCM Luxembourg Indoor Meeting wurde erfolgreich gespeichert.

Einlass ab 14:00 Uhr.
Die Führungen beginnen um 14:15 Uhr und dauern etwa 40 Minuten.
Das Vorprogramm beginnt gegen 15:00 Uhr, das internationale Programm um 16:00 Uhr.

Website: https://www.cmcm-luxembourg-indoor-meeting.lu

Bei Bedarf können Sie folgenden Link erneut verwenden:
${vipUrl}

Wir freuen uns darauf, Sie begrüßen zu dürfen,
Das Team des CMCM Luxembourg Indoor Meeting`,
      html: buildBrandedEmailShell({
        title: "VIP-Anmeldung bestätigt",
        preheader: "Ihre VIP-Anmeldung wurde gespeichert.",
        content: `
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">${appGreeting}</p>
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
            Ihre VIP-Anmeldung für das <strong>CMCM Luxembourg Indoor Meeting</strong> wurde erfolgreich gespeichert.
          </p>
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
            Einlass ab <strong>14:00 Uhr</strong>.<br />
            Die Führungen beginnen um <strong>14:15 Uhr</strong> und dauern etwa <strong>40 Minuten</strong>.<br />
            Das Vorprogramm beginnt gegen <strong>15:00 Uhr</strong>, das internationale Programm um <strong>16:00 Uhr</strong>.
          </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Website:
          <a href="https://www.cmcm-luxembourg-indoor-meeting.lu" style="color:#0f5f9c;">
            www.cmcm-luxembourg-indoor-meeting.lu
          </a>
        </p>
        <p style="margin:0;font-size:15px;line-height:1.7;">
          Mit freundlichen Grüßen,<br />
          <strong>Das Team des CMCM Luxembourg Indoor Meeting</strong>
          </p>
        `,
      }),
    };
  }

  return {
    type: "vip-registration-confirmation",
    to: email,
    subject: "Confirmation d'inscription VIP - CMCM Luxembourg Indoor Meeting",
    body: `${appGreeting}

Votre inscription VIP pour le CMCM Luxembourg Indoor Meeting a bien été enregistrée.

Les portes ouvrent à partir de 14h00.
Les visites commencent à 14h15 et durent environ 40 min.
Le pré-programme commencera vers 15h00 et le programme international à 16h00.

Site internet : https://www.cmcm-luxembourg-indoor-meeting.lu

Au plaisir de vous accueillir,
L'équipe du CMCM Luxembourg Indoor Meeting`,
    html: buildBrandedEmailShell({
      title: "Inscription VIP confirmée",
      preheader: "Votre inscription VIP a bien été enregistrée.",
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">${appGreeting}</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Votre inscription VIP pour le <strong>CMCM Luxembourg Indoor Meeting</strong> a bien été enregistrée.
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Les portes ouvrent à partir de <strong>14h00</strong>.<br />
          Les visites commencent à <strong>14h15</strong> et durent environ <strong>40 min</strong>.<br />
          Le pré-programme commencera vers <strong>15h00</strong> et le programme international à <strong>16h00</strong>.
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Site internet :
          <a href="https://www.cmcm-luxembourg-indoor-meeting.lu" style="color:#0f5f9c;">
            www.cmcm-luxembourg-indoor-meeting.lu
          </a>
        </p>
        <p style="margin:0;font-size:15px;line-height:1.7;">
          Au plaisir de vous accueillir,<br />
          <strong>L'équipe du CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

// ─── Communiqué / annonce presse ────────────────────────────────────────────

export function buildPressAnnouncementMail({ email, name, subject, body }) {
  const displayName = String(name || "").trim();
  const greeting = displayName ? `Bonjour ${displayName},` : "Bonjour,";
  const htmlBody = String(body || "")
    .split(/\n\n+/)
    .map((para) => `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.7;">${para.replace(/\n/g, "<br />")}</p>`)
    .join("");
  const plainBody = String(body || "");

  return {
    type: "press-announcement",
    to: email,
    subject: String(subject || "").trim() || "CMCM Luxembourg Indoor Meeting — Information presse",
    body: `${greeting}\n\n${plainBody}\n\nL'équipe CMCM Luxembourg Indoor Meeting`,
    html: buildBrandedEmailShell({
      title: String(subject || "Information presse").trim(),
      preheader: String(body || "").slice(0, 100).replace(/\n/g, " "),
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">${greeting}</p>
        ${htmlBody}
        <p style="margin:24px 0 0 0;font-size:15px;line-height:1.7;">
          Cordialement,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

// ─── Accréditation presse ────────────────────────────────────────────────────

export function buildPressRegistrationConfirmationMail({ email, firstName, requestType }) {
  const displayName = String(firstName || "").trim() || "bonjour";
  const requestTypeLabelFr = requestType === "photographer" ? "Photographe" : "Presse";
  const requestTypeLabelEn = requestType === "photographer" ? "Photographer" : "Press";
  const zonesFr = requestType === "photographer" ? "Mixed Zone et Infield" : "Mixed Zone";
  const zonesEn = requestType === "photographer" ? "Mixed Zone and Infield" : "Mixed Zone";

  return {
    type: "press-registration-confirmation",
    to: email,
    subject: "Demande d'accréditation presse reçue / Press accreditation request received",
    body: `Bonjour ${displayName},

Votre demande d'accréditation presse (${requestTypeLabelFr}) a bien été reçue et est en cours d'examen.

Type de demande : ${requestTypeLabelFr}
Zones d'accès (si acceptée) : ${zonesFr}

Vous recevrez une réponse dans les prochains jours.

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello ${displayName},

Your press accreditation request (${requestTypeLabelEn}) has been received and is under review.

Request type: ${requestTypeLabelEn}
Access zones (if accepted): ${zonesEn}

You will receive a response within the next few days.

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
    html: buildBrandedEmailShell({
      title: "Demande d'accréditation presse",
      preheader: "Votre demande d'accréditation presse a bien été reçue / Your press accreditation request has been received.",
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour ${displayName},</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Votre <strong>demande d'accréditation presse</strong> a bien été reçue et est en cours d'examen.
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:16px;">
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Type de demande</strong></p>
              <p style="margin:0 0 16px 0;font-size:16px;">${requestTypeLabelFr}</p>
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Zones d'accès (si acceptée)</strong></p>
              <p style="margin:0 0 16px 0;font-size:16px;">${zonesFr}</p>
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Statut</strong></p>
              <p style="margin:0;font-size:16px;">En cours d'examen</p>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 28px 0;font-size:16px;line-height:1.7;">
          Vous recevrez une réponse dans les prochains jours.
        </p>
        ${englishBox(`
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello ${displayName},</p>
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
            Your <strong>press accreditation request</strong> has been received and is under review.
          </p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Request type</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${requestTypeLabelEn}</p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Access zones (if accepted)</strong></p>
          <p style="margin:0 0 12px 0;font-size:16px;">${zonesEn}</p>
          <p style="margin:0 0 6px 0;font-size:14px;"><strong>Status</strong></p>
          <p style="margin:0;font-size:16px;">Under review</p>
        `)}
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}

export function buildPressRegistrationDecisionMail({ email, firstName, requestType, decision, rejectionComment }) {
  const displayName = String(firstName || "").trim() || "bonjour";
  const requestTypeLabelFr = requestType === "photographer" ? "Photographe" : "Presse";
  const requestTypeLabelEn = requestType === "photographer" ? "Photographer" : "Press";
  const isAccepted = decision === "accepted";
  const zonesFr = requestType === "photographer" ? "Mixed Zone et Infield" : "Mixed Zone";
  const zonesEn = requestType === "photographer" ? "Mixed Zone and Infield" : "Mixed Zone";

  if (isAccepted) {
    return {
      type: "press-registration-accepted",
      to: email,
      subject: "Accréditation presse acceptée / Press accreditation accepted — CMCM Luxembourg Indoor Meeting",
      body: `Bonjour ${displayName},

Votre demande d'accréditation presse (${requestTypeLabelFr}) a été acceptée pour le CMCM Luxembourg Indoor Meeting.

Zones d'accès : ${zonesFr}

Votre badge vous sera remis le jour du meeting. Merci de vous présenter à l'accueil presse dès votre arrivée.

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello ${displayName},

Your press accreditation request (${requestTypeLabelEn}) has been accepted for the CMCM Luxembourg Indoor Meeting.

Access zones: ${zonesEn}

Your badge will be handed to you on the day of the meeting. Please check in at the press desk upon arrival.

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
      html: buildBrandedEmailShell({
        title: "Accréditation presse acceptée",
        preheader: "Votre accréditation presse a été acceptée / Your press accreditation has been accepted.",
        content: `
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour ${displayName},</p>
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
            Votre <strong>demande d'accréditation presse</strong> a été <strong>acceptée</strong> pour le
            <strong>CMCM Luxembourg Indoor Meeting</strong>.
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
            <tr>
              <td style="padding:20px;background:#f0faf4;border:1px solid #b7e4c7;border-radius:16px;">
                <p style="margin:0 0 6px 0;font-size:14px;"><strong>Type d'accréditation</strong></p>
                <p style="margin:0 0 16px 0;font-size:16px;">${requestTypeLabelFr}</p>
                <p style="margin:0 0 6px 0;font-size:14px;"><strong>Zones d'accès</strong></p>
                <p style="margin:0;font-size:16px;">${zonesFr}</p>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 28px 0;font-size:16px;line-height:1.7;">
            Votre badge vous sera remis le jour du meeting. Merci de vous présenter à l'<strong>accueil presse</strong> dès votre arrivée.
          </p>
          ${englishBox(`
            <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello ${displayName},</p>
            <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
              Your <strong>press accreditation request</strong> has been <strong>accepted</strong> for the
              <strong>CMCM Luxembourg Indoor Meeting</strong>.
            </p>
            <p style="margin:0 0 6px 0;font-size:14px;"><strong>Accreditation type</strong></p>
            <p style="margin:0 0 12px 0;font-size:16px;">${requestTypeLabelEn}</p>
            <p style="margin:0 0 6px 0;font-size:14px;"><strong>Access zones</strong></p>
            <p style="margin:0 0 12px 0;font-size:16px;">${zonesEn}</p>
            <p style="margin:0;font-size:16px;line-height:1.7;">
              Your badge will be handed to you on the day of the meeting. Please check in at the <strong>press desk</strong> upon arrival.
            </p>
          `)}
          <p style="margin:0;font-size:15px;line-height:1.7;">
            À bientôt,<br />
            <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
          </p>
        `,
      }),
    };
  }

  return {
    type: "press-registration-rejected",
    to: email,
    subject: "Demande d'accréditation presse — CMCM Luxembourg Indoor Meeting",
    body: `Bonjour ${displayName},

Nous avons bien étudié votre demande d'accréditation presse (${requestTypeLabelFr}).

Après examen, nous ne sommes pas en mesure de donner suite à votre demande pour cette édition.${rejectionComment ? `\n\nMotif : ${rejectionComment}` : ""}

À bientôt,
L'équipe CMCM Luxembourg Indoor Meeting

---

Hello ${displayName},

We have reviewed your press accreditation request (${requestTypeLabelEn}).

After consideration, we are unable to grant your request for this edition.${rejectionComment ? `\n\nReason: ${rejectionComment}` : ""}

See you soon,
The CMCM Luxembourg Indoor Meeting team`,
    html: buildBrandedEmailShell({
      title: "Demande d'accréditation presse",
      preheader: "Suite donnée à votre demande d'accréditation presse.",
      content: `
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">Bonjour ${displayName},</p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Nous avons bien étudié votre <strong>demande d'accréditation presse</strong> (${requestTypeLabelFr}).
        </p>
        <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;">
          Après examen, nous ne sommes pas en mesure de donner suite à votre demande pour cette édition.
        </p>
        ${rejectionComment ? `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:20px;background:#f6f9fc;border:1px solid #dbe4f0;border-radius:16px;">
              <p style="margin:0 0 6px 0;font-size:14px;"><strong>Motif</strong></p>
              <p style="margin:0;font-size:16px;">${rejectionComment}</p>
            </td>
          </tr>
        </table>` : ""}
        ${englishBox(`
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">Hello ${displayName},</p>
          <p style="margin:0 0 12px 0;font-size:16px;line-height:1.7;">
            We have reviewed your <strong>press accreditation request</strong> (${requestTypeLabelEn}).
          </p>
          <p style="margin:0;font-size:16px;line-height:1.7;">
            After consideration, we are unable to grant your request for this edition.
          </p>
          ${rejectionComment ? `<p style="margin:12px 0 0 0;font-size:16px;"><strong>Reason:</strong> ${rejectionComment}</p>` : ""}
        `)}
        <p style="margin:0;font-size:15px;line-height:1.7;">
          À bientôt,<br />
          <strong>L'équipe CMCM Luxembourg Indoor Meeting</strong>
        </p>
      `,
    }),
  };
}
