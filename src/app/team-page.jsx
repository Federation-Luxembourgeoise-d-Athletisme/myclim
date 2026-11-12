import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { buildUserIdentitySet, getDocumentUploadErrorMessage, isTeamLeadAssignment } from "./common-helpers";
import { useTeamConfiguration } from "./config-hooks";
import { getDocumentReferenceUrl, useDocumentsCollection } from "./documents-hooks";
import { FileUpload } from "./file-upload";
import { getDisplayName } from "./utils";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";
import { useTr } from "./use-tr";

// Fonctions d'équipe enregistrées en français, affichées dans la langue choisie.
const TEAM_ROLE_EN = { "Chef d'équipe": "Team leader", "Bénévole": "Volunteer", "Remplaçant": "Substitute" };

const emptyTeamDocumentForm = {
  title: "",
  externalLink: "",
  fileUrl: "",
  fileName: "",
  filePath: "",
  mimeType: "",
};

function TeamPage(props) {
  const { AuthFormField, DataTable, Panel } = props;
  const { currentUser, userProfile } = useAuth();
  const tr = useTr();
  const teamRoleLabel = (value) => tr(value, TEAM_ROLE_EN[value] || value);
  const { roles, teamAssignments, loading, error } = useTeamConfiguration();
  const { documents, loading: documentsLoading, error: documentsError } = useDocumentsCollection(true);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [documentForm, setDocumentForm] = useState(emptyTeamDocumentForm);
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const [documentStatus, setDocumentStatus] = useState("");

  const userIdentitySet = useMemo(
    () => buildUserIdentitySet(userProfile, currentUser),
    [buildUserIdentitySet, currentUser, userProfile],
  );
  const myAssignments = useMemo(
    () =>
      teamAssignments.filter((member) =>
        [member.id, member.email, `${member.firstName} ${member.lastName}`.trim()]
          .map((value) => String(value || "").trim().toLowerCase())
          .some((value) => value && userIdentitySet.has(value)),
      ),
    [teamAssignments, userIdentitySet],
  );
  const myLeadAssignments = useMemo(
    () => myAssignments.filter((assignment) => isTeamLeadAssignment(assignment)),
    [isTeamLeadAssignment, myAssignments],
  );
  const myLeadRoleIds = useMemo(
    () =>
      roles
        .filter(
          (role) =>
            userIdentitySet.has(String(role.leaderName || "").trim().toLowerCase()) ||
            myLeadAssignments.some((assignment) => assignment.assignedRoleId === role.id),
        )
        .map((role) => role.id),
    [myLeadAssignments, roles, userIdentitySet],
  );
  const availableRoles = useMemo(() => {
    const visibleRoleIds = new Set([
      ...myLeadAssignments.map((assignment) => assignment.assignedRoleId),
      ...myLeadRoleIds,
    ]);
    return roles.filter((role) => visibleRoleIds.has(role.id));
  }, [myLeadAssignments, myLeadRoleIds, roles]);

  const effectiveSelectedRoleId =
    availableRoles.some((role) => role.id === selectedRoleId) ? selectedRoleId : availableRoles[0]?.id ?? "";
  const selectedRole = availableRoles.find((role) => role.id === effectiveSelectedRoleId) ?? availableRoles[0];
  const selectedRoleMembers = useMemo(
    () => teamAssignments.filter((member) => member.assignedRoleId === selectedRole?.id),
    [selectedRole, teamAssignments],
  );
  const myAssignment = useMemo(
    () =>
      myLeadAssignments.find((assignment) => assignment.assignedRoleId === selectedRole?.id) ??
      myLeadAssignments[0] ??
      null,
    [myLeadAssignments, selectedRole],
  );
  const teamLeadCount = selectedRoleMembers.filter((member) => member.teamRole === "Chef d'équipe").length;
  const replacementCount = selectedRoleMembers.filter((member) => member.teamRole === "Remplaçant").length;
  const volunteerCount = selectedRoleMembers.filter((member) => member.teamRole !== "Remplaçant").length;
  const teamRows = selectedRoleMembers.map((member) => ({
    name: `${member.firstName} ${member.lastName}`.trim() || member.email || tr("Bénévole", "Volunteer"),
    mission: teamRoleLabel(member.teamRole),
    contact: member.email || member.phone || tr("Contact non renseigné", "No contact details"),
  }));

  const teamDocuments = useMemo(
    () =>
      documents
        .filter((documentItem) => documentItem.documentType !== "invoice")
        .filter(
          (documentItem) =>
            documentItem.scope === "global" ||
            (documentItem.scope === "teams" && documentItem.teams.includes(selectedRole?.roleName)),
        )
        .sort((left, right) => right.createdAtMs - left.createdAtMs),
    [documents, selectedRole],
  );

  function handleDocumentFormChange(event) {
    const { name, value } = event.target;
    setDocumentForm((current) => ({ ...current, [name]: value }));
  }

  async function addDocument(event) {
    event.preventDefault();
    if (!selectedRole || isSavingDocument) return;
    const reference = documentForm.fileUrl.trim() || documentForm.externalLink.trim();
    if (!documentForm.title.trim() || !reference) return;

    setIsSavingDocument(true);
    setDocumentStatus(tr("Enregistrement du document...", "Saving the document..."));

    try {
      await addDoc(collection(db, "documents"), {
        documentType: "document",
        title: documentForm.title.trim(),
        reference,
        fileName: documentForm.fileName,
        filePath: documentForm.filePath,
        fileUrl: documentForm.fileUrl,
        mimeType: documentForm.mimeType,
        scope: "teams",
        teams: [selectedRole.roleName],
        visibility: "Équipes ciblées",
        uploadedByUid: String(currentUser?.uid || "").trim(),
        uploadedByName: getDisplayName(userProfile, currentUser?.email),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDocumentForm(emptyTeamDocumentForm);
      setDocumentStatus(tr("Document ajouté et visible par votre équipe.", "Document added and visible to your team."));
    } catch (persistError) {
      console.error("Impossible d'enregistrer le document d'équipe.", persistError);
      setDocumentStatus(getDocumentUploadErrorMessage(persistError));
    } finally {
      setIsSavingDocument(false);
    }
  }

  async function removeDocument(documentItem) {
    if (isSavingDocument) return;
    setIsSavingDocument(true);
    setDocumentStatus("");

    try {
      await deleteDoc(doc(db, "documents", documentItem.id));
    } catch (deleteError) {
      console.error("Impossible de supprimer le document d'équipe.", deleteError);
      setDocumentStatus(tr("La suppression du document a échoué.", "The document could not be removed."));
    } finally {
      setIsSavingDocument(false);
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Chef d'équipe", "Team leader")}</p>
          <h1>{tr("Mon équipe", "My team")}</h1>
          <p>{tr("Les informations et les membres des équipes que vous dirigez.", "Information and members of the teams you lead.")}</p>
        </div>
      </section>

      {error ? <p className="status-note">{error}</p> : null}
      {loading ? <p className="status-note">{tr("Chargement de l'équipe...", "Loading your team...")}</p> : null}

      {selectedRole ? (
        <>
          <div className="admin-toolbar">
            <label className="field">
              <span>{tr("Équipe", "Team")}</span>
              <select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>
                {availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.roleName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section className="panel-grid panel-grid--2">
            <Panel title={tr("Mon affectation", "My assignment")} subtitle={tr("Ce que je pilote personnellement sur cette équipe.", "What I personally run in this team.")}>
              {!userProfile?.teamEmailSent ? (
                <p className="status-pill status-pill--pending">
                  {tr("Affectation provisoire, susceptible d'être modifiée", "Provisional assignment, may still change")}
                </p>
              ) : null}
              <dl className="detail-list">
                <div>
                  <dt>{tr("Fonction", "Role")}</dt>
                  <dd>{teamRoleLabel(myAssignment?.teamRole || "Chef d'équipe")}</dd>
                </div>
                <div>
                  <dt>{tr("Équipe", "Team")}</dt>
                  <dd>{selectedRole.roleName}</dd>
                </div>
                <div>
                  <dt>Briefing</dt>
                  <dd>{selectedRole.briefingTime || tr("À confirmer", "To be confirmed")}</dd>
                </div>
                <div>
                  <dt>{tr("Créneau équipe", "Team shift")}</dt>
                  <dd>{selectedRole.shiftTime || tr("À confirmer", "To be confirmed")}</dd>
                </div>
              </dl>
            </Panel>

            <Panel title={tr("Chef d'équipe", "Team leader")}>
              <dl className="detail-list">
                <div>
                  <dt>{tr("Nom", "Name")}</dt>
                  <dd>{selectedRole.leaderName || tr("À confirmer", "To be confirmed")}</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>{selectedRole.leaderContact || tr("À confirmer", "To be confirmed")}</dd>
                </div>
                <div>
                  <dt>Briefing</dt>
                  <dd>{selectedRole.briefingTime || tr("À confirmer", "To be confirmed")}</dd>
                </div>
                <div>
                  <dt>{tr("Horaire du poste", "Shift hours")}</dt>
                  <dd>{selectedRole.shiftTime || tr("À confirmer", "To be confirmed")}</dd>
                </div>
              </dl>
            </Panel>

            <Panel title={tr("Informations générales", "General information")}>
              <AuthFormField label={tr("Message d'équipe", "Team message")}>
                <textarea
                  rows="5"
                  value={selectedRole.teamInfo}
                  placeholder={selectedRole.teamInfoPlaceholder || tr("Informations générales pour l'équipe", "General information for the team")}
                  readOnly
                />
              </AuthFormField>
            </Panel>
          </section>

          <Panel
            title={tr("Documents équipe", "Team documents")}
            subtitle={tr(
              "Déposez un fichier ou collez un lien visible par votre équipe. Les administrateurs voient aussi ces documents dans l'espace documentaire.",
              "Upload a file or paste a link your team can see. Administrators also see these documents in the documents area.",
            )}
          >
            <form className="section-stack" onSubmit={addDocument}>
              <AuthFormField label={tr("Titre du document", "Document title")}>
                <input
                  name="title"
                  required
                  placeholder={tr("Briefing équipe, plan d'accès, feuille de route...", "Team briefing, access map, run sheet...")}
                  value={documentForm.title}
                  disabled={isSavingDocument}
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
                  storagePath={`team-documents/${selectedRole.id}`}
                  label={tr("Fichier", "File")}
                  helperText={tr(
                    "PDF ou image · ou collez un lien ci-dessous si le document est déjà hébergé ailleurs",
                    "PDF or image · or paste a link below if the document is already online",
                  )}
                />
                <AuthFormField label={tr("Ou lien de consultation", "Or link")}>
                  <input
                    name="externalLink"
                    placeholder={tr("Lien vers un document déjà en ligne (Drive, site...)", "Link to a document already online (Drive, website...)")}
                    value={documentForm.externalLink}
                    disabled={isSavingDocument || Boolean(documentForm.fileUrl)}
                    onChange={handleDocumentFormChange}
                  />
                </AuthFormField>
              </div>

              <div className="table-actions table-actions--inline">
                <button
                  className="button button--secondary"
                  disabled={isSavingDocument || !documentForm.title.trim() || !(documentForm.fileUrl.trim() || documentForm.externalLink.trim())}
                  type="submit"
                >
                  {isSavingDocument ? tr("Enregistrement...", "Saving...") : tr("Ajouter le document", "Add the document")}
                </button>
              </div>
            </form>

            {documentStatus ? <p className="panel-note">{documentStatus}</p> : null}
            {documentsError ? <p className="panel-note">{documentsError}</p> : null}
            {documentsLoading ? <p className="panel-note">{tr("Chargement des documents...", "Loading documents...")}</p> : null}

            <div className="document-tag-list">
              {teamDocuments.length ? (
                teamDocuments.map((documentItem) => {
                  const consultationUrl = getDocumentReferenceUrl(documentItem);
                  const canRemove =
                    documentItem.scope === "teams" &&
                    documentItem.uploadedByUid === String(currentUser?.uid || "").trim();

                  return (
                    <span key={documentItem.id} className="document-tag">
                      <button
                        className="document-tag__link"
                        type="button"
                        disabled={!consultationUrl}
                        onClick={() => window.open(consultationUrl, "_blank", "noopener,noreferrer")}
                      >
                        {documentItem.title}
                      </button>
                      {canRemove ? (
                        <button
                          className="document-tag__remove"
                          type="button"
                          disabled={isSavingDocument}
                          aria-label={tr(`Retirer ${documentItem.title}`, `Remove ${documentItem.title}`)}
                          title={tr("Retirer ce document", "Remove this document")}
                          onClick={() => removeDocument(documentItem)}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  );
                })
              ) : (
                <p className="panel-note">{tr("Aucun document d'équipe ajouté pour l'instant.", "No team documents yet.")}</p>
              )}
            </div>
          </Panel>

          <Panel title={tr("Membres affectés", "Assigned members")}>
            <div className="team-selection-summary" aria-live="polite">
              <div className="team-summary-pill">
                <strong>{volunteerCount}</strong>
                <span>{tr("Membres actifs", "Active members")}</span>
              </div>
              <div className="team-summary-pill">
                <strong>{teamLeadCount}</strong>
                <span>{tr("Chefs d'équipe", "Team leaders")}</span>
              </div>
              <div className="team-summary-pill">
                <strong>{replacementCount}</strong>
                <span>{tr("Remplaçants", "Substitutes")}</span>
              </div>
              <div className="team-summary-pill">
                <strong>{Math.max(selectedRole.neededCount - volunteerCount, 0)}</strong>
                <span>{tr("Postes à compléter", "Places to fill")}</span>
              </div>
            </div>
            <DataTable
              columns={[
                { key: "name", label: tr("Nom", "Name") },
                { key: "mission", label: tr("Fonction", "Role") },
                { key: "contact", label: "Contact" },
              ]}
              rows={teamRows.length ? teamRows : [{ name: tr("Aucun membre affecté", "No members assigned"), mission: "-", contact: "-" }]}
            />
          </Panel>
        </>
      ) : (
        <Panel title={tr("Mon équipe", "My team")}>
          <p className="panel-note">{tr("Aucune équipe n'est encore liée à ce profil.", "No team is linked to your profile yet.")}</p>
        </Panel>
      )}
    </div>
  );
}

export { TeamPage };
