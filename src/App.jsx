import { Suspense, lazy } from "react";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  deleteDoc,
  doc,
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
import { SiteEmagazine } from "./site/site-emagazine";
import { SiteStatistics } from "./site/site-statistics";
import { SitePress } from "./site/site-press";
import { SitePartners } from "./site/site-partners";
import { SiteSponsorship } from "./site/site-sponsorship";
import { SiteNewsListPage, SiteNewsArticlePage } from "./site/site-news";
import { SitePreProgramme } from "./site/site-preprogramme";
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
  normalizeComparableValue,
  syncU14RaceAllocations,
} from "./app/u14-helpers";
import { RequireAuth, RequireRouteAccess } from "./app/route-guards";
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
const RegisterPage = lazyNamed(() => import("./app/public-auth-pages"), "RegisterPage");
const U14AccessPage = lazyNamed(() => import("./app/public-auth-pages"), "U14AccessPage");
const VipAccessPage = lazyNamed(() => import("./app/vip-pages"), "VipAccessPage");
const VipPartnerPortalPage = lazyNamed(() => import("./app/vip-pages"), "VipPartnerPortalPage");
const VipAdminPage = lazyNamed(() => import("./app/vip-admin-page"), "VipAdminPage");
const PressRegistrationPage = lazyNamed(() => import("./app/press-registration-page"), "PressRegistrationPage");
const PressAdminPageScreen = lazyNamed(() => import("./app/press-admin-page"), "PressAdminPage");
const AthletesListPageScreen = lazyNamed(() => import("./app/athlete-portal-pages"), "AthletesListPage");
const AthletePortalSettingsPageScreen = lazyNamed(() => import("./app/athlete-portal-pages"), "AthletePortalSettingsPage");
const AthleteRegistryPageScreen = lazyNamed(() => import("./app/athlete-portal-pages"), "AthleteRegistryPage");
const AthleteTransportChiefPageScreen = lazyNamed(() => import("./app/athlete-transport-pages"), "AthleteTransportChiefPage");
const AthleteTransportVolunteerPageScreen = lazyNamed(() => import("./app/athlete-transport-pages"), "AthleteTransportVolunteerPage");
const MeetingHistoryPageScreen = lazyNamed(() => import("./app/meeting-history-pages"), "MeetingHistoryPage");
const MeetingRecordsPageScreen = lazyNamed(() => import("./app/meeting-history-pages"), "MeetingRecordsPage");
const MeetingWinnersPageScreen = lazyNamed(() => import("./app/meeting-history-pages"), "MeetingWinnersPage");
const WebsiteDashboardPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsiteDashboardPage");
const WebsiteNewsPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsiteNewsPage");
const WebsiteSponsorsPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsiteSponsorsPage");
const WebsitePressPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsitePressPage");
const WebsiteEditionPageScreen = lazyNamed(() => import("./app/website-admin-pages"), "WebsiteEditionPage");
const WebsiteEmagazinePageScreen = lazyNamed(() => import("./app/website-emagazine-page"), "WebsiteEmagazinePage");
const InvitationAdminPageScreen = lazyNamed(() => import("./app/invitation-admin-page"), "InvitationAdminPage");
const InvitePage = lazyNamed(() => import("./app/invite-page"), "InvitePage");

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

  // Sync transport platform roles based on team assignment
  const rolesToAdd = [
    ...(isTransport ? ["benevole_transport_athletes"] : []),
    ...(isTransportChief ? ["chef_transport_athletes"] : []),
  ];
  const rolesToRemove = [
    ...(!isTransport ? ["benevole_transport_athletes"] : []),
    ...(!isTransportChief ? ["chef_transport_athletes"] : []),
  ];

  if (rolesToAdd.length) {
    await updateDoc(doc(db, "users", userId), { userTypes: arrayUnion(...rolesToAdd) });
  }
  if (rolesToRemove.length) {
    await updateDoc(doc(db, "users", userId), { userTypes: arrayRemove(...rolesToRemove) });
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

const luxCompetitionClubs = [
  "CAB",
  "CAD",
  "CAPA",
  "CSL",
  "CELTIC",
  "LIAL",
  "CAEG",
  "CAFOLA",
  "CAS",
  "Karibu",
  "Trispeed",
  "RBUAP",
  "CSN Clervaux",
  "Triathlon Luxembourg",
  "Team X3M Snooze",
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

function PressAdminPage() {
  return <PressAdminPageScreen Panel={Panel} loadMailQueueModule={loadMailQueueModule} />;
}

function AthletesListPage() {
  return <AthletesListPageScreen Panel={Panel} />;
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

function WebsiteDashboardPage() {
  return <WebsiteDashboardPageScreen Panel={Panel} />;
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
      addDoc={addDoc}
      deleteDoc={deleteDoc}
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
      syncU14RaceAllocations={syncU14RaceAllocations}
    />
  );
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
          </Route>

          {/* ── Auth & standalone public pages ───────────── */}
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/benevoles" element={<VolunteerAccessPage />} />
          <Route path="/pre-programme" element={<U14AccessPage />} />
          <Route path="/vip" element={<VipAccessPage loadMailQueueModule={loadMailQueueModule} />} />
          <Route path="/vip/orga/:portalId" element={<VipPartnerPortalPage />} />
          <Route path="/presse" element={<PressRegistrationPage loadMailQueueModule={loadMailQueueModule} />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/app" element={<AppShell />}>
              <Route index element={<DashboardHome />} />
              <Route element={<RequireRouteAccess allowedRoles={["admin"]} />}>
                <Route path="roles" element={<RoleManagementPage />} />
                <Route path="edition-meeting" element={<EditionSettingsPage />} />
                <Route path="invitations" element={<InvitationAdminPage />} />
                <Route path="postes" element={<TeamsPage />} />
                <Route path="certificat" element={<CertificateSettingsPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "budget"]} />}>
                <Route path="budget" element={<BudgetTrackingPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire"]} />}>
                <Route path="benevoles" element={<VolunteersPage />} />
                <Route path="u14/*" element={<U14Page />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire"]} />}>
                <Route path="accreditations/*" element={<AccreditationsPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire"]} />}>
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="vip" element={<VipPage />} />
                <Route path="presse" element={<PressAdminPage />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire", "chef_equipe"]} />}>
                <Route path="equipe" element={<TeamPage />} />
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
              <Route path="profil" element={<ProfilePage />} />
              <Route path="athlete-portal">
                <Route index element={<Navigate replace to="athletes" />} />
                <Route path="athletes" element={<AthletesListPage />} />
                <Route element={<RequireRouteAccess allowedRoles={["admin"]} />}>
                  <Route path="settings" element={<AthletePortalSettingsPage />} />
                </Route>
                <Route element={<RequireRouteAccess allowedRoles={["admin", "chef_transport_athletes"]} />}>
                  <Route path="transport" element={<AthleteTransportChiefPage />} />
                </Route>
                <Route element={<RequireRouteAccess allowedRoles={["benevole_transport_athletes"]} />}>
                  <Route path="mes-transport" element={<AthleteTransportVolunteerPage />} />
                </Route>
                <Route path="registry" element={<Navigate replace to="/app/statistics/registry" />} />
                <Route path="history" element={<Navigate replace to="/app/statistics/results" />} />
                <Route path="records" element={<Navigate replace to="/app/statistics/records" />} />
                <Route path="winners" element={<Navigate replace to="/app/statistics/winners" />} />
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "meeting_director"]} />}>
                <Route path="statistics">
                  <Route index element={<Navigate replace to="results" />} />
                  <Route path="registry" element={<AthleteRegistryPage />} />
                  <Route path="results" element={<MeetingHistoryPage />} />
                  <Route path="records" element={<MeetingRecordsPage />} />
                  <Route path="winners" element={<MeetingWinnersPage />} />
                </Route>
              </Route>
              <Route element={<RequireRouteAccess allowedRoles={["admin", "gestionnaire", "gestionnaire_site"]} />}>
                <Route path="website">
                <Route index element={<WebsiteDashboardPage />} />
                <Route path="edition" element={<WebsiteEditionPage />} />
                <Route path="emagazine" element={<WebsiteEmagazinePage />} />
                <Route path="news" element={<WebsiteNewsPage />} />
                  <Route path="sponsors" element={<WebsiteSponsorsPage />} />
                  <Route path="press" element={<WebsitePressPage />} />
                </Route>
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
