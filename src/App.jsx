import { Suspense, lazy } from "react";
import {
  arrayRemove,
  arrayUnion,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { AuthFormField } from "./app/form-components";
import { LanguageProvider } from "./app/language";
import { SiteLayout } from "./site/site-layout";
import { SiteHome } from "./site/site-home";
import { SiteEvent } from "./site/site-event";
import { SiteEmagazine, SiteEmagazineFrame } from "./site/site-emagazine";
import { SiteStatistics } from "./site/site-statistics";
import { SitePress } from "./site/site-press";
import { SitePartners } from "./site/site-partners";
import { SiteSponsorship } from "./site/site-sponsorship";
import { SiteNewsListPage, SiteNewsArticlePage } from "./site/site-news";
import { SitePreProgramme } from "./site/site-preprogramme";
import { SiteGallery } from "./site/site-gallery";
import { VolunteersPage as VolunteersPageScreen } from "./app/volunteers-page";
import { AccreditationsPage as AccreditationsPageScreen } from "./app/accreditations-page";
import {
  AppShell as AppShellScreen,
  DashboardHome as DashboardHomeScreen,
  EditionSettingsPage as EditionSettingsPageScreen,
} from "./app/app-shell-layout";
import {
  CertificateSettingsPage as CertificateSettingsPageScreen,
  PresencePage as PresencePageScreen,
  RoleManagementPage as RoleManagementPageScreen,
  TeamsPage as TeamsPageScreen,
} from "./app/admin-operations-pages";
import { BudgetTrackingPage as BudgetTrackingPageScreen } from "./app/budget-tracking-page";
import { MyAssignmentsPage as MyAssignmentsPageScreen, MyDocumentsPage as MyDocumentsPageScreen } from "./app/volunteer-space-pages";
import { DocumentsPage as DocumentsPageScreen } from "./app/documents-page";
import { MyChildrenPage as MyChildrenPageScreen } from "./app/my-children-page";
import { MyNationalRacePage as MyNationalRacePageScreen } from "./app/my-national-race-page";
import { NationalRacesPage as NationalRacesPageScreen } from "./app/national-races-page";
import { ProfilePage as ProfilePageScreen, VolunteerProfilePage as VolunteerProfilePageScreen } from "./app/profile-pages";
import { TeamPage as TeamPageScreen } from "./app/team-page";
import {
  normalizeSubRoles,
  syncVolunteerAssignmentsToTeamConfiguration,
} from "./app/team-config";
import { U14Page as U14PageScreen } from "./app/u14-page";
import {
  formatDateTimeForDisplay,
  getTimestampMs,
  luxCompetitionClubs,
  normalizeComparableValue,
  syncU14RaceAllocations,
} from "./app/u14-helpers";
import { LegacyRedirect, RequireAuth, RequireRouteAccess } from "./app/route-guards";
import { TabbedPage } from "./app/page-tabs";
import { LEGACY_APP_REDIRECTS, STATISTICS_ACCESS_ROLES } from "./app/navigation";
import { ACCREDITATION_CONFIGURATION_DOC_PATH } from "./app/seed-data";
import { getU14CategoryFromBirthDate } from "./app/utils";
import { db } from "./services/firebase";
import "./App.css";
import cmcmLogo from "./assets/cmcm-logo.png";

const VOLUNTEER_SUPPORT_AVAILABILITY_OPTIONS = [
  "Avant-meeting - vendredi matin",
  "Avant-meeting - vendredi après-midi",
  "Avant-meeting - samedi matin",
  "Avant-meeting - samedi après-midi",
  "Après-meeting - lundi 9h-12h",
];
let mailQueueModulePromise;
const lazyNamed = (factory, exportName) =>
  lazy(() => factory().then((module) => ({ default: module[exportName] })));
const LoginPage = lazyNamed(() => import("./app/public-auth-pages"), "LoginPage");
const VolunteerAccessPage = lazyNamed(() => import("./app/public-auth-pages"), "VolunteerAccessPage");
const PreProgrammeAccessPage = lazyNamed(() => import("./app/preprogramme-access-page"), "PreProgrammeAccessPage");
const VipAccessPage = lazyNamed(() => import("./app/vip-pages"), "VipAccessPage");
const VipPartnerPortalPage = lazyNamed(() => import("./app/vip-pages"), "VipPartnerPortalPage");
const VipAdminPage = lazyNamed(() => import("./app/vip-admin-page"), "VipAdminPage");
const PressRegistrationPage = lazyNamed(() => import("./app/press-registration-page"), "PressRegistrationPage");
const PressAdminPageScreen = lazyNamed(() => import("./app/press-admin-page"), "PressAdminPage");
const AthletesListPageScreen = lazyNamed(() => import("./app/athlete-portal-pages"), "AthletesListPage");
const AthleteImportPageScreen = lazyNamed(() => import("./app/athlete-portal-pages"), "AthleteImportPage");
const AthletePortalSettingsPageScreen = lazyNamed(() => import("./app/athlete-portal-pages"), "AthletePortalSettingsPage");
const AthleteRegistryPageScreen = lazyNamed(() => import("./app/athlete-portal-pages"), "AthleteRegistryPage");
const AthleteTransportChiefPageScreen = lazyNamed(() => import("./app/athlete-transport-pages"), "AthleteTransportChiefPage");
const AthleteTransportVolunteerPageScreen = lazyNamed(() => import("./app/athlete-transport-pages"), "AthleteTransportVolunteerPage");
const MeetingHistoryPageScreen = lazyNamed(() => import("./app/meeting-history-pages"), "MeetingHistoryPage");
const MeetingRecordsPageScreen = lazyNamed(() => import("./app/meeting-history-pages"), "MeetingRecordsPage");
const MeetingWinnersPageScreen = lazyNamed(() => import("./app/meeting-history-pages"), "MeetingWinnersPage");
const WebsiteNewsPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsiteNewsPage");
const WebsiteSponsorsPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsiteSponsorsPage");
const WebsitePressPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsitePressPage");
const WebsiteEditionPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsiteEditionPage");
const WebsiteEmagazinePageScreen = lazyNamed(() => import("./app/website-emagazine-page"), "WebsiteEmagazinePage");
const WebsiteLinksPageScreen = lazyNamed(() => import("./app/website-links-page"), "WebsiteLinksPage");
const SiteLinks = lazyNamed(() => import("./site/site-links"), "SiteLinks");
const InvitationAdminPageScreen = lazyNamed(() => import("./app/invitation-admin-page"), "InvitationAdminPage");
const InvitePage = lazyNamed(() => import("./app/invite-page"), "InvitePage");
const NotificationsPage = lazyNamed(() => import("./app/notifications/notifications-ui"), "NotificationsPage");
const CommunicationModule = lazyNamed(() => import("./app/communication/communication-module"), "CommunicationModule");
const AthleteRoadbookPage = lazyNamed(() => import("./site/athlete-roadbook-page"), "AthleteRoadbookPage");
const AthleteRoadbookAdminPageScreen = lazyNamed(() => import("./app/athlete-roadbook-admin-page"), "AthleteRoadbookAdminPage");
const PhysioPageScreen = lazyNamed(() => import("./app/physio-page"), "PhysioPage");
const CashDeskPage = lazyNamed(() => import("./app/cash-desk-page"), "CashDeskPage");
const CashDeskAdminPageScreen = lazyNamed(() => import("./app/cash-desk-admin-page"), "CashDeskAdminPage");

async function loadMailQueueModule() {
  if (!mailQueueModulePromise) {
    mailQueueModulePromise = import("./services/mailQueue");
  }

  return mailQueueModulePromise;
}

async function syncVolunteerAssignmentToUserProfile(volunteer) {
  const userId = String(volunteer?.uid || "").trim();
  if (!userId) return;

  const assignedRoles = normalizeSubRoles(
    Array.isArray(volunteer?.assignedRoles)
      ? volunteer.assignedRoles
      : volunteer?.assignedRole
        ? [volunteer.assignedRole]
        : [],
  );

  const isTransport = assignedRoles.some((r) => r.toLowerCase() === "transport");
  const isTransportChief = isTransport && volunteer?.teamRole === "Chef d'équipe";

  await setDoc(
    doc(db, "users", userId),
    {
      assignedRole: assignedRoles[0] || "",
      assignedTeams: assignedRoles,
      teamRole: volunteer?.teamRole || "Bénévole",
      assignmentStatus: volunteer?.assignmentStatus || (assignedRoles.length > 0 ? "Proposé" : "En attente"),
      workflowStatus:
        volunteer?.workflowStatus || (assignedRoles.length > 0 ? "Affecté" : "Candidature reçue"),
      teamEmailSent: Boolean(volunteer?.teamEmailSent),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  // Sync transport platform roles based on team assignment. The roles can
  // also be given by hand (roles page, invitation — a transport chief rarely
  // fills the volunteer form), so the sync only removes what it added itself,
  // tracked in teamGrantedRoles.
  const dueRoles = [
    ...(isTransport ? ["benevole_transport_athletes"] : []),
    ...(isTransportChief ? ["chef_transport_athletes"] : []),
  ];
  const userSnapshot = await getDoc(doc(db, "users", userId));
  const userData = userSnapshot.exists() ? userSnapshot.data() : {};
  const currentRoles = Array.isArray(userData.userTypes) ? userData.userTypes : [];
  const previouslyGranted = Array.isArray(userData.teamGrantedRoles) ? userData.teamGrantedRoles : [];
  const rolesToAdd = dueRoles.filter((role) => !currentRoles.includes(role));
  const rolesToRemove = previouslyGranted.filter((role) => !dueRoles.includes(role));
  const nextTeamGrantedRoles = [
    ...previouslyGranted.filter((role) => dueRoles.includes(role)),
    ...rolesToAdd,
  ];

  if (rolesToAdd.length) {
    await updateDoc(doc(db, "users", userId), { userTypes: arrayUnion(...rolesToAdd) });
  }
  if (rolesToRemove.length) {
    await updateDoc(doc(db, "users", userId), { userTypes: arrayRemove(...rolesToRemove) });
  }
  if (rolesToAdd.length || rolesToRemove.length) {
    await updateDoc(doc(db, "users", userId), { teamGrantedRoles: nextTeamGrantedRoles });
  }
}

function isExternalDocumentLink(value) {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getDocumentConsultationUrl(document) {
  if (document?.fileUrl) return document.fileUrl;
  if (isExternalDocumentLink(document?.reference)) return document.reference;
  return "";
}

// Pages regroupées en onglets : chaque onglet garde sa propre adresse.
const PRESS_TABS = [
  { to: "/app/presse", end: true, label: "Demandes d'accréditation", allowedRoles: ["admin", "gestionnaire"] },
  { to: "/app/presse/diffusion", label: "Liste de diffusion", allowedRoles: ["admin", "gestionnaire"] },
  { to: "/app/presse/communiques", label: "Communiqués" },
];

const PARTNERS_TABS = [
  { to: "/app/partenaires", end: true, label: "Liste & logos" },
  { to: "/app/partenaires/contreparties", label: "Contreparties", allowedRoles: ["admin", "gestionnaire"] },
];

function AppShell() {
  return <AppShellScreen cmcmLogo={cmcmLogo} />;
}

function DashboardHome() {
  return <DashboardHomeScreen Panel={Panel} />;
}

function EditionSettingsPage() {
  return <EditionSettingsPageScreen Panel={Panel} />;
}

function Panel({ title, subtitle, children, actions }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function DataTable({ columns = [], rows = [] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id || row.key || `row-${index}`}>
              {columns.map((column) => (
                <td key={`${row.id || row.key || index}-${column.key}`}>
                  {row[column.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VolunteersPage() {
  return (
    <VolunteersPageScreen
      loadMailQueueModule={loadMailQueueModule}
      Panel={Panel}
      syncVolunteerAssignmentToUserProfile={syncVolunteerAssignmentToUserProfile}
      syncVolunteerAssignmentsToTeamConfiguration={syncVolunteerAssignmentsToTeamConfiguration}
    />
  );
}

function TeamsPage() {
  return (
    <TeamsPageScreen
      AuthFormField={AuthFormField}
      DataTable={DataTable}
      Panel={Panel}
      syncVolunteerAssignmentToUserProfile={syncVolunteerAssignmentToUserProfile}
    />
  );
}

function RoleManagementPage() {
  return <RoleManagementPageScreen AuthFormField={AuthFormField} Panel={Panel} />;
}

function CertificateSettingsPage() {
  return <CertificateSettingsPageScreen AuthFormField={AuthFormField} Panel={Panel} />;
}

function BudgetTrackingPage() {
  return <BudgetTrackingPageScreen Panel={Panel} />;
}

function DocumentsPage() {
  return (
    <DocumentsPageScreen
      AuthFormField={AuthFormField}
      Panel={Panel}
      getDocumentConsultationUrl={getDocumentConsultationUrl}
    />
  );
}

function VipPage() {
  return <VipAdminPage Panel={Panel} loadMailQueueModule={loadMailQueueModule} />;
}

function AthleteRoadbookAdminPage() {
  return <AthleteRoadbookAdminPageScreen Panel={Panel} />;
}

function PhysioPage() {
  return <PhysioPageScreen Panel={Panel} />;
}

function CashDeskAdminPage() {
  return <CashDeskAdminPageScreen Panel={Panel} />;
}

function PressAdminPage({ view }) {
  return <PressAdminPageScreen Panel={Panel} loadMailQueueModule={loadMailQueueModule} view={view} />;
}

function AthletesListPage() {
  return <AthletesListPageScreen Panel={Panel} />;
}

function AthleteImportPage() {
  return <AthleteImportPageScreen Panel={Panel} />;
}

function AthletePortalSettingsPage() {
  return <AthletePortalSettingsPageScreen Panel={Panel} />;
}

function AthleteRegistryPage() {
  return <AthleteRegistryPageScreen Panel={Panel} />;
}

function AthleteTransportChiefPage() {
  return <AthleteTransportChiefPageScreen Panel={Panel} />;
}

function AthleteTransportVolunteerPage() {
  return <AthleteTransportVolunteerPageScreen Panel={Panel} />;
}

function MeetingHistoryPage() {
  return <MeetingHistoryPageScreen Panel={Panel} />;
}

function MeetingRecordsPage() {
  return <MeetingRecordsPageScreen Panel={Panel} />;
}

function MeetingWinnersPage() {
  return <MeetingWinnersPageScreen Panel={Panel} />;
}

function WebsiteNewsPage() {
  return <WebsiteNewsPageScreen Panel={Panel} />;
}

function WebsiteSponsorsPage() {
  return <WebsiteSponsorsPageScreen Panel={Panel} />;
}

function WebsitePressPage() {
  return <WebsitePressPageScreen Panel={Panel} />;
}

function WebsiteEditionPage() {
  return <WebsiteEditionPageScreen Panel={Panel} />;
}

function WebsiteLinksPage() {
  return <WebsiteLinksPageScreen Panel={Panel} />;
}

function WebsiteEmagazinePage() {
  return <WebsiteEmagazinePageScreen Panel={Panel} />;
}

function InvitationAdminPage() {
  return <InvitationAdminPageScreen Panel={Panel} />;
}

function AccreditationsPage() {
  return (
    <AccreditationsPageScreen
      ACCREDITATION_CONFIGURATION_DOC_PATH={ACCREDITATION_CONFIGURATION_DOC_PATH}
      AuthFormField={AuthFormField}
      Panel={Panel}
      formatDateTimeForDisplay={formatDateTimeForDisplay}
      normalizeSubRoles={normalizeSubRoles}
    />
  );
}

function U14Page() {
  return (
    <U14PageScreen
      AuthFormField={AuthFormField}
      DataTable={DataTable}
      Panel={Panel}
      doc={doc}
      getDocs={getDocs}
      loadMailQueueModule={loadMailQueueModule}
      serverTimestamp={serverTimestamp}
      setDoc={setDoc}
      syncU14RaceAllocations={syncU14RaceAllocations}
      updateDoc={updateDoc}
    />
  );
}

function TeamPage() {
  return <TeamPageScreen AuthFormField={AuthFormField} DataTable={DataTable} Panel={Panel} />;
}

function PresencePage() {
  return (
    <PresencePageScreen
      Panel={Panel}
      formatDateTimeForDisplay={formatDateTimeForDisplay}
      getTimestampMs={getTimestampMs}
    />
  );
}

function MyAssignmentsPage() {
  return <MyAssignmentsPageScreen DataTable={DataTable} Panel={Panel} />;
}

function MyDocumentsPage() {
  return (
    <MyDocumentsPageScreen
      DataTable={DataTable}
      Panel={Panel}
      getDocumentConsultationUrl={getDocumentConsultationUrl}
      getTimestampMs={getTimestampMs}
    />
  );
}

function MyChildrenPage() {
  return (
    <MyChildrenPageScreen
      DataTable={DataTable}
      Panel={Panel}
      getU14CategoryFromBirthDate={getU14CategoryFromBirthDate}
      loadMailQueueModule={loadMailQueueModule}
      luxCompetitionClubs={luxCompetitionClubs}
      normalizeComparableValue={normalizeComparableValue}
    />
  );
}

function NationalRacesPage() {
  return <NationalRacesPageScreen Panel={Panel} loadMailQueueModule={loadMailQueueModule} />;
}

function MyNationalRacePage() {
  return <MyNationalRacePageScreen DataTable={DataTable} Panel={Panel} />;
}

function VolunteerProfilePage() {
  return (
    <VolunteerProfilePageScreen
      Panel={Panel}
      VOLUNTEER_SUPPORT_AVAILABILITY_OPTIONS={VOLUNTEER_SUPPORT_AVAILABILITY_OPTIONS}
      loadMailQueueModule={loadMailQueueModule}
    />
  );
}

function ProfilePage() {
  return <ProfilePageScreen Panel={Panel} />;
}

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="page"><section className="page-header"><div><p className="eyebrow">Chargement</p><h1>Ouverture de MyCLIM</h1><p>Nous chargeons la page demandée.</p></div></section></div>}>
        <Routes>
          {/* ── Public site ──────────────────────────────── */}
          <Route element={<SiteLayout />}>
            <Route path="/" element={<SiteHome />} />
            <Route path="/event" element={<SiteEvent />} />
            <Route path="/e-magazine" element={<SiteEmagazine />} />
            <Route path="/statistics" element={<SiteStatistics />} />
            <Route path="/press" element={<SitePress />} />
            <Route path="/partners" element={<SitePartners />} />
            <Route path="/become-a-partner" element={<SiteSponsorship />} />
            <Route path="/news" element={<SiteNewsListPage />} />
            <Route path="/news/:slug" element={<SiteNewsArticlePage />} />
            <Route path="/programme" element={<SitePreProgramme />} />
            <Route path="/gallery" element={<SiteGallery />} />
          </Route>

          {/* ── Auth & standalone public pages ───────────── */}
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/benevoles" element={<VolunteerAccessPage />} />
          <Route path="/volunteer-apply" element={<Navigate replace to="/benevoles" />} />
          <Route path="/pre-programme" element={<PreProgrammeAccessPage />} />
          <Route path="/vip" element={<VipAccessPage loadMailQueueModule={loadMailQueueModule} />} />
          <Route path="/vip/orga/:portalId" element={<VipPartnerPortalPage />} />
          <Route path="/presse" element={<PressRegistrationPage loadMailQueueModule={loadMailQueueModule} />} />
          <Route path="/athletes/roadbook" element={<AthleteRoadbookPage />} />
          <Route path="/caisse" element={<CashDeskPage />} />
          <Route path="/links" element={<SiteLinks />} />
          <Route path="/e-magazine/frame" element={<SiteEmagazineFrame />} />
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/app" element={<AppShell />}>
              <Route index element={<DashboardHome />} />
              {Object.entries(LEGACY_APP_REDIRECTS).map(([from, to]) => (
                <Route key={from} path={from} element={<LegacyRedirect to={to} />} />
              ))}
              <Route element={<RequireRouteAccess allowedRoles={["admin"]} />}>
                <Route path="utilisateurs" element={<RoleManagementPage />} />
                <Route path="edition" element={<EditionSettingsPage />} />
                <Route path="invitations" element={<InvitationAdminPage />} />
                <Route path="reglages" element={<CertificateSettingsPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire", "budget"]} />}>
                <Route path="budget" element={<BudgetTrackingPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire"]} />}>
                <Route path="candidatures" element={<VolunteersPage />} />
                <Route path="equipes" element={<TeamsPage />} />
                <Route path="u14/*" element={<U14Page />} />
                <Route path="accreditations/*" element={<AccreditationsPage />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="vip" element={<VipPage />} />
                <Route path="roadbook" element={<AthleteRoadbookAdminPage />} />
                <Route path="caisse" element={<CashDeskAdminPage />} />
                <Route path="calendrier/*" element={<CommunicationModule area="calendar" />} />
                <Route path="taches" element={<CommunicationModule area="tasks" />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire", "kine"]} />}>
                <Route path="kine" element={<PhysioPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire", "chef_equipe"]} />}>
                <Route path="mon-equipe" element={<TeamPage />} />
                <Route path="presences" element={<PresencePage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "benevole", "chef_equipe"]} />}>
                <Route path="mon-dossier-benevole" element={<VolunteerProfilePage />} />
                <Route path="mes-affectations" element={<MyAssignmentsPage />} />
                <Route path="mes-documents" element={<MyDocumentsPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "parent_u14"]} />}>
                <Route path="mes-enfants" element={<MyChildrenPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "commission_athletes"]} />}>
                <Route path="courses-nationales" element={<NationalRacesPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "athlete_preprogram"]} />}>
                <Route path="mon-inscription" element={<MyNationalRacePage />} />
              </Route>
              <Route path="presse" element={<TabbedPage eyebrowKey="navSectionCommunication" titleKey="navPress" title="Presse" tabs={PRESS_TABS} />}>
                <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire"]} />}>
                  <Route index element={<PressAdminPage view="requests" />} />
                  <Route path="diffusion" element={<PressAdminPage view="mailing" />} />
                </Route>
                <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire", "gestionnaire_site"]} />}>
                  <Route path="communiques" element={<WebsitePressPage />} />
                </Route>
              </Route>
              <Route path="partenaires" element={<TabbedPage eyebrowKey="navSectionCommunication" titleKey="navPartners" title="Partenaires" tabs={PARTNERS_TABS} />}>
                <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire", "gestionnaire_site"]} />}>
                  <Route index element={<WebsiteSponsorsPage />} />
                </Route>
                <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire"]} />}>
                  <Route path="contreparties/*" element={<CommunicationModule area="partners" />} />
                </Route>
              </Route>
              <Route path="mon-compte" element={<ProfilePage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route element={<RequireRouteAccess allowedRoles={["admin", "meeting_director", "chef_transport_athletes", "benevole_transport_athletes"]} />}>
                <Route path="athletes" element={<AthletesListPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "meeting_director"]} />}>
                <Route path="athlete-portal/import" element={<AthleteImportPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin"]} />}>
                <Route path="athlete-portal/settings" element={<AthletePortalSettingsPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "chef_transport_athletes"]} />}>
                <Route path="transport" element={<AthleteTransportChiefPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["benevole_transport_athletes", "admin", "gestionnaire"]} />}>
                <Route path="mes-transports" element={<AthleteTransportVolunteerPage />} />
              </Route>
              <Route path="athlete-portal/registry" element={<Navigate replace to="/app/statistics/registry" />} />
              <Route path="athlete-portal/records" element={<Navigate replace to="/app/statistics/records" />} />
              <Route path="athlete-portal/winners" element={<Navigate replace to="/app/statistics/winners" />} />
              <Route element={<RequireRouteAccess allowedRoles={STATISTICS_ACCESS_ROLES} />}>
                <Route path="resultats" element={<MeetingHistoryPage />} />
                <Route path="statistics/registry" element={<AthleteRegistryPage />} />
                <Route path="statistics/records" element={<MeetingRecordsPage />} />
                <Route path="statistics/winners" element={<MeetingWinnersPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire", "gestionnaire_site"]} />}>
                <Route path="actualites" element={<WebsiteNewsPage />} />
                <Route path="e-magazine" element={<WebsiteEmagazinePage />} />
                <Route path="page-liens" element={<WebsiteLinksPage />} />
                <Route path="website/edition" element={<WebsiteEditionPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </LanguageProvider>
  );
}
