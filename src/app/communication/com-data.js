// Module Communication : lectures Firestore (porté de myFLA, lib/communication/data.ts).
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useSponsorCategories, useSponsors } from "../../site/site-hooks";
import { sponsorCategoryLabel } from "../../site/sponsor-utils";
import { COM_COLLECTIONS, COMMUNICATION_ROLES, normalizePublication } from "./com-domain.js";
import { buildComPartner, normalizeObligation } from "./com-partners.js";

const mapDocs = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));

export function memberName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Membre";
}

// Comptes ayant accès au module (listes « Assigné à », responsables, validateurs).
export function useCommunicationTeam() {
  const [team, setTeam] = useState([]);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "users"), where("userTypes", "array-contains-any", COMMUNICATION_ROLES)),
        (snapshot) => {
          const list = mapDocs(snapshot)
            .map((user) => ({ ...user, uid: user.uid || user.id }))
            .filter((user) => user.accountStatus !== "disabled");
          setTeam(list.sort((a, b) => memberName(a).localeCompare(memberName(b), "fr")));
        },
        (error) => console.error("Communication team load failed", error),
      ),
    [],
  );
  return team;
}

export function useRubriques() {
  const [state, setState] = useState({ rubriques: [], loading: true });
  useEffect(
    () =>
      onSnapshot(collection(db, COM_COLLECTIONS.rubriques), (snapshot) => {
        const rubriques = mapDocs(snapshot).map((r) => ({ history: [], canaux: [], active: true, ...r }));
        setState({ rubriques: rubriques.sort((a, b) => String(a.titre).localeCompare(String(b.titre), "fr")), loading: false });
      }),
    [],
  );
  return state;
}

// Publications visibles sur une période : par date affichée, et par date d'origine
// (une occurrence déplacée hors de la période doit quand même masquer sa place d'origine).
export function usePublications(start, end) {
  const [byDate, setByDate] = useState([]);
  const [byOccurrence, setByOccurrence] = useState([]);

  useEffect(() => {
    const ref = collection(db, COM_COLLECTIONS.publications);
    const unsubDate = onSnapshot(query(ref, where("date", ">=", start), where("date", "<=", end)), (s) => setByDate(mapDocs(s)));
    const unsubOcc = onSnapshot(query(ref, where("occurrenceDate", ">=", start), where("occurrenceDate", "<=", end)), (s) =>
      setByOccurrence(mapDocs(s)),
    );
    return () => {
      unsubDate();
      unsubOcc();
    };
  }, [start, end]);

  const merged = new Map();
  [...byDate, ...byOccurrence].forEach((p) => merged.set(p.id, p));
  return [...merged.values()];
}

export function useEvenements() {
  const [events, setEvents] = useState([]);
  useEffect(
    () =>
      onSnapshot(collection(db, COM_COLLECTIONS.events), (snapshot) => {
        setEvents(mapDocs(snapshot).sort((a, b) => String(a.dateDebut).localeCompare(String(b.dateDebut))));
      }),
    [],
  );
  return events;
}

export function useTasks() {
  const [tasks, setTasks] = useState([]);
  useEffect(
    () =>
      onSnapshot(collection(db, COM_COLLECTIONS.tasks), (snapshot) => {
        setTasks(mapDocs(snapshot).sort((a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999")));
      }),
    [],
  );
  return tasks;
}

// Publications rattachées à un événement, toutes dates confondues.
export function useEventPublications() {
  const [pubs, setPubs] = useState([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, COM_COLLECTIONS.publications), where("eventId", "!=", null)), (snapshot) =>
        setPubs(mapDocs(snapshot).filter((p) => !p.annulee).map(normalizePublication)),
      ),
    [],
  );
  return pubs;
}

// Publications dont la validation est demandée à cet utilisateur et toujours en attente.
export function usePendingValidations(uid) {
  const [state, setState] = useState({ uid: "", list: [] });
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(query(collection(db, COM_COLLECTIONS.publications), where("validation.demandeeA", "array-contains", uid)), (snapshot) =>
      setState({
        uid,
        list: mapDocs(snapshot)
          .filter((p) => !p.annulee && p.validation?.etat === "demandee")
          .map(normalizePublication)
          .sort((a, b) => a.date.localeCompare(b.date)),
      }),
    );
  }, [uid]);
  return state.uid === uid ? state.list : [];
}

// Une publication enregistrée, sous la forme utilisée par le calendrier.
export function usePublicationItem(id) {
  const [state, setState] = useState({ item: null, loading: true, forId: "" });
  useEffect(() => {
    if (!id) return undefined;
    return onSnapshot(doc(db, COM_COLLECTIONS.publications, id), (snapshot) => {
      setState({
        loading: false,
        forId: id,
        item: snapshot.exists() ? { ...normalizePublication({ ...snapshot.data(), id: snapshot.id }), materialized: true } : null,
      });
    });
  }, [id]);
  return state.forId === id ? state : { item: null, loading: true };
}

/* ---------- Partenaires ---------- */

// Partenaires du module = sponsors du site (actifs ou non) + infos privées.
export function useComPartners() {
  const { sponsors, loading: sponsorsLoading } = useSponsors(false);
  const { categories } = useSponsorCategories();
  const [details, setDetails] = useState({ map: new Map(), loading: true });

  useEffect(
    () =>
      onSnapshot(
        collection(db, COM_COLLECTIONS.partnerDetails),
        (snapshot) => setDetails({ map: new Map(snapshot.docs.map((entry) => [entry.id, entry.data()])), loading: false }),
        (error) => {
          console.error("Partner details load failed", error);
          setDetails({ map: new Map(), loading: false });
        },
      ),
    [],
  );

  const partners = sponsors
    .map((sponsor) => buildComPartner(sponsor, details.map.get(sponsor.id), sponsorCategoryLabel(sponsor.category, categories)))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  return { partners, loading: sponsorsLoading || details.loading };
}

export function useObligations() {
  const [obligations, setObligations] = useState([]);
  useEffect(
    () => onSnapshot(collection(db, COM_COLLECTIONS.obligations), (snapshot) => setObligations(mapDocs(snapshot).map(normalizeObligation))),
    [],
  );
  return obligations;
}

// Publications qui mentionnent au moins un des partenaires (Firestore : 30 valeurs maximum par requête).
export function usePartnerPublications(partnerIds) {
  const [pubs, setPubs] = useState([]);
  const key = [...partnerIds].sort().join(",");
  useEffect(() => {
    const ids = key ? key.split(",").slice(0, 30) : [];
    if (!ids.length) return undefined;
    return onSnapshot(query(collection(db, COM_COLLECTIONS.publications), where("partnerIds", "array-contains-any", ids)), (snapshot) =>
      setPubs(mapDocs(snapshot).map(normalizePublication)),
    );
  }, [key]);
  return key ? pubs : [];
}

// Occurrences personnalisées des rubriques suivies par des contreparties.
export function useRubriquePublications(rubriqueIds) {
  const [pubs, setPubs] = useState([]);
  const key = [...new Set(rubriqueIds)].sort().join(",");
  useEffect(() => {
    const ids = key ? key.split(",").slice(0, 30) : [];
    if (!ids.length) return undefined;
    return onSnapshot(query(collection(db, COM_COLLECTIONS.publications), where("rubriqueId", "in", ids)), (snapshot) =>
      setPubs(mapDocs(snapshot).map(normalizePublication)),
    );
  }, [key]);
  return key ? pubs : [];
}
