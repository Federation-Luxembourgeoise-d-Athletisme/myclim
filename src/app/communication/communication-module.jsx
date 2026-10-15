// Module Communication : une seule entrée dans le menu (/app/communication),
// navigation interne et sous-pages ici (comme dans myFLA).
import { Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
import { useTasks } from "./com-data.js";
import { ComCalendarPage } from "./com-calendar-page.jsx";
import { ComEventsPage } from "./com-events-page.jsx";
import { ComPartnerDetailPage, ComPartnersPage } from "./com-partners-pages.jsx";
import { ComPublicationPage } from "./com-publication-page.jsx";
import { ComRubriquesPage } from "./com-rubriques-page.jsx";
import { ComTasksPage } from "./com-tasks-page.jsx";
import { ComNav } from "./com-ui.jsx";
import "./communication.css";

export function CommunicationModule() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const tasks = useTasks();
  const location = useLocation();
  const openTasks = tasks.filter((t) => t.assigneUid === uid && t.statut !== "done").length;
  // La page d'une publication prend toute la largeur (elle a son propre mini-calendrier).
  const fullWidth = location.pathname.includes("/communication/publication/");

  return (
    <div className={`com-module ${fullWidth ? "is-full" : ""}`}>
      {fullWidth ? null : <ComNav openTasks={openTasks} />}
      <div className="com-main">
        <Routes>
          <Route index element={<ComCalendarPage />} />
          <Route path="publication/:id" element={<ComPublicationPage />} />
          <Route path="taches" element={<ComTasksPage />} />
          <Route path="evenements" element={<ComEventsPage />} />
          <Route path="rubriques" element={<ComRubriquesPage />} />
          <Route path="partenaires" element={<ComPartnersPage />} />
          <Route path="partenaires/:id" element={<ComPartnerDetailPage />} />
          <Route path="*" element={<ComCalendarPage />} />
        </Routes>
      </div>
    </div>
  );
}
