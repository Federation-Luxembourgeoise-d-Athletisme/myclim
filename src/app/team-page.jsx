import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { buildUserIdentitySet, getDocumentUploadErrorMessage, isTeamLeadAssignment } from "./common-helpers";
import { useTeamConfiguration } from "./config-hooks";
import { getDocumentReferenceUrl, useDocumentsCollection } from "./documents-hooks";
import { FileUpload } from "./file-upload";
import { getDisplayName } from "./utils";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";

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
    name: `${member.firstName} ${member.lastName}`.trim() || member.email || "Bénévole",
    mission: member.teamRole,
    contact: member.email || member.phone || "Contact non renseigné",
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
    setDocumentStatus("Enregistrement du document...");

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
      setDocumentStatus("Document ajouté et visible par votre équipe.");
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
      setDocumentStatus("La suppression du document a échoué.");
    } finally {
      setIsSavingDocument(false);
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Chef d'equipe</p>
          <h1>Mon équipe</h1>
          <p>Vue opérationnelle limitée à l'équipe dont la personne est responsable.</p>
        </div>
      </section>

      {error ? <p className="status-note">{error}</p> : null}
      {loading ? <p className="status-note">Chargement de l'équipe...</p> : null}

      {selectedRole ? (
        <>
          <div className="admin-toolbar">
            <label className="field">
              <span>Équipe</span>
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
            <Panel title="Mon affectation" subtitle="Ce que je pilote personnellement sur cette équipe.">
              {!userProfile?.teamEmailSent ? (
                <p className="status-pill status-pill--pending">
                  Affectation provisoire, susceptible d'être modifiée
                </p>
              ) : null}
              <dl className="detail-list">
                <div>
                  <dt>Fonction</dt>
                  <dd>{myAssignment?.teamRole || "Chef d'équipe"}</dd>
                </div>
                <div>
                  <dt>Équipe</dt>
                  <dd>{selectedRole.roleName}</dd>
                </div>
                <div>
                  <dt>Briefing</dt>
                  <dd>{selectedRole.briefingTime || "À confirmer"}</dd>
                </div>
                <div>
                  <dt>Créneau équipe</dt>
                  <dd>{selectedRole.shiftTime || "À confirmer"}</dd>
                </div>
              </dl>
            </Panel>

            <Panel title="Chef d'équipe">
              <dl className="detail-list">
                <div>
                  <dt>Nom</dt>
                  <dd>{selectedRole.leaderName || "À confirmer"}</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>{selectedRole.leaderContact || "À confirmer"}</dd>
                </div>
                <div>
                  <dt>Briefing</dt>
                  <dd>{selectedRole.briefingTime || "À confirmer"}</dd>
                </div>
                <div>
                  <dt>Horaire du poste</dt>
                  <dd>{selectedRole.shiftTime || "À confirmer"}</dd>
                </div>
              </dl>
            </Panel>

            <Panel title="Informations générales">
              <AuthFormField label="Message d'équipe">
                <textarea
                  rows="5"
                  value={selectedRole.teamInfo}
                  placeholder={selectedRole.teamInfoPlaceholder || "Informations générales pour l'équipe"}
                  readOnly
                />
              </AuthFormField>
            </Panel>
          </section>

          <Panel
            title="Documents équipe"
            subtitle="Déposez un fichier ou collez un lien visible par votre équipe. Les administrateurs voient aussi ces documents dans l'espace documentaire."
          >
            <form className="section-stack" onSubmit={addDocument}>
              <AuthFormField label="Titre du document">
                <input
                  name="title"
                  required
                  placeholder="Briefing équipe, plan d'accès, feuille de route..."
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
                  label="Fichier"
                  helperText="PDF ou image · ou colle un lien ci-dessous si le document est déjà hébergé ailleurs"
                />
                <AuthFormField label="Ou lien de consultation">
                  <input
                    name="externalLink"
                    placeholder="Lien vers un document déjà en ligne (Drive, site...)"
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
                  {isSavingDocument ? "Enregistrement..." : "Ajouter le document"}
                </button>
              </div>
            </form>

            {documentStatus ? <p className="panel-note">{documentStatus}</p> : null}
            {documentsError ? <p className="panel-note">{documentsError}</p> : null}
            {documentsLoading ? <p className="panel-note">Chargement des documents...</p> : null}

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
                          aria-label={`Retirer ${documentItem.title}`}
                          title="Retirer ce document"
                          onClick={() => removeDocument(documentItem)}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  );
                })
              ) : (
                <p className="panel-note">Aucun document d'équipe ajouté pour l'instant.</p>
              )}
            </div>
          </Panel>

          <Panel title="Membres affectés">
            <div className="team-selection-summary" aria-live="polite">
              <div className="team-summary-pill">
                <strong>{volunteerCount}</strong>
                <span>Membres actifs</span>
              </div>
              <div className="team-summary-pill">
                <strong>{teamLeadCount}</strong>
                <span>Chefs d'équipe</span>
              </div>
              <div className="team-summary-pill">
                <strong>{replacementCount}</strong>
                <span>Remplaçants</span>
              </div>
              <div className="team-summary-pill">
                <strong>{Math.max(selectedRole.neededCount - volunteerCount, 0)}</strong>
                <span>Postes à compléter</span>
              </div>
            </div>
            <DataTable
              columns={[
                { key: "name", label: "Nom" },
                { key: "mission", label: "Fonction" },
                { key: "contact", label: "Contact" },
              ]}
              rows={teamRows.length ? teamRows : [{ name: "Aucun membre affecté", mission: "-", contact: "-" }]}
            />
          </Panel>
        </>
      ) : (
        <Panel title="Mon équipe">
          <p className="panel-note">Aucune équipe n'est encore liée à ce profil.</p>
        </Panel>
      )}
    </div>
  );
}

export { TeamPage };
