const REMEMBER_ME_STORAGE_KEY = "myclim-remember-me";
const DEFAULT_PHONE_COUNTRY_CODE = "+352";
const VOLUNTEER_LANGUAGE_OPTIONS = [
  "Français",
  "Anglais",
  "Allemand",
  "Luxembourgeois",
  "Portugais",
  "Italien",
  "Espagnol",
  "Néerlandais",
  "Autre",
];
const VOLUNTEER_MEETING_DAY_LABEL = "Meeting - dimanche 17/01/2027 9h30-19h00 (obligatoire)";
const VOLUNTEER_LANGUAGE_OPTION_LABELS = {
  fr: {
    Français: "Français",
    Anglais: "Anglais",
    Allemand: "Allemand",
    Luxembourgeois: "Luxembourgeois",
    Portugais: "Portugais",
    Italien: "Italien",
    Espagnol: "Espagnol",
    Néerlandais: "Néerlandais",
    Autre: "Autre",
  },
  en: {
    Français: "French",
    Anglais: "English",
    Allemand: "German",
    Luxembourgeois: "Luxembourgish",
    Portugais: "Portuguese",
    Italien: "Italian",
    Espagnol: "Spanish",
    Néerlandais: "Dutch",
    Autre: "Other",
  },
  de: {
    Français: "Französisch",
    Anglais: "Englisch",
    Allemand: "Deutsch",
    Luxembourgeois: "Luxemburgisch",
    Portugais: "Portugiesisch",
    Italien: "Italienisch",
    Espagnol: "Spanisch",
    Néerlandais: "Niederländisch",
    Autre: "Andere",
  },
};

function getVolunteerLanguageOptionLabel(option, language) {
  return VOLUNTEER_LANGUAGE_OPTION_LABELS[language]?.[option] || option;
}
const PHONE_COUNTRY_OPTIONS = [
  { code: "+352", region: "LU", label: "Luxembourg" },
  { code: "+33", region: "FR", label: "France" },
  { code: "+32", region: "BE", label: "Belgique" },
  { code: "+49", region: "DE", label: "Allemagne" },
  { code: "+41", region: "CH", label: "Suisse" },
  { code: "+351", region: "PT", label: "Portugal" },
  { code: "+34", region: "ES", label: "Espagne" },
  { code: "+39", region: "IT", label: "Italie" },
  { code: "+31", region: "NL", label: "Pays-Bas" },
  { code: "+44", region: "GB", label: "Royaume-Uni" },
];

function parsePhoneValue(value) {
  const normalizedValue = String(value || "").trim();
  const sortedOptions = [...PHONE_COUNTRY_OPTIONS].sort((left, right) => right.code.length - left.code.length);

  const matchingOption = sortedOptions.find(
    (option) => normalizedValue === option.code || normalizedValue.startsWith(`${option.code} `),
  );

  if (matchingOption) {
    return {
      countryCode: matchingOption.code,
      localNumber: normalizedValue.slice(matchingOption.code.length).trim(),
    };
  }

  if (normalizedValue.startsWith("+")) {
    const [rawCountryCode, ...localNumberParts] = normalizedValue.split(/\s+/);
    return {
      countryCode: rawCountryCode,
      localNumber: localNumberParts.join(" "),
    };
  }

  return {
    countryCode: DEFAULT_PHONE_COUNTRY_CODE,
    localNumber: normalizedValue,
  };
}

function buildPhoneValue(countryCode, localNumber) {
  const normalizedLocalNumber = String(localNumber || "").trim();
  return normalizedLocalNumber ? `${countryCode} ${normalizedLocalNumber}` : "";
}

function readRememberMePreference() {
  if (typeof window === "undefined") {
    return true;
  }

  const storedValue = window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY);
  return storedValue === null ? true : storedValue === "true";
}

function getAgeFromBirthDate(dateString) {
  if (!dateString) return null;

  const today = new Date();
  const birthDate = new Date(dateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return Number.isNaN(age) ? null : age;
}

function getU14CategoryFromBirthDate(dateString) {
  if (!dateString) return "";

  const birthDate = new Date(dateString);
  const year = birthDate.getFullYear();

  if (Number.isNaN(year)) return "";
  if (year === 2016 || year === 2017) return "U12";
  if (year === 2014 || year === 2015) return "U14";

  return "";
}

function getBirthYear(dateString) {
  if (!dateString) return "";

  const birthDate = new Date(dateString);
  const year = birthDate.getFullYear();

  return Number.isNaN(year) ? "" : String(year);
}

function getDisplayName(profile, fallbackEmail) {
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  return fullName || fallbackEmail || "Utilisateur";
}

function listToCommaSeparatedText(value) {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function commaSeparatedTextToList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAgeBracketFromAge(age) {
  if (age === null) return "";
  if (age < 14) return "u14";
  if (age < 16) return "u16";
  if (age < 18) return "u18";
  return "18+";
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeSearchValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function buildSearchPrefixes(value) {
  const normalizedValue = normalizeSearchValue(value);
  if (!normalizedValue) return [];

  const collapsedValue = normalizedValue.replace(/\s+/g, " ");
  const tokens = collapsedValue
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
  const prefixes = new Set();

  for (const token of tokens) {
    for (let index = 2; index <= Math.min(token.length, 10); index += 1) {
      prefixes.add(token.slice(0, index));
    }
  }

  if (collapsedValue.length >= 2) {
    prefixes.add(collapsedValue);
  }

  return [...prefixes];
}

function buildUserSearchTokens(profile = {}) {
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

  return [
    ...new Set(
      [profile.firstName, profile.lastName, profile.email, fullName]
        .flatMap((value) => buildSearchPrefixes(value))
        .filter(Boolean),
    ),
  ];
}

function extractRolesFromProfile(profile = {}) {
  const collectedRoles = [
    ...(Array.isArray(profile.userTypes) ? profile.userTypes : []),
    ...(Array.isArray(profile.roles) ? profile.roles : []),
    profile.userType,
    profile.role,
    profile.isAdmin ? "admin" : "",
    profile.isManager ? "gestionnaire" : "",
    profile.isTeamLead ? "chef_equipe" : "",
    profile.isParentU14 ? "parent_u14" : "",
    profile.isVolunteer ? "benevole" : "",
  ]
    .map(normalizeRole)
    .filter(Boolean);

  return [...new Set(collectedRoles)];
}

export {
  PHONE_COUNTRY_OPTIONS,
  VOLUNTEER_LANGUAGE_OPTIONS,
  VOLUNTEER_MEETING_DAY_LABEL,
  getVolunteerLanguageOptionLabel,
  buildPhoneValue,
  buildSearchPrefixes,
  buildUserSearchTokens,
  commaSeparatedTextToList,
  extractRolesFromProfile,
  getAgeBracketFromAge,
  getAgeFromBirthDate,
  getBirthYear,
  getDisplayName,
  getU14CategoryFromBirthDate,
  listToCommaSeparatedText,
  normalizeRole,
  normalizeSearchValue,
  parsePhoneValue,
  readRememberMePreference,
};
