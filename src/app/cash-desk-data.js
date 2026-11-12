import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { recordMatchesEdition } from "./edition";
import { buildDoorEntries } from "./cash-desk-helpers";

// Données de l'entrée, chargées en direct, identiques pour l'admin
// (/app/caisse) et les postes (/caisse) : listes, invités, check-ins, VIP
// (3 sources) et athlètes retenus des courses nationales.

function mapSnapshot(snapshot) {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function useDoorData({ editionId, enabled = true }) {
  const [guestLists, setGuestLists] = useState([]);
  const [guests, setGuests] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [nationalRaceAthletes, setNationalRaceAthletes] = useState([]);
  const [vipAdmin, setVipAdmin] = useState([]);
  const [vipPublic, setVipPublic] = useState([]);
  const [vipPortals, setVipPortals] = useState([]);
  const [vipPortalEntries, setVipPortalEntries] = useState({});
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || !editionId) return undefined;
    setError("");

    const fail = (label) => (snapshotError) => {
      console.error(`Door data: unable to load ${label}`, snapshotError);
      setError(label);
    };
    const byEdition = (name) => query(collection(db, name), where("editionId", "==", editionId));
    const forEdition = (snapshot) => mapSnapshot(snapshot).filter((record) => recordMatchesEdition(record, editionId));

    const unsubscribers = [
      onSnapshot(byEdition("doorGuestLists"), (snapshot) => setGuestLists(mapSnapshot(snapshot)), fail("doorGuestLists")),
      onSnapshot(byEdition("doorGuests"), (snapshot) => setGuests(mapSnapshot(snapshot)), fail("doorGuests")),
      onSnapshot(
        byEdition("doorCheckIns"),
        (snapshot) => {
          setCheckIns(mapSnapshot(snapshot));
          setLoaded(true);
        },
        fail("doorCheckIns"),
      ),
      // Seules les demandes retenues sont lisibles par un poste de caisse
      // (firestore.rules) : la requête doit filtrer sur status.
      onSnapshot(
        query(collection(db, "nationalRaceRequests"), where("editionId", "==", editionId), where("status", "==", "selected")),
        (snapshot) => setNationalRaceAthletes(mapSnapshot(snapshot)),
        fail("nationalRaceRequests"),
      ),
      onSnapshot(collection(db, "vipAdminRegistrations"), (snapshot) => setVipAdmin(forEdition(snapshot)), fail("vipAdminRegistrations")),
      onSnapshot(collection(db, "vipPublicRegistrations"), (snapshot) => setVipPublic(forEdition(snapshot)), fail("vipPublicRegistrations")),
      onSnapshot(collection(db, "vipPartnerPortals"), (snapshot) => setVipPortals(snapshot.docs.map((entry) => entry.id)), fail("vipPartnerPortals")),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [editionId, enabled]);

  const vipPortalKey = vipPortals.join("|");
  useEffect(() => {
    if (!enabled || !vipPortals.length) {
      setVipPortalEntries({});
      return undefined;
    }
    const unsubscribers = vipPortals.map((portalId) =>
      onSnapshot(
        collection(db, "vipPartnerPortals", portalId, "entries"),
        (snapshot) => {
          const entries = mapSnapshot(snapshot)
            .map((entry) => ({ ...entry, portalId }))
            .filter((entry) => recordMatchesEdition(entry, editionId));
          setVipPortalEntries((current) => ({ ...current, [portalId]: entries }));
        },
        (snapshotError) => console.error(`Door data: unable to load VIP portal ${portalId}`, snapshotError),
      ),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    // vipPortalKey suit la liste des portails sans recréer les écouteurs à chaque snapshot identique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vipPortalKey, editionId, enabled]);

  const entries = useMemo(
    () =>
      buildDoorEntries({
        editionId,
        vipAdminRegistrations: vipAdmin,
        vipPublicRegistrations: vipPublic,
        vipPortalEntries: Object.values(vipPortalEntries).flat(),
        guestLists,
        guests,
        nationalRaceAthletes,
        checkIns,
      }),
    [editionId, checkIns, guestLists, guests, nationalRaceAthletes, vipAdmin, vipPortalEntries, vipPublic],
  );

  return { entries, guestLists, guests, checkIns, error, loaded };
}

export { mapSnapshot, useDoorData };
