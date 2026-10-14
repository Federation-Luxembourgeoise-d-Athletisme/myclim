import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import {
  U14_PRACTICAL_INFO_DOC_PATH,
  U14_RESERVED_SLOTS_COLLECTION,
  formatDateTimeForDisplay,
  getAdminApprovalLabel,
  getU14ParentStatusLabel,
  getU14PracticalRoleKey,
  getU14RaceCode,
} from "./u14-helpers";
import { recordMatchesEdition, useActiveEdition } from "./edition";
import { db } from "../services/firebase";

function normalizeU14PracticalInfoPayload(data) {
  return {
    preprogram: String(data?.preprogram || "").trim(),
    porte_panier: String(data?.porte_panier || "").trim(),
  };
}

function formatU14RequestTypeLabel(requestType) {
  switch (String(requestType || "").trim().toLowerCase()) {
    case "preprogram":
      return "Pré-programme";
    case "porte_panier":
      return "Porte-panier";
    case "preprogram_ou_porte_panier":
      return "Pré-programme ou porte-panier";
    default:
      return "Demande U14";
  }
}

function useU14PracticalInfoConfiguration(enabled = true) {
  const [configuration, setConfiguration] = useState(() => normalizeU14PracticalInfoPayload({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;

    const practicalInfoRef = doc(db, ...U14_PRACTICAL_INFO_DOC_PATH);
    const unsubscribe = onSnapshot(
      practicalInfoRef,
      (snapshot) => {
        setConfiguration(
          snapshot.exists() ? normalizeU14PracticalInfoPayload(snapshot.data()) : normalizeU14PracticalInfoPayload({}),
        );
        setLoading(false);
        setError("");
      },
      () => {
        setConfiguration(normalizeU14PracticalInfoPayload({}));
        setLoading(false);
        setError("Impossible de charger les informations pratiques du pré-programme.");
      },
    );

    return unsubscribe;
  }, [enabled]);

  return enabled
    ? {
        ...configuration,
        loading,
        error,
      }
    : {
        ...normalizeU14PracticalInfoPayload({}),
        loading: false,
        error: "",
      };
}

function useU14RequestsList(enabled = true) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { activeEditionId, loading: editionLoading, error: editionError } = useActiveEdition(enabled);

  useEffect(() => {
    if (!enabled || editionLoading) return undefined;

    setLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, "u14Requests"),
      (snapshot) => {
        setRequests(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter((entry) => recordMatchesEdition(entry, activeEditionId)),
        );
        setLoading(false);
        setError("");
      },
      () => {
        setRequests([]);
        setLoading(false);
        setError("Impossible de charger les demandes U14.");
      },
    );

    return unsubscribe;
  }, [activeEditionId, editionLoading, enabled]);

  return enabled
    ? { requests, loading: loading || editionLoading, error: error || editionError }
    : { requests: [], loading: false, error: "" };
}

function useU14ChildrenList(enabled = true) {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { activeEditionId, loading: editionLoading, error: editionError } = useActiveEdition(enabled);

  useEffect(() => {
    if (!enabled || editionLoading) return undefined;

    setLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, "u14Children"),
      (snapshot) => {
        setChildren(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter((entry) => recordMatchesEdition(entry, activeEditionId)),
        );
        setLoading(false);
        setError("");
      },
      () => {
        setChildren([]);
        setLoading(false);
        setError("Impossible de charger les enfants U14.");
      },
    );

    return unsubscribe;
  }, [activeEditionId, editionLoading, enabled]);

  return enabled
    ? { children, loading: loading || editionLoading, error: error || editionError }
    : { children: [], loading: false, error: "" };
}

function useProtectedU14Entries(enabled = true) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;

    const unsubscribe = onSnapshot(
      collection(db, U14_RESERVED_SLOTS_COLLECTION),
      (snapshot) => {
        setEntries(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setLoading(false);
        setError("");
      },
      () => {
        setEntries([]);
        setLoading(false);
        setError("Impossible de charger les places protégées.");
      },
    );

    return unsubscribe;
  }, [enabled]);

  return enabled ? { entries, loading, error } : { entries: [], loading: false, error: "" };
}

function useParentU14Children(parentUserId) {
  const [children, setChildren] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [error, setError] = useState("");
  const practicalInfoConfiguration = useU14PracticalInfoConfiguration(Boolean(parentUserId));
  const { activeEditionId, loading: editionLoading, error: editionError } = useActiveEdition(Boolean(parentUserId));

  useEffect(() => {
    if (!parentUserId || editionLoading) return undefined;

    setLoadingChildren(true);

    const childrenQuery = query(collection(db, "u14Children"), where("parentUserId", "==", parentUserId));
    const unsubscribe = onSnapshot(
      childrenQuery,
      (snapshot) => {
        setChildren(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter((entry) => recordMatchesEdition(entry, activeEditionId)),
        );
        setLoadingChildren(false);
        setError("");
      },
      () => {
        setChildren([]);
        setLoadingChildren(false);
        setError("Impossible de charger les enfants U14.");
      },
    );

    return unsubscribe;
  }, [activeEditionId, editionLoading, parentUserId]);

  useEffect(() => {
    if (!parentUserId || editionLoading) return undefined;

    setLoadingRequests(true);

    const requestsQuery = query(collection(db, "u14Requests"), where("parentUserId", "==", parentUserId));
    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        setRequests(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter((entry) => recordMatchesEdition(entry, activeEditionId)),
        );
        setLoadingRequests(false);
        setError("");
      },
      () => {
        setRequests([]);
        setLoadingRequests(false);
        setError("Impossible de charger les demandes U14.");
      },
    );

    return unsubscribe;
  }, [activeEditionId, editionLoading, parentUserId]);

  const rows = useMemo(() => {
    const requestsByChildId = requests.reduce((accumulator, request) => {
      const childId = String(request.childId || "").trim();
      if (!childId) return accumulator;
      accumulator.set(childId, request);
      return accumulator;
    }, new Map());

    return children.map((child) => {
      const request = requestsByChildId.get(child.id);
      const childName = [child.firstName, child.lastName].filter(Boolean).join(" ").trim() || "Enfant";
      const practicalInfo =
        request?.requestType === "porte_panier"
          ? "Rôle porte-panier"
          : request?.requestedEvent
            ? `Course ${request.requestedEvent}`
            : "Détails à confirmer";

      return {
        id: child.id,
        requestId: request?.id || "",
        childId: child.id,
        name: childName,
        type: formatU14RequestTypeLabel(request?.requestType),
        status: getU14ParentStatusLabel(request),
        submittedAt: request?.submittedAt ? formatDateTimeForDisplay(request.submittedAt) : "-",
        schedule: practicalInfo,
        requestType: request?.requestType || "",
        requestedEvent: request?.requestedEvent || "",
        raceCode:
          request?.raceCode ||
          getU14RaceCode({
            category: request?.category || child.category,
            gender: request?.gender || child.gender,
            requestedEvent: request?.requestedEvent,
          }),
        acceptedPosition: Number(request?.acceptedPosition || 0) || null,
        waitlistPosition: Number(request?.waitlistPosition || 0) || null,
        queuePosition: Number(request?.queuePosition || 0) || null,
        protectedSlotId: request?.protectedSlotId || "",
        allocationMode: request?.allocationMode || "",
        adminApprovalStatus: request?.adminApprovalStatus || "",
        parentDecisionStatus: request?.parentDecisionStatus || "",
        parentDecisionRequired: Boolean(request?.parentDecisionRequired),
        adminApprovalLabel: getAdminApprovalLabel(request?.adminApprovalStatus),
        practicalInfoText:
          getU14ParentStatusLabel(request) === "Validé"
            ? practicalInfoConfiguration[getU14PracticalRoleKey(request)] || ""
            : "",
      };
    });
  }, [children, practicalInfoConfiguration, requests]);

  return parentUserId
    ? {
        rows,
        loading: loadingChildren || loadingRequests || practicalInfoConfiguration.loading || editionLoading,
        error: error || practicalInfoConfiguration.error || editionError,
      }
    : {
        rows: [],
        loading: false,
        error: "",
      };
}

export {
  useParentU14Children,
  useProtectedU14Entries,
  useU14ChildrenList,
  useU14PracticalInfoConfiguration,
  useU14RequestsList,
};
