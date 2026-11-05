// Module Communication : trois entrées du menu, chacune avec son adresse.
//  - Calendrier (/app/calendrier) : calendrier éditorial, publications,
//    événements, rubriques récurrentes, galerie et import ;
//  - Tâches (/app/taches) ;
//  - Partenaires › Contreparties (/app/partenaires/contreparties).
import { Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
import { useTasks } from "./com-data.js";
import { ComCalendarPage } from "./com-calendar-page.jsx";
import { ComEventsPage } from "./com-events-page.jsx";
import { ComGalleryPage } from "./com-gallery-page.jsx";
import { ComImportPage } from "./com-import-page.jsx";
import { ComPartnerDetailPage, ComPartnersPage } from "./com-partners-pages.jsx";
import { ComPublicationPage } from "./com-publication-page.jsx";
import { ComRubriquesPage } from "./com-rubriques-page.jsx";
import { ComTasksPage } from "./com-tasks-page.jsx";
import { ComNav } from "./com-ui.jsx";
import "./communication.css";

function CalendarRoutes() {
  return (
    <Routes>
      <Route index element={<ComCalendarPage />} />
      <Route path="publication/:id" element={<ComPublicationPage />} />
      <Route path="evenements" element={<ComEventsPage />} />
      <Route path="rubriques" element={<ComRubriquesPage />} />
      <Route path="galerie" element={<ComGalleryPage />} />
      <Route path="import" element={<ComImportPage />} />
      <Route path="*" element={<ComCalendarPage />} />
    </Routes>
  );
}

function PartnersRoutes() {
  return (
    <Routes>
      <Route index element={<ComPartnersPage />} />
      <Route path=":id" element={<ComPartnerDetailPage />} />
    </Routes>
  );
}

export function CommunicationModule({ area = "calendar" }) {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const tasks = useTasks();
  const location = useLocation();
  const openTasks = tasks.filter((t) => t.assigneUid === uid && t.statut !== "done").length;
  // La page d'une publication prend toute la largeur (elle a son propre mini-calendrier).
  const fullWidth = location.pathname.includes("/calendrier/publication/");

  return (
    <div className={`com-module ${fullWidth ? "is-full" : ""}`}>
      {fullWidth ? null : <ComNav openTasks={openTasks} />}
      <div className="com-main">
        {area === "tasks" ? <ComTasksPage /> : area === "partners" ? <PartnersRoutes /> : <CalendarRoutes />}
      </div>
    </div>
  );
}
