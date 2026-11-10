import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";

const DEFAULT_ACTIVE_EDITION = "test";
// Display name of the "test" edition (its id stays "test", so no data moves).
const TEST_EDITION_LABEL = "Exemple 2026";
const ACTIVE_EDITION_DOC_PATH = ["appSettings", "platform"];
const DEFAULT_SITE_EDITION_YEAR = null;
const DEFAULT_PREPROGRAM_OPENING_BY_EDITION = {
  "2027": "2026-11-16T12:30:00+01:00",
};

function normalizeEditionId(value) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  return normalizedValue || DEFAULT_ACTIVE_EDITION;
}

function getRecordEditionId(record) {
  return normalizeEditionId(record?.editionId || DEFAULT_ACTIVE_EDITION);
}

function recordMatchesEdition(record, editionId) {
  return getRecordEditionId(record) === normalizeEditionId(editionId);
}

function getEditionLabel(editionId) {
  const normalizedEditionId = normalizeEditionId(editionId);
  return normalizedEditionId === "test" ? TEST_EDITION_LABEL : `édition ${normalizedEditionId}`;
}

function normalizePreprogramOpeningByEdition(value) {
  const source = {
    ...DEFAULT_PREPROGRAM_OPENING_BY_EDITION,
    ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
  };

  return Object.entries(source).reduce((accumulator, [editionId, openingAt]) => {
    const normalizedEditionId = normalizeEditionId(editionId);
    const normalizedOpeningAt = String(openingAt || "").trim();
    if (!normalizedOpeningAt) return accumulator;
    accumulator[normalizedEditionId] = normalizedOpeningAt;
    return accumulator;
  }, {});
}

function getPreprogramOpeningDate(editionId, preprogramOpeningByEdition = DEFAULT_PREPROGRAM_OPENING_BY_EDITION) {
  const normalizedEditionId = normalizeEditionId(editionId);
  const configuredOpeningDate = normalizePreprogramOpeningByEdition(preprogramOpeningByEdition)[normalizedEditionId];
  return configuredOpeningDate ? new Date(configuredOpeningDate) : null;
}

function normalizeSiteEditionYear(value) {
  if (value == null || value === "") return null;
  const numericYear = Number(value);
  if (!Number.isFinite(numericYear)) return null;
  return numericYear;
}

function isPreprogramOpenForEdition(
  editionId,
  now = Date.now(),
  hostname = "",
  preprogramOpeningByEdition = DEFAULT_PREPROGRAM_OPENING_BY_EDITION,
) {
  const normalizedEditionId = normalizeEditionId(editionId);
  if (normalizedEditionId === "test") return true;
  if (hostname === "localhost") return true;

  const openingDate = getPreprogramOpeningDate(normalizedEditionId, preprogramOpeningByEdition);
  if (!openingDate) return true;

  return now >= openingDate.getTime();
}

async function getActiveEditionId() {
  const snapshot = await getDoc(doc(db, ...ACTIVE_EDITION_DOC_PATH));
  return normalizeEditionId(snapshot.exists() ? snapshot.data()?.activeEdition : DEFAULT_ACTIVE_EDITION);
}

async function setActiveEditionId(editionId) {
  const normalizedEditionId = normalizeEditionId(editionId);

  await setDoc(
    doc(db, ...ACTIVE_EDITION_DOC_PATH),
    {
      activeEdition: normalizedEditionId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return normalizedEditionId;
}

async function setSiteEditionYear(siteEditionYear) {
  const normalizedSiteEditionYear = normalizeSiteEditionYear(siteEditionYear);

  await setDoc(
    doc(db, ...ACTIVE_EDITION_DOC_PATH),
    {
      siteEditionYear: normalizedSiteEditionYear,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return normalizedSiteEditionYear;
}

function useActiveEdition(enabled = true) {
  const [activeEditionId, setActiveEditionIdState] = useState(DEFAULT_ACTIVE_EDITION);
  const [preprogramOpeningByEdition, setPreprogramOpeningByEdition] = useState(DEFAULT_PREPROGRAM_OPENING_BY_EDITION);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setActiveEditionIdState(DEFAULT_ACTIVE_EDITION);
      setLoading(false);
      setError("");
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, ...ACTIVE_EDITION_DOC_PATH),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        setActiveEditionIdState(normalizeEditionId(data?.activeEdition || DEFAULT_ACTIVE_EDITION));
        setPreprogramOpeningByEdition(
          normalizePreprogramOpeningByEdition(data?.preprogramOpeningByEdition || DEFAULT_PREPROGRAM_OPENING_BY_EDITION),
        );
        setLoading(false);
        setError("");
      },
      () => {
        setActiveEditionIdState(DEFAULT_ACTIVE_EDITION);
        setPreprogramOpeningByEdition(DEFAULT_PREPROGRAM_OPENING_BY_EDITION);
        setLoading(false);
        setError("Impossible de charger l'édition active.");
      },
    );

    return unsubscribe;
  }, [enabled]);

  return {
    activeEditionId,
    activeEditionLabel: getEditionLabel(activeEditionId),
    preprogramOpeningByEdition,
    preprogramOpeningDate: getPreprogramOpeningDate(activeEditionId, preprogramOpeningByEdition),
    loading,
    error,
  };
}

function useSiteEditionYear(enabled = true) {
  const [siteEditionYear, setSiteEditionYearState] = useState(DEFAULT_SITE_EDITION_YEAR);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setSiteEditionYearState(DEFAULT_SITE_EDITION_YEAR);
      setLoading(false);
      setError("");
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, ...ACTIVE_EDITION_DOC_PATH),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        setSiteEditionYearState(normalizeSiteEditionYear(data?.siteEditionYear));
        setLoading(false);
        setError("");
      },
      () => {
        setSiteEditionYearState(DEFAULT_SITE_EDITION_YEAR);
        setLoading(false);
        setError("Impossible de charger l'édition publique.");
      },
    );

    return unsubscribe;
  }, [enabled]);

  return {
    siteEditionYear,
    loading,
    error,
  };
}

// Noms d'équipes proposés comme préférences dans le formulaire bénévole :
// sans espaces en trop, sans vides ni doublons, dans l'ordre des équipes.
function getVolunteerRoleOptionNames(roles = []) {
  const seen = new Set();
  return roles
    .map((role) => String(role?.roleName || "").trim())
    .filter((name) => {
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function useVolunteerRoleOptions() {
  const [roleOptions, setRoleOptions] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, ...ACTIVE_EDITION_DOC_PATH),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        setRoleOptions(Array.isArray(data?.volunteerRoleOptions) ? data.volunteerRoleOptions : []);
      },
      () => setRoleOptions([]),
    );

    return unsubscribe;
  }, []);

  return roleOptions;
}

export {
  ACTIVE_EDITION_DOC_PATH,
  DEFAULT_ACTIVE_EDITION,
  DEFAULT_PREPROGRAM_OPENING_BY_EDITION,
  DEFAULT_SITE_EDITION_YEAR,
  getActiveEditionId,
  getEditionLabel,
  getPreprogramOpeningDate,
  getRecordEditionId,
  getVolunteerRoleOptionNames,
  isPreprogramOpenForEdition,
  normalizePreprogramOpeningByEdition,
  normalizeEditionId,
  normalizeSiteEditionYear,
  recordMatchesEdition,
  setActiveEditionId,
  setSiteEditionYear,
  useActiveEdition,
  useSiteEditionYear,
  useVolunteerRoleOptions,
};
