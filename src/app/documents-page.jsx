import { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDocumentUploadErrorMessage } from "./common-helpers";
import { buildAccreditationUsers } from "./accreditation-helpers";
import { normalizeAccreditationConfigurationPayload } from "./accreditation-config";
import {
  ACCREDITATION_CONFIGURATION_DOC_PATH,
  TEAM_CONFIGURATION_DOC_PATH,
  JUDGE_ROSTER_DOC_PATH,
} from "./seed-data";
import { useDocumentsCollection } from "./documents-hooks";
import { getActiveEditionId, recordMatchesEdition, useActiveEdition } from "./edition";
import { useBudgetInvoiceConfiguration, useTeamConfiguration } from "./config-hooks";
import { canUserUploadBudgetInvoice } from "./budget-invoice-config";
import { InvoiceUploadForm } from "./invoice-management";
import { FileUpload } from "./file-upload";
import {
  formatDateTimeForDisplay,
  getU14RaceLabel,
  getU14WorkflowStatusLabel,
} from "./u14-helpers";
import { normalizePresenceRecord } from "./presence-helpers";
import { normalizeTeamConfigurationPayload } from "./team-config";
import { isTeamLeadAssignment } from "./common-helpers";
import { mapVolunteerApplicationToAdminVolunteer } from "./volunteer-helpers";
import { extractRolesFromProfile, getDisplayName } from "./utils";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";

const EMERGENCY_EXTRACTION_DEFINITIONS = [
  {
    id: "pack",
    title: "Pack complet urgence",
    description: "Toutes les listes critiques en un seul PDF prêt à imprimer ou enregistrer.",
    buttonLabel: "Générer le pack PDF",
  },
  {
    id: "volunteers",
    title: "Contacts bénévoles",
    description: "Coordonnées, affectations, statut opérationnel et contact légal si bénévole mineur.",
    buttonLabel: "Exporter les bénévoles",
  },
  {
    id: "teams",
    title: "Bénévoles par équipe",
    description: "Répartition des bénévoles par équipe avec noms triés par ordre alphabétique de nom de famille.",
    buttonLabel: "Exporter par équipe",
  },
  {
    id: "accreditations",
    title: "Accréditations par guichet",
    description: "Badges imprimés et rangés, regroupés par point de retrait pour le guichet.",
    buttonLabel: "Exporter les accréditations",
  },
  {
    id: "operations",
    title: "Contacts commandement",
    description: "Admins, gestionnaires, chefs d'équipe et référents d'équipes configurés.",
    buttonLabel: "Exporter les contacts",
  },
  {
    id: "presence",
    title: "Pointage et repas",
    description: "Vue d'urgence pour arrivée, repas et fin de mission des bénévoles affectés.",
    buttonLabel: "Exporter le suivi",
  },
  {
    id: "u14",
    title: "Familles U12/U14",
    description: "Enfants, parents, contacts et statuts du pré-programme à avoir sous la main.",
    buttonLabel: "Exporter le pré-programme",
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeTextValue(value, fallback = "—") {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || fallback;
}

function formatBooleanLabel(value, positiveLabel = "Oui", negativeLabel = "Non") {
  return value ? positiveLabel : negativeLabel;
}

function formatRoleList(values = [], fallback = "Non affecté") {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return normalizedValues.length ? normalizedValues.join(", ") : fallback;
}

function formatPresenceLabel(record) {
  return record.status === "present" ? "Présent" : "Absent";
}

function formatDateTimeValue(value, fallback = "Non pointé") {
  return value ? formatDateTimeForDisplay(value) : fallback;
}

function formatDisplayName(lastName, firstName, fallback = "—") {
  const normalizedLastName = String(lastName || "").trim();
  const normalizedFirstName = String(firstName || "").trim();
  const fullName = [normalizedLastName, normalizedFirstName].filter(Boolean).join(" ").trim();
  return fullName || fallback;
}

function compareByDisplayName(left, right) {
  return String(left.displayName || "").localeCompare(String(right.displayName || ""), "fr", {
    sensitivity: "base",
  });
}

function buildPrintTableMarkup(columns, rows) {
  return `
    <table class="extraction-table">
      <thead>
        <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${
          rows.length > 0
            ? rows
                .map(
                  (row) =>
                    `<tr>${row.map((cell) => `<td>${String(cell ?? "—") || "—"}</td>`).join("")}</tr>`,
                )
                .join("")
            : `<tr><td colspan="${columns.length}">Aucune donnée disponible.</td></tr>`
        }
      </tbody>
    </table>
  `;
}

function buildPrintSectionMarkup(section) {
  return `
    <section class="extraction-section">
      <div class="extraction-section__head">
        <h2>${escapeHtml(section.title)}</h2>
        ${section.subtitle ? `<p>${escapeHtml(section.subtitle)}</p>` : ""}
      </div>
      ${buildPrintTableMarkup(section.columns, section.rows)}
    </section>
  `;
}

function buildEmergencyPrintMarkup({ title, subtitle, sections }) {
  const generatedAt = new Intl.DateTimeFormat("fr-LU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Aptos", "Segoe UI", Arial, sans-serif;
          color: #163748;
          background: #ffffff;
        }
        .extraction-print {
          display: grid;
          gap: 8mm;
        }
        .extraction-cover {
          border: 0.5mm solid #d8e3ec;
          border-radius: 4mm;
          padding: 7mm 8mm;
          background: linear-gradient(135deg, #f7fbff, #ffffff);
        }
        .extraction-cover__eyebrow {
          margin: 0 0 2mm;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          font-size: 8pt;
          font-weight: 700;
          color: #638091;
        }
        .extraction-cover h1 {
          margin: 0 0 2mm;
          font-size: 24pt;
          line-height: 1.05;
          color: #103b58;
        }
        .extraction-cover p {
          margin: 0;
          font-size: 10.5pt;
          line-height: 1.55;
          color: #355160;
        }
        .extraction-section {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .extraction-section + .extraction-section {
          page-break-before: always;
        }
        .extraction-section__head {
          margin-bottom: 4mm;
        }
        .extraction-section__head h2 {
          margin: 0 0 1.5mm;
          font-size: 16pt;
          color: #103b58;
        }
        .extraction-section__head p {
          margin: 0;
          font-size: 10pt;
          color: #587080;
        }
        .extraction-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        .extraction-table th,
        .extraction-table td {
          border: 0.25mm solid #d7e1e9;
          padding: 2.3mm;
          vertical-align: top;
          text-align: left;
          font-size: 8.6pt;
          line-height: 1.4;
          word-break: break-word;
        }
        .extraction-table th {
          background: #eef6fd;
          color: #103b58;
          font-weight: 800;
        }
        .extraction-table td small {
          display: block;
          color: #5b7280;
          font-size: 7.8pt;
        }
        .extraction-print-note {
          font-size: 8.4pt;
          color: #6d8390;
        }
        @media print {
          .extraction-print-note {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <main class="extraction-print">
        <header class="extraction-cover">
          <p class="extraction-cover__eyebrow">MyCLIM · Extractions d'urgence</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
          <p>Généré le ${escapeHtml(generatedAt)}</p>
        </header>
        ${sections.map(buildPrintSectionMarkup).join("")}
        <p class="extraction-print-note">Utilisez la boîte de dialogue d'impression du navigateur pour enregistrer en PDF.</p>
      </main>
      <script>
        window.addEventListener("load", () => {
          window.print();
        });
      </script>
    </body>
  </html>`;
}

function buildVolunteerRows(volunteers) {
  return [...volunteers]
    .sort(compareByDisplayName)
    .map((volunteer) => [
      escapeHtml(volunteer.displayName),
      escapeHtml(formatRoleList(volunteer.assignedRoles)),
      escapeHtml(normalizeTextValue(volunteer.teamRole)),
      [
        escapeHtml(normalizeTextValue(volunteer.phone, "Sans téléphone")),
        volunteer.email ? `<small>${escapeHtml(volunteer.email)}</small>` : "<small>Sans email</small>",
      ].join(""),
      escapeHtml(volunteer.workflowStatus),
      [
        `<strong>${escapeHtml(formatPresenceLabel(volunteer.presence))}</strong>`,
        `<small>Arrivée: ${escapeHtml(formatDateTimeValue(volunteer.presence.checkedInAt))}</small>`,
        `<small>Repas: ${escapeHtml(formatBooleanLabel(Boolean(volunteer.presence.lunchCollectedAt), "Remis", "Non remis"))}</small>`,
      ].join(""),
      volunteer.guardianContact
        ? `${escapeHtml(volunteer.guardianContact)}<small>Bénévole mineur</small>`
        : "—",
    ]);
}

function buildTeamRows(volunteers) {
  return [...volunteers]
    .filter((volunteer) => volunteer.assignedRoles.length > 0)
    .sort((left, right) =>
      `${left.primaryTeam} ${left.displayName}`.localeCompare(`${right.primaryTeam} ${right.displayName}`, "fr", {
        sensitivity: "base",
      }),
    )
    .map((volunteer) => [
      escapeHtml(volunteer.primaryTeam),
      escapeHtml(volunteer.displayName),
      escapeHtml(normalizeTextValue(volunteer.teamRole)),
      [
        escapeHtml(normalizeTextValue(volunteer.phone, "Sans téléphone")),
        volunteer.email ? `<small>${escapeHtml(volunteer.email)}</small>` : "<small>Sans email</small>",
      ].join(""),
      escapeHtml(volunteer.workflowStatus),
    ]);
}

function buildAccreditationRows(entries) {
  return [...entries]
    .sort((left, right) =>
      `${left.pickupDesk} ${left.displayName}`.localeCompare(`${right.pickupDesk} ${right.displayName}`, "fr", {
        sensitivity: "base",
      }),
    )
    .map((entry) => [
      escapeHtml(entry.pickupDesk),
      escapeHtml(entry.displayName),
      escapeHtml(entry.badgeLabel),
      escapeHtml(entry.teamLabel),
      escapeHtml(entry.categoryLabel),
      [
        escapeHtml(normalizeTextValue(entry.phone, "Sans téléphone")),
        entry.email ? `<small>${escapeHtml(entry.email)}</small>` : "",
      ].join(""),
    ]);
}

function buildOperationsRows(data) {
  const rows = [];
  const seen = new Set();

  data.roles.forEach((role) => {
    const name = normalizeTextValue(role.leaderName, "");
    const contact = normalizeTextValue(role.leaderContact, "");
    if (!name && !contact) return;
    const key = `role::${role.roleName}::${name.toLowerCase()}::${contact.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([
      "Référent configuré",
      escapeHtml(role.roleName),
      escapeHtml(name || "À compléter"),
      escapeHtml(contact || "Contact non renseigné"),
    ]);
  });

  data.staffUsers.forEach((user) => {
    const roles = user.userTypes.join(", ");
    const contact = [normalizeTextValue(user.phone, ""), normalizeTextValue(user.email, "")]
      .filter(Boolean)
      .join(" · ");
    const key = `staff::${user.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([
      escapeHtml(roles || "Plateforme"),
      "Transverse",
      escapeHtml(user.displayName),
      escapeHtml(contact || "Sans contact"),
    ]);
  });

  data.teamLeadAssignments.forEach((lead) => {
    const key = `lead::${lead.userId}::${lead.team}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([
      "Chef d'équipe",
      escapeHtml(lead.team),
      escapeHtml(lead.displayName),
      escapeHtml(lead.contact || "Sans contact"),
    ]);
  });

  return rows.sort((left, right) => `${left[1]} ${left[2]}`.localeCompare(`${right[1]} ${right[2]}`, "fr"));
}

function buildPresenceRows(volunteers) {
  return [...volunteers]
    .filter((volunteer) => volunteer.assignedRoles.length > 0)
    .sort((left, right) =>
      `${left.primaryTeam} ${left.displayName}`.localeCompare(`${right.primaryTeam} ${right.displayName}`, "fr", {
        sensitivity: "base",
      }),
    )
    .map((volunteer) => [
      escapeHtml(volunteer.primaryTeam),
      escapeHtml(volunteer.displayName),
      [
        escapeHtml(normalizeTextValue(volunteer.phone, "Sans téléphone")),
        volunteer.email ? `<small>${escapeHtml(volunteer.email)}</small>` : "",
      ].join(""),
      escapeHtml(formatPresenceLabel(volunteer.presence)),
      escapeHtml(formatDateTimeValue(volunteer.presence.checkedInAt)),
      escapeHtml(formatDateTimeValue(volunteer.presence.lunchCollectedAt, "Non récupéré")),
      escapeHtml(
        volunteer.presence.missionCompletedAt
          ? formatDateTimeForDisplay(volunteer.presence.missionCompletedAt)
          : normalizeTextValue(volunteer.presence.departureTime, "En cours"),
      ),
    ]);
}

function buildU14Rows(requests) {
  return [...requests]
    .sort((left, right) =>
      `${left.raceLabel} ${left.childDisplayName}`.localeCompare(`${right.raceLabel} ${right.childDisplayName}`, "fr", {
        sensitivity: "base",
      }),
    )
    .map((request) => [
      [
        escapeHtml(request.childDisplayName),
        `<small>${escapeHtml(request.category)} · dossard ${escapeHtml(request.bibNumber)}</small>`,
      ].join(""),
      [
        escapeHtml(request.raceLabel),
        `<small>${escapeHtml(request.club)}</small>`,
      ].join(""),
      escapeHtml(request.parentDisplayName),
      [
        escapeHtml(request.parentPhone || "Téléphone non renseigné"),
        request.parentEmail ? `<small>${escapeHtml(request.parentEmail)}</small>` : "",
      ].join(""),
      escapeHtml(request.workflowStatus),
      escapeHtml(normalizeTextValue(request.notes)),
    ]);
}

function buildEmergencySections(data, extractionId) {
  const volunteerRows = buildVolunteerRows(data.volunteers);
  const teamRows = buildTeamRows(data.volunteers);
  const accreditationRows = buildAccreditationRows(data.accreditationEntries);
  const operationsRows = buildOperationsRows(data);
  const presenceRows = buildPresenceRows(data.volunteers);
  const u14Rows = buildU14Rows(data.u14Requests);

  const sectionMap = {
    volunteers: {
      title: "Contacts bénévoles",
      subtitle: `${data.volunteers.length} bénévole(s) sur l'édition active.`,
      columns: ["Nom", "Équipe(s)", "Fonction", "Contact", "Statut", "Urgence"],
      rows: volunteerRows,
    },
    teams: {
      title: "Bénévoles par équipe",
      subtitle: `${teamRows.length} affectation(s) actives triée(s) par équipe puis par nom de famille.`,
      columns: ["Équipe", "Bénévole", "Fonction", "Contact", "Statut"],
      rows: teamRows,
    },
    accreditations: {
      title: "Accréditations par guichet",
      subtitle: `${accreditationRows.length} badge(s) imprimé(s) et rangé(s) par point de retrait.`,
      columns: ["Guichet", "Nom", "Badge", "Équipe(s)", "Type", "Contact"],
      rows: accreditationRows,
    },
    operations: {
      title: "Contacts commandement",
      subtitle: "Admins, gestionnaires, chefs d'équipe et référents configurés.",
      columns: ["Type", "Périmètre", "Nom", "Contact"],
      rows: operationsRows,
    },
    presence: {
      title: "Pointage et repas",
      subtitle: `${presenceRows.length} bénévole(s) affecté(s) avec suivi opérationnel.`,
      columns: ["Équipe", "Bénévole", "Contact", "Présence", "Arrivée", "Repas", "Fin de mission"],
      rows: presenceRows,
    },
    u14: {
      title: "Familles U12/U14",
      subtitle: `${u14Rows.length} demande(s) rattachée(s) à l'édition active.`,
      columns: ["Enfant", "Course / rôle", "Parent", "Contact", "Statut", "Notes"],
      rows: u14Rows,
    },
  };

  if (extractionId === "pack") {
    return [
      sectionMap.volunteers,
      sectionMap.teams,
      sectionMap.accreditations,
      sectionMap.operations,
      sectionMap.presence,
      sectionMap.u14,
    ];
  }

  return sectionMap[extractionId] ? [sectionMap[extractionId]] : [];
}

function openPrintMarkup(markup) {
  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) return false;
  printWindow.document.write(markup);
  printWindow.document.close();
  return true;
}

// view = "emergency" : page « Exports d'urgence » (Accès & jour J), qui
// partage les données de cette page ; sinon page Documents.
function DocumentsPage(props) {
  const { AuthFormField, Panel, getDocumentConsultationUrl, view = "documents" } = props;
  const isEmergencyView = view === "emergency";
  const { currentUser, userProfile } = useAuth();
  const { activeEditionId } = useActiveEdition(Boolean(currentUser?.uid));
  const invoiceConfiguration = useBudgetInvoiceConfiguration();
  const emptyDocumentForm = {
    title: "",
    externalLink: "",
    fileUrl: "",
    fileName: "",
    filePath: "",
    mimeType: "",
    scope: "global",
    teams: [],
    selectedTeam: "",
  };
  const {
    documents: storedDocuments,
    loading: documentsLoading,
    error: documentsError,
  } = useDocumentsCollection(true);
  const { roles: configuredRoles } = useTeamConfiguration();
  const [documentForm, setDocumentForm] = useState(emptyDocumentForm);
  const [editingDocumentId, setEditingDocumentId] = useState(null);
  const [documentStatus, setDocumentStatus] = useState("");
  const [isSubmittingDocument, setIsSubmittingDocument] = useState(false);
  const [isGeneratingExtractionId, setIsGeneratingExtractionId] = useState("");
  const activeRoles = useMemo(() => extractRolesFromProfile(userProfile), [userProfile]);
  const canUploadInvoices = useMemo(
    () =>
      canUserUploadBudgetInvoice({
        activeRoles,
        userId: currentUser?.uid,
        configuration: invoiceConfiguration,
      }),
    [activeRoles, currentUser?.uid, invoiceConfiguration],
  );

  const documents = useMemo(
    () =>
      storedDocuments
        .filter((documentItem) => documentItem.documentType !== "invoice")
        .sort((left, right) => right.createdAtMs - left.createdAtMs),
    [storedDocuments],
  );
  const teamOptions = useMemo(() => {
    const normalizedConfiguredRoles = Array.isArray(configuredRoles)
      ? configuredRoles.map((role) => String(role?.roleName || "").trim()).filter(Boolean)
      : [];
    const normalizedDocumentTeams = documents.flatMap((documentItem) =>
      Array.isArray(documentItem?.teams)
        ? documentItem.teams.map((team) => String(team || "").trim()).filter(Boolean)
        : [],
    );

    return [...new Set([...normalizedConfiguredRoles, ...normalizedDocumentTeams])].sort((left, right) =>
      left.localeCompare(right, "fr", { sensitivity: "base" }),
    );
  }, [configuredRoles, documents]);

  function handleDocumentFormChange(event) {
    const { name, value } = event.target;
    setDocumentForm((current) => ({ ...current, [name]: value }));
  }

  function addDocumentTeam() {
    if (!documentForm.selectedTeam) return;
    setDocumentForm((current) => ({
      ...current,
      teams: current.teams.includes(current.selectedTeam)
        ? current.teams
        : [...current.teams, current.selectedTeam],
      selectedTeam: "",
    }));
  }

  function removeDocumentTeam(teamName) {
    setDocumentForm((current) => ({
      ...current,
      teams: current.teams.filter((team) => team !== teamName),
    }));
  }

  async function handleDocumentSubmit(event) {
    event.preventDefault();
    if (!documentForm.title.trim()) return;
    if (documentForm.scope === "teams" && documentForm.teams.length === 0) return;

    const existingDocument = documents.find((documentItem) => documentItem.id === editingDocumentId);
    const trimmedReference = documentForm.fileUrl.trim() || documentForm.externalLink.trim();

    if (!trimmedReference) {
      setDocumentStatus("Déposez un fichier ou ajoutez un lien de consultation avant d'enregistrer.");
      return;
    }

    setIsSubmittingDocument(true);
    setDocumentStatus("Enregistrement du document...");

    try {
      const documentPayload = {
        title: documentForm.title.trim(),
        reference: trimmedReference || existingDocument?.reference || "",
        fileName: documentForm.fileName || existingDocument?.fileName || "",
        filePath: documentForm.filePath || existingDocument?.filePath || "",
        fileUrl: documentForm.fileUrl || existingDocument?.fileUrl || "",
        mimeType: documentForm.mimeType || existingDocument?.mimeType || "",
        scope: documentForm.scope,
        teams: documentForm.scope === "global" ? [] : documentForm.teams,
        visibility:
          documentForm.scope === "global" ? "Tous les utilisateurs concernés" : "Équipes ciblées",
        updatedAt: serverTimestamp(),
      };

      if (editingDocumentId) {
        await updateDoc(doc(db, "documents", editingDocumentId), documentPayload);
        setDocumentStatus("Document mis à jour et consultable.");
      } else {
        await addDoc(collection(db, "documents"), {
          ...documentPayload,
          uploadedByUid: String(currentUser?.uid || "").trim(),
          uploadedByName: getDisplayName(userProfile, currentUser?.email),
          createdAt: serverTimestamp(),
        });
        setDocumentStatus("Document ajouté et publié.");
      }

      setDocumentForm(emptyDocumentForm);
      setEditingDocumentId(null);
    } catch (error) {
      setDocumentStatus(getDocumentUploadErrorMessage(error));
    } finally {
      setIsSubmittingDocument(false);
    }
  }

  function editDocument(documentItem) {
    setEditingDocumentId(documentItem.id);
    setDocumentForm({
      title: documentItem.title,
      externalLink: documentItem.fileUrl ? "" : documentItem.reference,
      fileUrl: documentItem.fileUrl || "",
      fileName: documentItem.fileName || "",
      filePath: documentItem.filePath || "",
      mimeType: documentItem.mimeType || "",
      scope: documentItem.scope,
      teams: documentItem.teams,
      selectedTeam: "",
    });
  }

  async function deleteDocumentEntry(documentId) {
    const documentToDelete = documents.find((documentItem) => documentItem.id === documentId);
    if (!documentToDelete) return;
    if (!window.confirm(`Supprimer "${documentToDelete.title}" ?`)) return;

    try {
      await deleteDoc(doc(db, "documents", documentId));
      setDocumentStatus("Document supprimé.");
    } catch {
      setDocumentStatus("La suppression du document a échoué.");
    }

    if (editingDocumentId === documentId) {
      setEditingDocumentId(null);
      setDocumentForm(emptyDocumentForm);
    }
  }

  function cancelDocumentEdition() {
    setEditingDocumentId(null);
    setDocumentForm(emptyDocumentForm);
  }

  async function loadEmergencyExtractionData() {
    const activeEditionId = await getActiveEditionId();
    const [
      usersSnapshot,
      volunteerSnapshot,
      childrenSnapshot,
      requestsSnapshot,
      teamConfigSnapshot,
      accreditationConfigSnapshot,
      judgeRosterSnapshot,
    ] =
      await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "volunteerApplications")),
        getDocs(collection(db, "u14Children")),
        getDocs(collection(db, "u14Requests")),
        getDoc(doc(db, ...TEAM_CONFIGURATION_DOC_PATH)),
        getDoc(doc(db, ...ACCREDITATION_CONFIGURATION_DOC_PATH)),
        getDoc(doc(db, ...JUDGE_ROSTER_DOC_PATH)),
      ]);

    const users = usersSnapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data(),
    }));
    const usersById = new Map(users.map((user) => [String(user.id || "").trim(), user]));

    const teamConfiguration = normalizeTeamConfigurationPayload(
      teamConfigSnapshot.exists() ? teamConfigSnapshot.data() : {},
    );
    const accreditationConfiguration = normalizeAccreditationConfigurationPayload(
      accreditationConfigSnapshot.exists() ? accreditationConfigSnapshot.data() : {},
      teamConfiguration.roles,
    );

    const volunteers = volunteerSnapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((entry) => recordMatchesEdition(entry, activeEditionId))
      .map((entry) => {
        const volunteer = mapVolunteerApplicationToAdminVolunteer(entry);
        const guardian = entry?.legalGuardian && typeof entry.legalGuardian === "object" ? entry.legalGuardian : null;
        const guardianParts = [
          [guardian?.firstName, guardian?.lastName].filter(Boolean).join(" ").trim(),
          guardian?.phone || guardian?.email || "",
        ].filter(Boolean);

        return {
          ...volunteer,
          displayName: formatDisplayName(volunteer.lastName, volunteer.firstName, "Bénévole"),
          primaryTeam: volunteer.assignedRoles[0] || "Non affecté",
          guardianContact: guardianParts.join(" · "),
          presence: normalizePresenceRecord(entry?.presence),
        };
      });

    const accreditationUsers = buildAccreditationUsers(users, teamConfiguration.teamAssignments).map((user) => ({
      ...user,
      displayName: formatDisplayName(user.lastName, user.firstName, user.email || "Bénévole"),
      assignedRoles: Array.isArray(user.assignedRoles) ? user.assignedRoles : [],
    }));

    const staffUsers = users
      .map((user) => {
        const userTypes = Array.isArray(user?.userTypes)
          ? user.userTypes.map((item) => String(item || "").trim()).filter(Boolean)
          : [];

        return {
          id: String(user.id || "").trim(),
          displayName: formatDisplayName(user.lastName, user.firstName, user.email || "Utilisateur"),
          email: String(user.email || "").trim(),
          phone: String(user.phone || "").trim(),
          userTypes,
        };
      })
      .filter((user) =>
        user.userTypes.some((role) => ["admin", "gestionnaire", "chef_equipe"].includes(role)),
      );

    const teamLeadAssignments = teamConfiguration.teamAssignments
      .filter((assignment) => isTeamLeadAssignment(assignment))
      .map((assignment) => ({
        userId: String(assignment.id || "").trim(),
        displayName: formatDisplayName(assignment.lastName, assignment.firstName, assignment.email || "Chef d'équipe"),
        contact: [assignment.phone, assignment.email].filter(Boolean).join(" · "),
        team: String(assignment.assignedRole || "").trim() || "Équipe",
      }));

    const accreditationEntries = accreditationUsers
      .map((user) => {
        const override = accreditationConfiguration.volunteerOverrides[String(user.id || "").trim()] || null;
        const pickupDesk = normalizeTextValue(
          accreditationConfiguration.badgeStorageLocations[String(user.id || "").trim()],
          "",
        );
        const printStatus = String(override?.printStatus || "").trim();
        if (!pickupDesk || printStatus !== "Imprimé") return null;

        const badgeLabel = normalizeTextValue(override?.badgeLabel, formatRoleList(user.assignedRoles, "Accréditation"));

        return {
          pickupDesk,
          displayName: user.displayName,
          badgeLabel,
          teamLabel: formatRoleList(user.assignedRoles),
          categoryLabel: "Bénévole",
          phone: String(user.phone || "").trim(),
          email: String(user.email || "").trim(),
        };
      })
      .filter(Boolean);

    const judges = judgeRosterSnapshot.exists() && Array.isArray(judgeRosterSnapshot.data()?.judges)
      ? judgeRosterSnapshot.data().judges
      : [];

    judges.forEach((judge, index) => {
      const judgeId = String(judge?.id || `judge-${index + 1}`).trim();
      const pickupDesk = normalizeTextValue(accreditationConfiguration.badgeStorageLocations[judgeId], "");
      const printStatus = String(judge?.printStatus || "").trim();
      if (!pickupDesk || printStatus !== "Imprimé" || judge?.destroyedAt) return;

      accreditationEntries.push({
        pickupDesk,
        displayName: formatDisplayName(judge?.lastName, judge?.firstName, "Juge"),
        badgeLabel: normalizeTextValue(judge?.badgeLabel, "Judge"),
        teamLabel: "Juges",
        categoryLabel: "Juge",
        phone: "",
        email: "",
      });
    });

    const childrenById = new Map(
      childrenSnapshot.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .filter((entry) => recordMatchesEdition(entry, activeEditionId))
        .map((child) => [String(child.id || "").trim(), child]),
    );

    const u14Requests = requestsSnapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((entry) => recordMatchesEdition(entry, activeEditionId))
      .map((request) => {
        const child = childrenById.get(String(request.childId || "").trim()) || {};
        const parentProfile = usersById.get(String(request.parentUserId || "").trim()) || {};
        const childFirstName = String(request.childFirstName || child.firstName || "").trim();
        const childLastName = String(request.childLastName || child.lastName || "").trim();
        const parentFirstName = String(request.parentFirstName || parentProfile.firstName || "").trim();
        const parentLastName = String(request.parentLastName || parentProfile.lastName || "").trim();

        return {
          childDisplayName: formatDisplayName(childLastName, childFirstName, "Enfant"),
          parentDisplayName: formatDisplayName(parentLastName, parentFirstName, "Parent"),
          parentPhone: String(parentProfile.phone || "").trim(),
          parentEmail: String(request.parentEmail || parentProfile.email || "").trim(),
          club: String(request.club || child.club || "").trim() || "Club non renseigné",
          bibNumber: String(request.bibNumber || child.bibNumber || "").trim() || "—",
          category: String(request.category || child.category || "").trim() || "—",
          raceLabel:
            String(request.requestType || "").trim() === "porte_panier"
              ? "Porte-panier"
              : getU14RaceLabel(request.raceCode),
          workflowStatus: getU14WorkflowStatusLabel(request),
          notes: String(request.notes || "").trim(),
        };
      });

    return {
      activeEditionId,
      roles: teamConfiguration.roles,
      staffUsers,
      teamLeadAssignments,
      volunteers,
      accreditationEntries,
      u14Requests,
    };
  }

  async function handleEmergencyExtraction(extractionId) {
    setIsGeneratingExtractionId(extractionId);
    setDocumentStatus("Préparation de l'extraction PDF...");

    try {
      const data = await loadEmergencyExtractionData();
      const sections = buildEmergencySections(data, extractionId);

      if (sections.length === 0) {
        setDocumentStatus("Aucune extraction disponible pour cette sélection.");
        return;
      }

      const definition = EMERGENCY_EXTRACTION_DEFINITIONS.find((item) => item.id === extractionId);
      const markup = buildEmergencyPrintMarkup({
        title: definition?.title || "Extraction d'urgence",
        subtitle: `Édition active: ${data.activeEditionId}. Données générées à la demande depuis Firestore.`,
        sections,
      });

      if (!openPrintMarkup(markup)) {
        setDocumentStatus("La fenêtre d'impression a été bloquée par le navigateur.");
        return;
      }

      setDocumentStatus(`Extraction "${definition?.title || extractionId}" prête à imprimer.`);
    } catch (error) {
      setDocumentStatus(error?.message || "Impossible de préparer l'extraction PDF.");
    } finally {
      setIsGeneratingExtractionId("");
    }
  }

  return (
    <div className="page documents-page documents-page--admin">
      <section className="page-header">
        {isEmergencyView ? (
          <div>
            <p className="eyebrow">Accès &amp; jour J</p>
            <h1>Exports d'urgence</h1>
            <p>Listes PDF prêtes à imprimer en cas de problème le jour du meeting (réseau, appli, contacts).</p>
          </div>
        ) : (
          <div>
            <p className="eyebrow">Pilotage</p>
            <h1>Documents</h1>
            <p>Documents partagés avec les équipes : visibilité par équipe et diffusion automatique aux affectés.</p>
          </div>
        )}
      </section>
      {documentsError || documentStatus ? (
        <div className="documents-page__status">
          {documentsError ? <p className="panel-note">{documentsError}</p> : null}
          {documentStatus ? <p className="panel-note">{documentStatus}</p> : null}
        </div>
      ) : null}

      {isEmergencyView ? null : (
      <section className={`documents-admin-grid ${canUploadInvoices ? "" : "documents-admin-grid--no-invoice"}`}>
        <div className="documents-admin-grid__stack">
          {canUploadInvoices ? (
            <Panel
              title="Déposer une facture"
              subtitle="Dépose une facture pour l'édition active. Elle remontera automatiquement dans le budget pour être classée."
            >
              <InvoiceUploadForm
                editionId={activeEditionId}
                currentUser={currentUser}
                userProfile={userProfile}
                assignedTeams={Array.isArray(userProfile?.assignedTeams) ? userProfile.assignedTeams : []}
              />
            </Panel>
          ) : null}

          <Panel
            title={editingDocumentId ? "Modifier un document" : "Ajouter un document"}
            subtitle="Choisissez si le document doit être visible par tout le monde ou seulement par une ou plusieurs équipes."
          >
            <form className="section-stack documents-form" onSubmit={handleDocumentSubmit}>
            <AuthFormField label="Titre du document">
              <input
                name="title"
                required
                placeholder="Briefing accueil, plan d'accès, feuille de route..."
                value={documentForm.title}
                onChange={handleDocumentFormChange}
              />
            </AuthFormField>

            <div className="document-source-stack">
              <FileUpload
                value={documentForm.fileUrl}
                onChange={(url) => setDocumentForm((current) => ({ ...current, fileUrl: url }))}
                onUploadComplete={(file) =>
                  setDocumentForm((current) => ({
                    ...current,
                    fileUrl: file.url,
                    fileName: file.fileName,
                    filePath: file.filePath,
                    mimeType: file.mimeType,
                    title: current.title || file.fileName,
                  }))
                }
                accept=".pdf,image/*"
                storagePath="documents"
                label="Fichier"
                helperText="PDF ou image · ou colle un lien ci-dessous si le document est déjà hébergé ailleurs"
              />
              <AuthFormField label="Ou lien de consultation">
                <input
                  name="externalLink"
                  placeholder="Collez un lien si le document est déjà hébergé ailleurs"
                  value={documentForm.externalLink}
                  disabled={Boolean(documentForm.fileUrl)}
                  onChange={handleDocumentFormChange}
                />
              </AuthFormField>
            </div>

            <div className="field">
              <span>Diffusion</span>
              <div className="choice-grid choice-grid--2">
                <label className="selection-card selection-card--compact">
                  <input
                    checked={documentForm.scope === "global"}
                    name="scope"
                    type="radio"
                    value="global"
                    onChange={handleDocumentFormChange}
                  />
                  <div>
                    <strong>Tout le monde</strong>
                  </div>
                </label>
                <label className="selection-card selection-card--compact">
                  <input
                    checked={documentForm.scope === "teams"}
                    name="scope"
                    type="radio"
                    value="teams"
                    onChange={handleDocumentFormChange}
                  />
                  <div>
                    <strong>Équipes ciblées</strong>
                  </div>
                </label>
              </div>
            </div>

            {documentForm.scope === "teams" ? (
              <div className="field">
                <span>Équipes concernées</span>
                <div className="document-team-picker">
                  <select
                    name="selectedTeam"
                    value={documentForm.selectedTeam}
                    onChange={handleDocumentFormChange}
                  >
                    <option value="">Choisir une équipe</option>
                    {teamOptions
                      .filter((team) => !documentForm.teams.includes(team))
                      .map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                  </select>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={addDocumentTeam}
                    disabled={!documentForm.selectedTeam}
                  >
                    Ajouter l'équipe
                  </button>
                </div>
                {documentForm.teams.length > 0 ? (
                  <div className="document-tag-list">
                    {documentForm.teams.map((team) => (
                      <button
                        key={`selected-${team}`}
                        className="document-tag document-tag--removable"
                        type="button"
                        onClick={() => removeDocumentTeam(team)}
                      >
                        {team} ×
                      </button>
                    ))}
                  </div>
                ) : (
                  <small>Aucune équipe sélectionnée pour le moment.</small>
                )}
              </div>
            ) : null}

            <div className="table-actions table-actions--inline">
              <button className="button button--primary" disabled={isSubmittingDocument} type="submit">
                {isSubmittingDocument
                  ? "Enregistrement..."
                  : editingDocumentId
                    ? "Enregistrer les modifications"
                    : "Ajouter le document"}
              </button>
            {editingDocumentId ? (
              <button
                className="button button--secondary"
                  type="button"
                  onClick={cancelDocumentEdition}
                >
                  Annuler
                </button>
              ) : null}
            </div>
            </form>
          </Panel>
        </div>

        <div className="documents-admin-grid__main">
          <Panel
            title="Documents publiés"
            subtitle="Consultez les documents existants et leur périmètre de diffusion."
          >
            {documentsLoading ? <p className="panel-note">Chargement des documents...</p> : null}
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Titre</th>
                    <th>Périmètre</th>
                    <th>Équipes</th>
                    <th>Ajouté par</th>
                    <th>Consultation</th>
                    <th>Actions admin</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((documentItem) => (
                    <tr key={documentItem.id}>
                      <td>{documentItem.title}</td>
                      <td>{documentItem.scope === "global" ? "Tout le monde" : "Équipes ciblées"}</td>
                      <td>
                        {documentItem.scope === "global" ? (
                          <span className="documents-table__muted">Toutes les équipes</span>
                        ) : (
                          <div className="document-tag-list">
                            {documentItem.teams.map((team) => (
                              <span key={`${documentItem.id}-${team}`} className="document-tag">
                                {team}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{documentItem.uploadedByName || "Admin"}</td>
                      <td>
                        <button
                          className="document-icon-button"
                          type="button"
                          disabled={!getDocumentConsultationUrl(documentItem)}
                          aria-label={`Ouvrir ${documentItem.title}`}
                          title={`Ouvrir ${documentItem.title}`}
                          onClick={() => {
                            const consultationUrl = getDocumentConsultationUrl(documentItem);
                            if (!consultationUrl) {
                              setDocumentStatus("Ce document n'a pas encore de lien de consultation valide.");
                              return;
                            }
                            window.open(consultationUrl, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <span aria-hidden="true">↗</span>
                        </button>
                      </td>
                      <td>
                        <div className="table-actions table-actions--inline">
                          <button
                            className="button button--secondary"
                            type="button"
                            onClick={() => editDocument(documentItem)}
                          >
                            Modifier
                          </button>
                          <button
                            className="button button--ghost-danger"
                            type="button"
                            onClick={() => deleteDocumentEntry(documentItem.id)}
                          >
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!documentsLoading && documents.length === 0 ? (
                    <tr>
                      <td colSpan="6">Aucun document publié pour le moment.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </section>
      )}

      {isEmergencyView ? (
      <section className="panel-grid panel-grid--2 documents-secondary-grid">
        <Panel
          title="Extractions d'urgence"
          subtitle="Listes PDF générées à la demande pour le meeting, réservées au pilotage opérationnel."
        >
          <div className="emergency-extraction-grid">
            {EMERGENCY_EXTRACTION_DEFINITIONS.map((extraction) => (
              <article key={extraction.id} className="emergency-extraction-card">
                <div className="emergency-extraction-card__copy">
                  <strong>{extraction.title}</strong>
                  <p>{extraction.description}</p>
                </div>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={Boolean(isGeneratingExtractionId)}
                  onClick={() => handleEmergencyExtraction(extraction.id)}
                >
                  {isGeneratingExtractionId === extraction.id ? "Préparation..." : extraction.buttonLabel}
                </button>
              </article>
            ))}
          </div>
        </Panel>
        <Panel
          title="VIP"
          subtitle="Les formulaires VIP alimentent maintenant Firestore. Il reste à brancher l'export PDF dédié."
        >
          <div className="emergency-extraction-placeholder">
            <strong>Export VIP encore à brancher</strong>
            <p>
              Le formulaire VIP public ainsi que les portails partenaires enregistrent désormais les inscriptions.
              Le pilotage des invitations et des inscriptions est désormais centralisé dans le module VIP du back-office.
              La prochaine étape consiste à ajouter ici une extraction PDF dédiée pour l'équipe organisatrice.
            </p>
            <p className="panel-note">
              Pour l'instant, seules les extractions bénévoles, commandement, présence et U12/U14 sont générées.
            </p>
          </div>
        </Panel>
      </section>
      ) : null}
    </div>
  );
}

export { DocumentsPage };
