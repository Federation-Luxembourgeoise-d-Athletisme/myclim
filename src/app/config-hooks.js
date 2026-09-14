import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import {
  ACCREDITATION_CONFIGURATION_DOC_PATH,
  BUDGET_INVOICE_CONFIGURATION_DOC_PATH,
  CERTIFICATE_CONFIGURATION_DOC_PATH,
  JUDGE_ROSTER_DOC_PATH,
  TEAM_CONFIGURATION_DOC_PATH,
} from "./seed-data";
import { normalizeAccreditationConfigurationPayload } from "./accreditation-config";
import { normalizeBudgetInvoiceConfigurationPayload } from "./budget-invoice-config";
import { normalizeCertificateConfigurationPayload } from "./certificate-config";
import { defaultTeamRoles, normalizeTeamConfigurationPayload } from "./team-config";
import { db } from "../services/firebase";

function useTeamConfiguration() {
  const [configuration, setConfiguration] = useState(() => normalizeTeamConfigurationPayload({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const teamsConfigurationRef = doc(db, ...TEAM_CONFIGURATION_DOC_PATH);

    const unsubscribe = onSnapshot(
      teamsConfigurationRef,
      (snapshot) => {
        setConfiguration(snapshot.exists() ? normalizeTeamConfigurationPayload(snapshot.data()) : normalizeTeamConfigurationPayload({}));
        setLoading(false);
        setError("");
      },
      () => {
        setConfiguration(normalizeTeamConfigurationPayload({}));
        setLoading(false);
        setError("Impossible de synchroniser la composition des équipes pour le moment.");
      },
    );

    return unsubscribe;
  }, []);

  return {
    ...configuration,
    loading,
    error,
  };
}

function useAccreditationConfiguration(roles = defaultTeamRoles) {
  const roleSignature = useMemo(
    () => roles.map((role) => `${role.id}:${role.roleName}`).join("|"),
    [roles],
  );
  const [configuration, setConfiguration] = useState(() =>
    normalizeAccreditationConfigurationPayload({}, roles),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const accreditationConfigurationRef = doc(db, ...ACCREDITATION_CONFIGURATION_DOC_PATH);

    const unsubscribe = onSnapshot(
      accreditationConfigurationRef,
      (snapshot) => {
        setConfiguration(
          normalizeAccreditationConfigurationPayload(snapshot.exists() ? snapshot.data() : {}, roles),
        );
        setLoading(false);
        setError("");
      },
      () => {
        setConfiguration(normalizeAccreditationConfigurationPayload({}, roles));
        setLoading(false);
        setError("Impossible de synchroniser la configuration des accréditations pour le moment.");
      },
    );

    return unsubscribe;
  }, [roleSignature, roles]);

  return {
    ...configuration,
    loading,
    error,
  };
}

function useJudgeRoster() {
  const [configuration, setConfiguration] = useState(() => ({ judges: [] }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const defaultJudgeZoneIds = ["zone-judges", "zone-infield"];

  useEffect(() => {
    const judgeRosterRef = doc(db, ...JUDGE_ROSTER_DOC_PATH);

    const unsubscribe = onSnapshot(
      judgeRosterRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        const judges = Array.isArray(data?.judges)
          ? data.judges
              .map((judge, index) => ({
                id: String(judge?.id || `judge-${index + 1}`),
                firstName: String(judge?.firstName || "").trim(),
                lastName: String(judge?.lastName || "").trim(),
                badgeLabel: String(judge?.badgeLabel || "Judge").trim(),
                assignedZones:
                  Array.isArray(judge?.assignedZones) && judge.assignedZones.length > 0
                    ? judge.assignedZones.map((zone) => String(zone || "").trim()).filter(Boolean)
                    : defaultJudgeZoneIds,
                printStatus: String(judge?.printStatus || "Non-imprimé").trim(),
                lastPrintedAt: judge?.lastPrintedAt || null,
                destroyedAt: judge?.destroyedAt || null,
                createdBy: String(judge?.createdBy || "").trim(),
              }))
              .sort((left, right) =>
                `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`, "fr", {
                  sensitivity: "base",
                }),
              )
          : [];

        setConfiguration({ judges });
        setLoading(false);
        setError("");
      },
      () => {
        setConfiguration({ judges: [] });
        setLoading(false);
        setError("Impossible de synchroniser la liste des juges pour le moment.");
      },
    );

    return unsubscribe;
  }, []);

  return {
    ...configuration,
    loading,
    error,
  };
}

function useBudgetInvoiceConfiguration() {
  const [configuration, setConfiguration] = useState(() => normalizeBudgetInvoiceConfigurationPayload({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const configurationRef = doc(db, ...BUDGET_INVOICE_CONFIGURATION_DOC_PATH);

    const unsubscribe = onSnapshot(
      configurationRef,
      (snapshot) => {
        setConfiguration(
          normalizeBudgetInvoiceConfigurationPayload(snapshot.exists() ? snapshot.data() : {}),
        );
        setLoading(false);
        setError("");
      },
      () => {
        setConfiguration(normalizeBudgetInvoiceConfigurationPayload({}));
        setLoading(false);
        setError("Impossible de synchroniser la configuration des factures pour le moment.");
      },
    );

    return unsubscribe;
  }, []);

  return {
    ...configuration,
    loading,
    error,
  };
}

function useCertificateConfiguration() {
  const [configuration, setConfiguration] = useState(() => normalizeCertificateConfigurationPayload({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const configurationRef = doc(db, ...CERTIFICATE_CONFIGURATION_DOC_PATH);

    const unsubscribe = onSnapshot(
      configurationRef,
      (snapshot) => {
        setConfiguration(normalizeCertificateConfigurationPayload(snapshot.exists() ? snapshot.data() : {}));
        setLoading(false);
        setError("");
      },
      () => {
        setConfiguration(normalizeCertificateConfigurationPayload({}));
        setLoading(false);
        setError("Impossible de synchroniser la configuration du certificat pour le moment.");
      },
    );

    return unsubscribe;
  }, []);

  return {
    ...configuration,
    loading,
    error,
  };
}

export {
  useAccreditationConfiguration,
  useBudgetInvoiceConfiguration,
  useCertificateConfiguration,
  useJudgeRoster,
  useTeamConfiguration,
};
