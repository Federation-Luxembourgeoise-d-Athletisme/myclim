import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, collectionGroup, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase";
import { buildUserIdentitySet, getAssignedTeamNames } from "./common-helpers";
import { useBudgetInvoiceConfiguration, useCertificateConfiguration, useTeamConfiguration } from "./config-hooks";
import { getDocumentReferenceUrl, useDocumentsCollection } from "./documents-hooks";
import { useActiveEdition } from "./edition";
import { canUserUploadBudgetInvoice } from "./budget-invoice-config";
import { formatInvoiceStatusLabel, getInvoiceDocumentUrl, InvoiceUploadForm } from "./invoice-management";
import { buildParticipationCertificateMarkup, getRoundedParticipationHours, normalizePresenceRecord } from "./presence-helpers";
import { extractRolesFromProfile, normalizeRole } from "./utils";
import { buildVipFullName, getVipTourChoiceLabel, VIP_TOUR_OPTIONS } from "./vip-helpers";
import { useLanguage } from "./language-context";
import { useAuth } from "../context/auth-context";

const VIP_TOUR_GUIDE_TEAM_NAME = "Guides VIP";

function MyAssignmentsPage(props) {
  const { DataTable, Panel } = props;
  const { t } = useLanguage();
  const { currentUser, userProfile } = useAuth();
  const { roles, teamAssignments, loading, error } = useTeamConfiguration();
  const { documents } = useDocumentsCollection(true);
  const userIdentitySet = useMemo(
    () => buildUserIdentitySet(userProfile, currentUser),
    [buildUserIdentitySet, currentUser, userProfile],
  );
  const assignedTeamNames = useMemo(() => getAssignedTeamNames(userProfile), [getAssignedTeamNames, userProfile]);
  const isVipTourGuide = assignedTeamNames.includes(VIP_TOUR_GUIDE_TEAM_NAME);
  const isAssignmentProvisional = !userProfile?.teamEmailSent;
  const [vipTourRegistrations, setVipTourRegistrations] = useState([]);

  useEffect(() => {
    if (!isVipTourGuide) {
      setVipTourRegistrations([]);
      return undefined;
    }

    const bySource = { public: [], partner: [], admin: [] };
    function recomputeVipTourRegistrations() {
      setVipTourRegistrations([...bySource.public, ...bySource.partner, ...bySource.admin]);
    }

    const unsubscribePublic = onSnapshot(collection(db, "vipPublicRegistrations"), (snapshot) => {
      bySource.public = snapshot.docs.map((registrationDoc) => ({ id: registrationDoc.id, ...registrationDoc.data() }));
      recomputeVipTourRegistrations();
    });
    const unsubscribePartner = onSnapshot(collectionGroup(db, "entries"), (snapshot) => {
      bySource.partner = snapshot.docs
        .filter((entryDoc) => entryDoc.ref.path.startsWith("vipPartnerPortals/"))
        .map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() }));
      recomputeVipTourRegistrations();
    });
    const unsubscribeAdmin = onSnapshot(collection(db, "vipAdminRegistrations"), (snapshot) => {
      bySource.admin = snapshot.docs.map((registrationDoc) => ({ id: registrationDoc.id, ...registrationDoc.data() }));
      recomputeVipTourRegistrations();
    });

    return () => {
      unsubscribePublic();
      unsubscribePartner();
      unsubscribeAdmin();
    };
  }, [isVipTourGuide]);
  const myAssignments = useMemo(
    () =>
      teamAssignments.filter((member) =>
        [member.id, member.email, `${member.firstName} ${member.lastName}`.trim()]
          .map((value) => String(value || "").trim().toLowerCase())
          .some((value) => value && userIdentitySet.has(value)),
      ),
    [teamAssignments, userIdentitySet],
  );
  const fallbackProfileAssignment = useMemo(() => {
    if (!assignedTeamNames.length) return null;

    return {
      assignmentEntryId: "profile-fallback",
      assignedRole: assignedTeamNames[0],
      teamRole: userProfile?.teamRole || t("volunteerFallbackLabel"),
    };
  }, [assignedTeamNames, t, userProfile]);
  const availableAssignments = useMemo(() => {
    if (myAssignments.length) return myAssignments;
    return fallbackProfileAssignment ? [fallbackProfileAssignment] : [];
  }, [fallbackProfileAssignment, myAssignments]);
  const assignmentDetails = useMemo(
    () =>
      availableAssignments.map((assignment, index) => {
        const selectedRole =
          roles.find(
            (role) =>
              normalizeRole(role.id) === normalizeRole(assignment?.assignedRoleId) ||
              normalizeRole(role.roleName) === normalizeRole(assignment?.assignedRole),
          ) ?? null;
        const teamMembers = teamAssignments.filter((member) => member.assignedRoleId === selectedRole?.id);
        const leader = teamMembers.find((member) => member.teamRole === "Chef d'équipe") ?? null;
        const teamRows = teamMembers.map((member) => ({
          name: `${member.firstName} ${member.lastName}`.trim() || member.email || "Bénévole",
          role: member.teamRole,
          contact:
            member.teamRole === "Chef d'équipe"
              ? member.email || member.phone || "À demander"
              : "Visible via le briefing",
        }));

        const roleDocuments = documents
          .filter((documentItem) => documentItem.documentType !== "invoice")
          .filter(
            (documentItem) =>
              documentItem.scope === "global" ||
              (documentItem.scope === "teams" && documentItem.teams.includes(selectedRole?.roleName)),
          )
          .sort((left, right) => right.createdAtMs - left.createdAtMs);

        const isVipTourGuideAssignment =
          (selectedRole?.roleName || assignment.assignedRole) === VIP_TOUR_GUIDE_TEAM_NAME;
        const vipTourGroups = isVipTourGuideAssignment
          ? VIP_TOUR_OPTIONS.filter((option) => option.value !== "none").map((option) => ({
              tourValue: option.value,
              tourLabel: getVipTourChoiceLabel(option.value),
              guests: vipTourRegistrations.filter(
                (registration) => String(registration.vipTourChoice || "").trim().toLowerCase() === option.value,
              ),
            }))
          : [];

        return {
          key: assignment.assignmentEntryId || `${assignment.id || "assignment"}-${assignment.assignedRoleId || index}`,
          assignment,
          selectedRole,
          leader,
          teamRows,
          roleDocuments,
          isVipTourGuideAssignment,
          vipTourGroups,
        };
      }),
    [availableAssignments, documents, roles, teamAssignments, vipTourRegistrations],
  );

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{t("assignmentsEyebrow")}</p>
          <h1>{t("assignmentsTitle")}</h1>
          <p>{t("assignmentsSubtitle")}</p>
        </div>
      </section>
      {error ? <p className="status-note">{error}</p> : null}
      {loading ? <p className="status-note">{t("assignmentsLoading")}</p> : null}

      {assignmentDetails.length > 1 ? (
        <Panel title={t("assignmentsMissionsPanelTitle")} subtitle={t("assignmentsMissionsPanelSubtitle")}>
          <div className="role-chip-grid">
            {assignmentDetails.map(({ key, assignment, selectedRole }) => (
              <div key={key} className="role-chip role-chip--active">
                <strong>{selectedRole?.roleName || assignment.assignedRole || t("assignmentsMissionFallbackTitle")}</strong>
                <span>{assignment.teamRole || t("volunteerFallbackLabel")}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {assignmentDetails.length ? (
        <>
          {assignmentDetails.map(({ key, assignment, selectedRole, leader, teamRows, roleDocuments, isVipTourGuideAssignment, vipTourGroups }) => (
            <section key={key} className="assignment-group">
              <div className="assignment-group__header">
                <p className="assignment-group__eyebrow">{t("assignmentsMissionEyebrow")}</p>
                <h2>{selectedRole?.roleName || assignment.assignedRole || t("assignmentsMissionFallbackTitle")}</h2>
                <p>{t("assignmentsMissionIntro")}</p>
                {isAssignmentProvisional ? (
                  <span className="status-pill status-pill--pending">{t("assignmentsProvisionalBadge")}</span>
                ) : null}
              </div>
              <section className="panel-grid panel-grid--2">
                <Panel
                  title={selectedRole?.roleName || assignment.assignedRole || t("assignmentsMissionFallbackTitle")}
                  subtitle={t("assignmentsMissionPanelSubtitle")}
                >
                  <dl className="detail-list">
                    <div>
                      <dt>{t("assignmentsTeamLabel")}</dt>
                      <dd>{selectedRole?.roleName || assignment.assignedRole || t("assignmentsToBeConfirmed")}</dd>
                    </div>
                    <div>
                      <dt>{t("assignmentsFunctionLabel")}</dt>
                      <dd>{assignment.teamRole || userProfile?.teamRole || t("volunteerFallbackLabel")}</dd>
                    </div>
                    <div>
                      <dt>{t("assignmentsShiftLabel")}</dt>
                      <dd>{userProfile?.shift || selectedRole?.shiftTime || t("assignmentsToBeConfirmed")}</dd>
                    </div>
                    <div>
                      <dt>{t("assignmentsStatusLabel")}</dt>
                      <dd>{userProfile?.assignmentStatus || t("assignmentsToBeConfirmed")}</dd>
                    </div>
                  </dl>
                </Panel>

                <Panel title={t("assignmentsCoordinationPanelTitle")} subtitle={t("assignmentsCoordinationPanelSubtitle")}>
                  <dl className="detail-list">
                    <div>
                      <dt>{t("assignmentsTeamLeadLabel")}</dt>
                      <dd>{leader ? `${leader.firstName} ${leader.lastName}`.trim() : selectedRole?.leaderName || t("assignmentsToBeConfirmed")}</dd>
                    </div>
                    <div>
                      <dt>{t("assignmentsContactLabel")}</dt>
                      <dd>{leader?.email || leader?.phone || selectedRole?.leaderContact || t("assignmentsToBeConfirmed")}</dd>
                    </div>
                    <div>
                      <dt>{t("assignmentsBriefingLabel")}</dt>
                      <dd>{selectedRole?.briefingTime || t("assignmentsToBeConfirmed")}</dd>
                    </div>
                    <div>
                      <dt>{t("assignmentsInstructionsLabel")}</dt>
                      <dd>{selectedRole?.teamInfo || selectedRole?.teamInfoPlaceholder || t("assignmentsInstructionsFallback")}</dd>
                    </div>
                  </dl>
                </Panel>
              </section>

              <Panel title={t("assignmentsTeamPanelTitle")} subtitle={t("assignmentsTeamPanelSubtitle")}>
                <DataTable
                  columns={[
                    { key: "name", label: t("assignmentsColumnName") },
                    { key: "role", label: t("assignmentsColumnFunction") },
                    { key: "contact", label: t("assignmentsColumnContact") },
                  ]}
                  rows={teamRows.length ? teamRows : [{ name: t("assignmentsTeamUnavailable"), role: "-", contact: "-" }]}
                />
              </Panel>

              {isVipTourGuideAssignment ? (
                <Panel title={t("vipGuidePanelTitle")} subtitle={t("vipGuidePanelSubtitleAll")}>
                  {vipTourGroups.map((group) => (
                    <div key={group.tourValue} className="vip-guide-tour-group">
                      <h3 className="vip-guide-tour-group__title">
                        {group.tourLabel} ({group.guests.length})
                      </h3>
                      {group.guests.length ? (
                        <DataTable
                          columns={[
                            { key: "name", label: t("vipGuideColumnName") },
                            { key: "organization", label: t("vipFieldOrganization") },
                            { key: "guest", label: t("vipGuideColumnCompanion") },
                          ]}
                          rows={group.guests.map((registration) => ({
                            name: buildVipFullName(registration) || "—",
                            organization: registration.organization || "—",
                            guest:
                              `${registration.guestFirstName || ""} ${registration.guestLastName || ""}`.trim() || "—",
                          }))}
                        />
                      ) : (
                        <p className="panel-note">{t("vipGuideEmpty")}</p>
                      )}
                    </div>
                  ))}
                </Panel>
              ) : null}

              <Panel title={t("assignmentsDocumentsPanelTitle")} subtitle={t("assignmentsDocumentsPanelSubtitle")}>
                {roleDocuments.length ? (
                  <div className="document-tag-list">
                    {roleDocuments.map((documentItem) => {
                      const consultationUrl = getDocumentReferenceUrl(documentItem);
                      return (
                        <button
                          key={documentItem.id}
                          className="document-tag document-tag--removable"
                          type="button"
                          disabled={!consultationUrl}
                          onClick={() => window.open(consultationUrl, "_blank", "noopener,noreferrer")}
                        >
                          {documentItem.title}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="panel-note">{t("assignmentsDocumentsEmpty")}</p>
                )}
              </Panel>
            </section>
          ))}
        </>
      ) : (
        <Panel title={t("assignmentsEmptyPanelTitle")} subtitle={t("assignmentsEmptyPanelSubtitle")}>
          <p className="panel-note">{t("assignmentsEmptyParagraph1")}</p>
          <p className="panel-note">{t("assignmentsEmptyParagraph2")}</p>
        </Panel>
      )}
    </div>
  );
}

function MyDocumentsPage(props) {
  const { DataTable, Panel, getDocumentConsultationUrl, getTimestampMs } = props;
  const { t } = useLanguage();
  const { currentUser, userProfile } = useAuth();
  const { documents, loading: documentsLoading, error: documentsError } = useDocumentsCollection(true);
  const { activeEditionId } = useActiveEdition(Boolean(currentUser?.uid));
  const invoiceConfiguration = useBudgetInvoiceConfiguration();
  const { signatoryName, signatoryTitle, signatureImageUrl } = useCertificateConfiguration();
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

  const assignedTeams = useMemo(() => {
    const values = [
      userProfile?.assignedRole,
      userProfile?.teamName,
      ...(Array.isArray(userProfile?.assignedTeams) ? userProfile.assignedTeams : []),
    ].filter(Boolean);

    return [...new Set(values)];
  }, [userProfile]);

  const availableDocuments = useMemo(() => {
    return documents.filter((document) => {
      if (document.documentType === "invoice") return false;
      if (document.scope === "global" || document.teams.length === 0) return true;
      if (assignedTeams.length === 0) return false;
      return document.teams.some((team) => assignedTeams.includes(team));
    });
  }, [assignedTeams, documents]);
  const ownInvoices = useMemo(
    () =>
      documents
        .filter(
          (document) =>
            document.documentType === "invoice" &&
            String(document.uploadedByUid || document.ownerUid || "").trim() === String(currentUser?.uid || "").trim(),
        )
        .sort((left, right) => right.createdAtMs - left.createdAtMs),
    [currentUser?.uid, documents],
  );
  const participationHours = useMemo(
    () => getRoundedParticipationHours(userProfile?.presence, getTimestampMs),
    [getTimestampMs, userProfile?.presence],
  );
  const canGenerateCertificate = participationHours > 0;

  const openParticipationCertificate = useCallback(() => {
    if (typeof window === "undefined" || !canGenerateCertificate) return;

    const printWindow = window.open("", "_blank", "width=1100,height=850");
    if (!printWindow) return;

    const markup = buildParticipationCertificateMarkup({
      fullName: `${userProfile?.firstName || ""} ${userProfile?.lastName || ""}`.trim() || userProfile?.email || "Volunteer",
      teamName: assignedTeams[0] || "Volunteer Team",
      roleLabel: userProfile?.teamRole || "Volunteer",
      roundedHours: participationHours,
      signatory: signatoryName,
      signatoryTitle,
      signatureImageUrl,
      editionLabel: activeEditionId ? `Edition ${activeEditionId}` : "",
    });

    printWindow.document.write(markup);
    printWindow.document.close();
  }, [
    activeEditionId,
    assignedTeams,
    canGenerateCertificate,
    participationHours,
    signatoryName,
    signatoryTitle,
    signatureImageUrl,
    userProfile,
  ]);

  const documentRows = useMemo(
    () => {
      const rows = availableDocuments.map((document) => ({
        title: document.title,
        team: document.scope === "global" ? "Global" : document.teams.join(", "),
        open: (
          <button
            className="document-icon-button"
            type="button"
            disabled={!getDocumentConsultationUrl(document)}
            aria-label={t("documentsOpenAria").replace("{title}", document.title)}
            title={t("documentsOpenAria").replace("{title}", document.title)}
            onClick={() => window.open(getDocumentConsultationUrl(document), "_blank", "noopener,noreferrer")}
          >
            <span aria-hidden="true">↗</span>
          </button>
        ),
      }));

      rows.unshift({
        title: t("documentsCertificateTitle"),
        team: assignedTeams[0] || t("volunteerFallbackLabel"),
        open: (
          <button
            className="button button--secondary"
            type="button"
            disabled={!canGenerateCertificate}
            onClick={openParticipationCertificate}
          >
            {canGenerateCertificate ? t("documentsCertificateGenerate") : t("documentsCertificateUnavailable")}
          </button>
        ),
      });

      return rows;
    },
    [
      assignedTeams,
      availableDocuments,
      canGenerateCertificate,
      getDocumentConsultationUrl,
      openParticipationCertificate,
      t,
    ],
  );

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{t("documentsEyebrow")}</p>
          <h1>{t("documentsTitle")}</h1>
          <p>{t("documentsSubtitle")}</p>
        </div>
      </section>
      {documentsError ? <p className="panel-note">{documentsError}</p> : null}
      {canUploadInvoices ? (
        <Panel title={t("documentsUploadInvoicePanelTitle")} subtitle={t("documentsUploadInvoicePanelSubtitle")}>
          <InvoiceUploadForm
            editionId={activeEditionId}
            currentUser={currentUser}
            userProfile={userProfile}
            assignedTeams={assignedTeams}
          />
        </Panel>
      ) : null}
      <Panel title={t("documentsAvailablePanelTitle")}>
        {documentsLoading ? <p className="panel-note">{t("documentsLoading")}</p> : null}
        <DataTable
          columns={[
            { key: "title", label: t("documentsColumnTitle") },
            { key: "team", label: t("documentsColumnTeam") },
            { key: "open", label: t("documentsColumnOpen") },
          ]}
          rows={
            documentRows.length
              ? documentRows
              : [
                  {
                    title: assignedTeams.length ? t("documentsEmptyWithTeam") : t("documentsEmptyNoTeam"),
                    team: assignedTeams.join(", ") || t("documentsPendingAssignment"),
                    open: "-",
                  },
                ]
          }
        />
        <p className="panel-note">
          {canGenerateCertificate ? t("documentsCertificateReadyNote") : t("documentsCertificatePendingNote")}
        </p>
      </Panel>

      {canUploadInvoices || ownInvoices.length ? (
        <Panel title={t("documentsInvoicesPanelTitle")} subtitle={t("documentsInvoicesPanelSubtitle")}>
          <DataTable
            columns={[
              { key: "title", label: t("documentsColumnInvoice") },
              { key: "edition", label: t("documentsColumnEdition") },
              { key: "status", label: t("documentsColumnStatus") },
              { key: "open", label: t("documentsColumnOpen") },
            ]}
            rows={
              ownInvoices.length
                ? ownInvoices.map((invoice) => ({
                    title: invoice.title || invoice.fileName || t("documentsColumnInvoice"),
                    edition: invoice.editionId || "—",
                    status: formatInvoiceStatusLabel(invoice, t),
                    open: (
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={!getInvoiceDocumentUrl(invoice)}
                        onClick={() => window.open(getInvoiceDocumentUrl(invoice), "_blank", "noopener,noreferrer")}
                      >
                        {invoice.fileName || t("documentsOpenButtonFallback")}
                      </button>
                    ),
                  }))
                : [
                    {
                      title: t("documentsNoInvoice"),
                      edition: activeEditionId || "—",
                      status: "—",
                      open: "—",
                    },
                  ]
            }
          />
        </Panel>
      ) : null}
    </div>
  );
}

export { MyAssignmentsPage, MyDocumentsPage };
