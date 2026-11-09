import { useEffect, useMemo, useState } from "react";
import { collection, collectionGroup, doc, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase";
import { recordMatchesEdition } from "./edition";

// Inscriptions VIP de l'édition, toutes sources confondues (formulaire public,
// portails partenaires, saisies admin). Utilisé par la file d'impression des
// accréditations ; la page VIP garde son propre chargement.

function mapRegistration(snapshot, sourceCollection, sourceType) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    sourceCollection,
    sourceType: sourceType || data.source || "admin_manual",
    portalId: sourceCollection === "vipPartnerPortals" ? snapshot.ref.path.split("/")[1] || "" : "",
    ...data,
  };
}

function getVipRegistrationDocRef(registration) {
  if (registration.sourceCollection === "vipPublicRegistrations") {
    return doc(db, "vipPublicRegistrations", registration.id);
  }
  if (registration.sourceCollection === "vipPartnerPortals") {
    return doc(db, "vipPartnerPortals", registration.portalId, "entries", registration.id);
  }
  return doc(db, "vipAdminRegistrations", registration.id);
}

function useVipRegistrations(activeEditionId, enabled = true) {
  const [bySource, setBySource] = useState({ public: [], partner: [], admin: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;

    const sources = [
      {
        key: "public",
        ref: collection(db, "vipPublicRegistrations"),
        map: (entry) => mapRegistration(entry, "vipPublicRegistrations", "public_form"),
      },
      {
        key: "partner",
        ref: collectionGroup(db, "entries"),
        keep: (entry) => entry.ref.path.startsWith("vipPartnerPortals/"),
        map: (entry) => mapRegistration(entry, "vipPartnerPortals", "partner_portal"),
      },
      {
        key: "admin",
        ref: collection(db, "vipAdminRegistrations"),
        map: (entry) => mapRegistration(entry, "vipAdminRegistrations"),
      },
    ];

    const unsubscribers = sources.map((source) =>
      onSnapshot(
        source.ref,
        (snapshot) => {
          const rows = snapshot.docs
            .filter((entry) => (source.keep ? source.keep(entry) : true))
            .map(source.map)
            .filter((entry) => recordMatchesEdition(entry, activeEditionId));
          setBySource((current) => ({ ...current, [source.key]: rows }));
        },
        (snapshotError) => {
          console.error(`Unable to load VIP registrations (${source.key})`, snapshotError);
          setBySource((current) => ({ ...current, [source.key]: [] }));
          setError("Impossible de charger les inscriptions VIP.");
        },
      ),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeEditionId, enabled]);

  const registrations = useMemo(
    () => [...bySource.public, ...bySource.partner, ...bySource.admin],
    [bySource],
  );

  return { registrations, error };
}

export { getVipRegistrationDocRef, useVipRegistrations };
