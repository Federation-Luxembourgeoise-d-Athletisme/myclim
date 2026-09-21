import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getActiveRoles } from "./navigation";
import { FileUpload } from "./file-upload";
import {
  ACCREDITATION_CONFIGURATION_DOC_PATH,
  BUDGET_INVOICE_CONFIGURATION_DOC_PATH,
  CERTIFICATE_CONFIGURATION_DOC_PATH,
  TEAM_CONFIGURATION_DOC_PATH,
  defaultTeamRoleOptions,
  platformRoleOptions,
  supportTaskDayOptions,
  supportTaskOptions,
} from "./seed-data";
import {
  buildAccreditationUsers,
} from "./accreditation-helpers";
import {
  buildParticipationCertificateMarkup,
  formatTimeForDisplay,
  getPresenceStatusClass,
  getPresenceStatusLabel,
  getRoundedParticipationHours,
  isPresenceLocked,
  normalizePresenceRecord,
} from "./presence-helpers";
import { getRoleLabel, mapVolunteerApplicationToAdminVolunteer } from "./volunteer-helpers";
import { useVolunteerApplicationsList } from "./volunteer-hooks";
import {
  defaultTeamAssignments,
  defaultTeamRoles,
  getAvailableTeamRoles,
  getVolunteerStableId,
  isLegacySeedAssignment,
  normalizeSubRoles,
  normalizeTeamConfigurationPayload,
} from "./team-config";
import {
  useAccreditationConfiguration,
  useBudgetInvoiceConfiguration,
  useCertificateConfiguration,
  useTeamConfiguration,
} from "./config-hooks";
import { buildUserIdentitySet, formatVolunteerApplicationStatus, getWorkflowStatusClass, isTeamLeadAssignment } from "./common-helpers";
import { normalizeComparableValue } from "./u14-helpers";
import { useActiveEdition } from "./edition";
import {
  buildSearchPrefixes,
  buildUserSearchTokens,
  extractRolesFromProfile,
  getDisplayName,
  normalizeSearchValue,
} from "./utils";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";

const DEFAULT_LIST_PAGE_SIZE = 10;

const ROLE_ACCESS_DESCRIPTIONS = {
  admin: "Accès complet à toute l'application, y compris cette page de gestion des rôles et les réglages sensibles. Seul un admin peut changer les rôles d'un autre compte.",
  budget: "Accès au module Budget (page dédiée) : suivi et modification du budget de l'édition active. N'inclut pas le dépôt de facture — celui-ci se gère séparément ci-dessous.",
  gestionnaire: "Accès opérationnel au pilotage quotidien : bénévoles, équipes, présences, accréditations, presse, VIP et pré-programme. N'a pas accès à cette page de gestion des rôles ni aux réglages du site web (sauf rôle supplémentaire).",
  gestionnaire_site: "Accès à la gestion du contenu du site public : actualités, partenaires, e-magazine et communiqués de presse.",
  chef_equipe: "Accès à \"Mon équipe\" : consulter les membres de son équipe et ajouter des documents utiles pour elle. Voit aussi les présences limitées à ses équipes.",
  benevole: "Accès à l'espace bénévole standard : dossier bénévole, mes affectations et mes documents.",
  parent_u14: "Accès à \"Mes enfants\" : suivi des inscriptions au pré-programme U12/U14 et au porte-panier.",
};

function normalizeEmailKey(email) {
  return String(email || "").trim().toLowerCase();
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareUsersForCleanup(left, right) {
  const leftUpdatedAt = Math.max(getTimestampMillis(left.updatedAt), getTimestampMillis(left.createdAt));
  const rightUpdatedAt = Math.max(getTimestampMillis(right.updatedAt), getTimestampMillis(right.createdAt));
  if (leftUpdatedAt !== rightUpdatedAt) return rightUpdatedAt - leftUpdatedAt;

  const leftCompleted = Boolean(left.uid && left.id === left.uid);
  const rightCompleted = Boolean(right.uid && right.id === right.uid);
  if (leftCompleted !== rightCompleted) return rightCompleted ? 1 : -1;

  return String(right.id || "").localeCompare(String(left.id || ""), "fr");
}

function buildDuplicateUserGroups(users) {
  const usersByEmail = new Map();

  users.forEach((user) => {
    const emailKey = normalizeEmailKey(user.email);
    if (!emailKey) return;

    const group = usersByEmail.get(emailKey) ?? [];
    group.push(user);
    usersByEmail.set(emailKey, group);
  });

  return [...usersByEmail.entries()]
    .map(([email, entries]) => {
      const sortedEntries = [...entries].sort(compareUsersForCleanup);
      return {
        email,
        keptUser: sortedEntries[0] ?? null,
        removedUsers: sortedEntries.slice(1),
      };
    })
    .filter((group) => group.keptUser && group.removedUsers.length > 0)
    .sort((left, right) => left.email.localeCompare(right.email, "fr"));
}

function RoleManagementPage(props) {
  const { AuthFormField, Panel } = props;
  const { currentUser, deletePlatformUser, userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const hasAdminRole = roles.includes("admin");
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedRoleGroup, setSelectedRoleGroup] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState("");
  const [deletingUserId, setDeletingUserId] = useState("");
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
  const {
    allowedUploaderRoles,
    allowedUploaderUserIds,
  } = useBudgetInvoiceConfiguration();
  const [invoicePermissionDraft, setInvoicePermissionDraft] = useState({
    allowedUploaderRoles: [],
    allowedUploaderUserIds: [],
  });
  const [invoicePermissionUsers, setInvoicePermissionUsers] = useState([]);
  const [selectedInvoicePermissionUserId, setSelectedInvoicePermissionUserId] = useState("");
  const [invoicePermissionStatus, setInvoicePermissionStatus] = useState("");
  const [isSavingInvoicePermissions, setIsSavingInvoicePermissions] = useState(false);
  const normalizedSearch = search.trim().toLowerCase();
  const searchTokens = useMemo(() => buildSearchPrefixes(search).slice(0, 10), [search]);
  const shouldSearch = searchTokens.length > 0;
  const shouldLoadUsers = hasAdminRole && (shouldSearch || Boolean(selectedRoleGroup));
  const visibleUsers = useMemo(() => (shouldLoadUsers ? users : []), [shouldLoadUsers, users]);
  const visibleLoading = shouldLoadUsers ? loading : false;
  const duplicateCount = useMemo(
    () => duplicateGroups.reduce((sum, group) => sum + group.removedUsers.length, 0),
    [duplicateGroups],
  );
  const invoicePermissionUsersById = useMemo(
    () => new Map(invoicePermissionUsers.map((user) => [user.id, user])),
    [invoicePermissionUsers],
  );

  useEffect(() => {
    setInvoicePermissionDraft({
      allowedUploaderRoles,
      allowedUploaderUserIds,
    });
  }, [allowedUploaderRoles, allowedUploaderUserIds]);

  useEffect(() => {
    if (!hasAdminRole) return undefined;

    let isCancelled = false;

    async function loadInvoicePermissionUsers() {
      try {
        const snapshot = await getDocs(collection(db, "users"));
        if (isCancelled) return;

        const nextUsers = snapshot.docs
          .map((entry) => {
            const data = entry.data();
            return {
              id: entry.id,
              email: String(data.email || "").trim(),
              firstName: String(data.firstName || "").trim(),
              lastName: String(data.lastName || "").trim(),
            };
          })
          .sort((left, right) =>
            getDisplayName(left, left.email).localeCompare(getDisplayName(right, right.email), "fr", {
              sensitivity: "base",
            }),
          );

        setInvoicePermissionUsers(nextUsers);
      } catch {
        if (isCancelled) return;
        setInvoicePermissionStatus("Impossible de charger la liste des utilisateurs pour les permissions facture.");
      }
    }

    loadInvoicePermissionUsers();

    return () => {
      isCancelled = true;
    };
  }, [hasAdminRole]);

  useEffect(() => {
    if (!shouldLoadUsers) return undefined;

    let isCancelled = false;
    const loadingTimeoutId = window.setTimeout(() => {
      setLoading(true);
    }, 0);

    async function loadUsers() {
      try {
        const usersRef = collection(db, "users");
        const usersQuery = shouldSearch
          ? query(usersRef, where("searchTokens", "array-contains-any", searchTokens), limit(50))
          : query(usersRef, where("userTypes", "array-contains", selectedRoleGroup), limit(100));
        const snapshot = await getDocs(usersQuery);
        const docsToBackfill = snapshot.docs.filter((userSnapshot) => {
          const data = userSnapshot.data();
          return JSON.stringify(data.searchTokens || []) !== JSON.stringify(buildUserSearchTokens(data));
        });

        if (docsToBackfill.length) {
          await Promise.all(
            docsToBackfill.map((userSnapshot) =>
              updateDoc(doc(db, "users", userSnapshot.id), {
                searchTokens: buildUserSearchTokens(userSnapshot.data()),
                updatedAt: serverTimestamp(),
              }),
            ),
          );
        }

        const nextUsers = snapshot.docs
          .map((userSnapshot) => {
            const data = userSnapshot.data();

            return {
              id: userSnapshot.id,
              email: data.email || "",
              firstName: data.firstName || "",
              lastName: data.lastName || "",
              accountStatus: data.accountStatus || "active",
              userTypes: (() => {
                const nextRoles = extractRolesFromProfile(data);
                return nextRoles.length ? nextRoles : ["benevole"];
              })(),
            };
          })
          .filter((user) => {
            const matchesRoleGroup = selectedRoleGroup
              ? user.userTypes.includes(selectedRoleGroup)
              : true;
            if (!matchesRoleGroup) return false;
            if (!normalizedSearch) return true;

            const haystack = normalizeSearchValue([user.firstName, user.lastName, user.email].join(" "));
            return normalizedSearch
              .split(/\s+/)
              .filter(Boolean)
              .every((term) => haystack.includes(normalizeSearchValue(term)));
          })
          .sort((left, right) => {
            const leftName = `${left.firstName} ${left.lastName}`.trim() || left.email;
            const rightName = `${right.firstName} ${right.lastName}`.trim() || right.email;
            return leftName.localeCompare(rightName, "fr");
          });

        if (isCancelled) return;

        setUsers(nextUsers);
        setLoading(false);
      } catch {
        if (isCancelled) return;
        setStatusMessage("Impossible de charger la liste des utilisateurs.");
        setLoading(false);
      }
    }

    const timeoutId = window.setTimeout(loadUsers, shouldSearch ? 250 : 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(loadingTimeoutId);
      window.clearTimeout(timeoutId);
    };
  }, [normalizedSearch, searchTokens, selectedRoleGroup, shouldLoadUsers, shouldSearch, hasAdminRole]);

  const loadedUserSummary = useMemo(
    () => ({
      adminCount: visibleUsers.filter((user) => user.userTypes.includes("admin")).length,
      managerCount: visibleUsers.filter((user) => user.userTypes.includes("gestionnaire")).length,
      leadCount: visibleUsers.filter((user) => user.userTypes.includes("chef_equipe")).length,
    }),
    [visibleUsers],
  );

  function toggleUserRole(userId, roleValue) {
    setUsers((current) =>
      current.map((user) => {
        if (user.id !== userId) return user;

        const hasRole = user.userTypes.includes(roleValue);
        const nextRoles = hasRole
          ? user.userTypes.filter((role) => role !== roleValue)
          : [...user.userTypes, roleValue];

        return {
          ...user,
          userTypes: nextRoles.length ? nextRoles : ["benevole"],
        };
      }),
    );
  }

  async function saveUserRoles(user) {
    if (user.id === currentUser?.uid && !user.userTypes.includes("admin")) {
      setStatusMessage("Tu ne peux pas retirer ton propre rôle admin depuis cet écran.");
      return;
    }

    setSavingUserId(user.id);
    setStatusMessage("");

    try {
      await updateDoc(doc(db, "users", user.id), {
        userTypes: user.userTypes,
        searchTokens: buildUserSearchTokens(user),
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(`Rôles mis à jour pour ${getDisplayName(user, user.email)}.`);
    } catch {
      setStatusMessage("La mise à jour des rôles a échoué.");
    } finally {
      setSavingUserId("");
    }
  }

  async function handleDeleteUser(user) {
    const displayName = getDisplayName(user, user.email);
    const confirmed = window.confirm(
      `Supprimer complètement ${displayName} ?\n\nCette action supprimera le compte Auth, le profil Firestore et les principales données liées.`,
    );

    if (!confirmed) return;

    setDeletingUserId(user.id);
    setStatusMessage("");

    try {
      const result = await deletePlatformUser(user.id, user.email);
      setUsers((current) => current.filter((entry) => entry.id !== user.id));
      setStatusMessage(
        `Utilisateur supprimé: ${displayName}. Auth supprimé: ${result?.authDeleted ? "oui" : result?.authMissing ? "déjà absent" : "non"}.`,
      );
    } catch (error) {
      console.error("La suppression complète de l'utilisateur a échoué.", error);
      setStatusMessage("La suppression complète de l'utilisateur a échoué.");
    } finally {
      setDeletingUserId("");
    }
  }

  async function analyzeDuplicateUsers() {
    setDuplicatesLoading(true);
    setStatusMessage("");

    try {
      const snapshot = await getDocs(collection(db, "users"));
      const nextDuplicateGroups = buildDuplicateUserGroups(
        snapshot.docs.map((userSnapshot) => ({
          id: userSnapshot.id,
          ...userSnapshot.data(),
        })),
      );

      setDuplicateGroups(nextDuplicateGroups);
      setStatusMessage(
        nextDuplicateGroups.length
          ? `${nextDuplicateGroups.length} adresse(s) e-mail en doublon trouvée(s), ${nextDuplicateGroups.reduce((sum, group) => sum + group.removedUsers.length, 0)} profil(s) orphelin(s) à nettoyer.`
          : "Aucun doublon Firestore détecté par adresse e-mail.",
      );
    } catch {
      setStatusMessage("Impossible d'analyser les doublons utilisateurs pour le moment.");
    } finally {
      setDuplicatesLoading(false);
    }
  }

  async function cleanupDuplicateUsers() {
    if (!duplicateGroups.length) {
      setStatusMessage("Aucun doublon à nettoyer.");
      return;
    }

    setIsCleaningDuplicates(true);
    setStatusMessage("");

    try {
      for (const group of duplicateGroups) {
        const batch = writeBatch(db);

        group.removedUsers.forEach((user) => {
          batch.set(doc(db, "usersCleanupArchive", user.id), {
            ...user,
            originalDocId: user.id,
            cleanupEmail: group.email,
            keptUserId: group.keptUser.id,
            cleanupReason: "duplicate-email-orphan",
            archivedAt: serverTimestamp(),
          });
          batch.delete(doc(db, "users", user.id));
        });

        await batch.commit();
      }

      setUsers((current) => {
        const removedIds = new Set(
          duplicateGroups.flatMap((group) => group.removedUsers.map((user) => user.id)),
        );
        return current.filter((user) => !removedIds.has(user.id));
      });
      setStatusMessage(
        `${duplicateCount} profil(s) Firestore orphelin(s) archivé(s) dans usersCleanupArchive puis supprimé(s) de users.`,
      );
      setDuplicateGroups([]);
    } catch {
      setStatusMessage("Le nettoyage des doublons a échoué. Aucun nettoyage complet n'a été confirmé.");
    } finally {
      setIsCleaningDuplicates(false);
    }
  }

  function toggleInvoicePermissionRole(roleValue) {
    setInvoicePermissionDraft((current) => ({
      ...current,
      allowedUploaderRoles: current.allowedUploaderRoles.includes(roleValue)
        ? current.allowedUploaderRoles.filter((role) => role !== roleValue)
        : [...current.allowedUploaderRoles, roleValue],
    }));
  }

  function addInvoicePermissionUser() {
    if (!selectedInvoicePermissionUserId) return;

    setInvoicePermissionDraft((current) => ({
      ...current,
      allowedUploaderUserIds: current.allowedUploaderUserIds.includes(selectedInvoicePermissionUserId)
        ? current.allowedUploaderUserIds
        : [...current.allowedUploaderUserIds, selectedInvoicePermissionUserId],
    }));
    setSelectedInvoicePermissionUserId("");
  }

  function removeInvoicePermissionUser(userId) {
    setInvoicePermissionDraft((current) => ({
      ...current,
      allowedUploaderUserIds: current.allowedUploaderUserIds.filter((entry) => entry !== userId),
    }));
  }

  async function saveInvoicePermissions() {
    setIsSavingInvoicePermissions(true);
    setInvoicePermissionStatus("");

    try {
      await setDoc(
        doc(db, ...BUDGET_INVOICE_CONFIGURATION_DOC_PATH),
        {
          allowedUploaderRoles: invoicePermissionDraft.allowedUploaderRoles,
          allowedUploaderUserIds: invoicePermissionDraft.allowedUploaderUserIds,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setInvoicePermissionStatus("Permissions de dépôt de facture enregistrées.");
    } catch {
      setInvoicePermissionStatus("La sauvegarde des permissions facture a échoué.");
    } finally {
      setIsSavingInvoicePermissions(false);
    }
  }

  if (!hasAdminRole) {
    return (
      <div className="page">
        <section className="page-header">
          <div>
            <p className="eyebrow">Administration</p>
            <h1>Rôles plateforme</h1>
            <p>Cette page est réservée aux administrateurs.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Rôles plateforme</h1>
          <p>Assigne les accès admin, gestionnaire, chef d'équipe, bénévole et parent U14.</p>
        </div>
      </section>

      <Panel
        title="Rechercher une personne"
        subtitle="Retrouve un compte par nom, prénom, mail, ou filtre par groupe de rôle. Coche/décoche ses rôles dans le tableau ci-dessous puis clique sur « Sauvegarder » sur sa ligne."
      >
        <div className="choice-grid choice-grid--2">
          <AuthFormField label="Rechercher une personne">
            <input
              autoFocus
              placeholder="Nom, prénom ou mail"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </AuthFormField>
          <AuthFormField label="Groupe de rôle">
            <select value={selectedRoleGroup} onChange={(event) => setSelectedRoleGroup(event.target.value)}>
              <option value="">Tous les groupes</option>
              {platformRoleOptions.map((roleOption) => (
                <option key={roleOption.value} value={roleOption.value}>
                  {roleOption.label}
                </option>
              ))}
            </select>
          </AuthFormField>
        </div>
        <div className="compact-list" style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
          <span>{visibleUsers.length} compte(s) trouvé(s)</span>
          <span>{loadedUserSummary.adminCount} administrateur(s)</span>
          <span>{loadedUserSummary.managerCount} gestionnaire(s)</span>
          <span>{loadedUserSummary.leadCount} chef(s) d'équipe</span>
        </div>
        {!selectedRoleGroup && !normalizedSearch ? (
          <p className="panel-note">
            Sélectionne un groupe de rôle ou saisis au moins 2 caractères pour afficher des comptes.
          </p>
        ) : null}
        {statusMessage ? <p className="panel-note">{statusMessage}</p> : null}
      </Panel>

      <Panel title="Gestion des accès" subtitle="Les changements prennent effet après sauvegarde de la ligne.">
        {visibleLoading ? <p className="panel-note">Chargement des utilisateurs...</p> : null}
        {!visibleLoading && !visibleUsers.length ? (
          <p className="panel-note">Aucun utilisateur ne correspond aux filtres actuels.</p>
        ) : null}
        <div className="table-wrap">
          <table className="data-table data-table--admin">
            <thead>
              <tr>
                <th>Personne</th>
                <th>Email</th>
                <th>Statut</th>
                <th>Rôles</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => {
                const isActiveAccount = (user.accountStatus || "active") === "active";
                return (
                  <tr key={user.id}>
                    <td>
                      {getDisplayName(user, user.email)}
                      {!isActiveAccount ? (
                        <>
                          <br />
                          <span className="panel-note" style={{ color: "#b45309" }}>
                            ⚠ pas encore un compte actif — sûrement une candidature bénévole, pas la même fiche que
                            son compte connecté
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>{user.email || "Non renseigné"}</td>
                    <td>
                      {isActiveAccount ? "Actif" : formatVolunteerApplicationStatus(user.accountStatus)}
                    </td>
                    <td>
                      <div className="choice-grid choice-grid--2">
                        {platformRoleOptions.map((roleOption) => (
                          <label
                            key={`${user.id}-${roleOption.value}`}
                            className="selection-card selection-card--compact"
                            title={ROLE_ACCESS_DESCRIPTIONS[roleOption.value]}
                          >
                            <input
                              checked={user.userTypes.includes(roleOption.value)}
                              type="checkbox"
                              onChange={() => toggleUserRole(user.id, roleOption.value)}
                            />
                            <div>
                              <strong>{roleOption.label}</strong>
                            </div>
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button button--primary"
                          type="button"
                          disabled={savingUserId === user.id || deletingUserId === user.id}
                          onClick={() => saveUserRoles(user)}
                        >
                          {savingUserId === user.id ? "Sauvegarde..." : "Sauvegarder"}
                        </button>
                        <button
                          className="button button--danger"
                          type="button"
                          disabled={deletingUserId === user.id || user.id === currentUser?.uid}
                          onClick={() => handleDeleteUser(user)}
                        >
                          {deletingUserId === user.id ? "Suppression..." : "Supprimer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!visibleLoading && visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan="5">Aucun utilisateur ne correspond aux filtres actuels.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="panel-note">
          Rôles actuels : {platformRoleOptions.map((role) => getRoleLabel(role.value)).join(", ")}.
        </p>
      </Panel>

      <Panel
        title="Comprendre les rôles"
        subtitle="Un compte peut cumuler plusieurs rôles à la fois (ex : bénévole + chef d'équipe). Chaque rôle ajoute des accès, il n'en retire jamais."
      >
        <dl className="detail-list">
          {platformRoleOptions.map((roleOption) => (
            <div key={roleOption.value}>
              <dt>{roleOption.label}</dt>
              <dd>{ROLE_ACCESS_DESCRIPTIONS[roleOption.value]}</dd>
            </div>
          ))}
        </dl>
        <p className="panel-note">
          Un compte garde toujours au moins un rôle : si tu décoches tout, il redevient automatiquement "Bénévole".
          Tu ne peux pas retirer ton propre rôle administrateur depuis cet écran.
        </p>
        <p className="panel-note">
          Le dépôt de facture est une autorisation à part, indépendante des rôles ci-dessus : elle se configure dans
          le panneau "Dépôt de facture" plus bas, par rôle ou en ajoutant une personne précise.
        </p>
      </Panel>

      <Panel
        title="Dépôt de facture"
        subtitle="Choisis quels rôles plateforme peuvent déposer des factures dans l'onglet Document, et ajoute si besoin des personnes précises."
      >
        <div className="section-stack">
          <div className="choice-grid choice-grid--2">
            {platformRoleOptions.map((roleOption) => (
              <label
                key={`invoice-${roleOption.value}`}
                className="selection-card selection-card--compact"
                title={ROLE_ACCESS_DESCRIPTIONS[roleOption.value]}
              >
                <input
                  checked={invoicePermissionDraft.allowedUploaderRoles.includes(roleOption.value)}
                  type="checkbox"
                  onChange={() => toggleInvoicePermissionRole(roleOption.value)}
                />
                <div>
                  <strong>{roleOption.label}</strong>
                </div>
              </label>
            ))}
          </div>

          <div className="field">
            <span>Personne spécifique</span>
            <div className="document-team-picker">
              <select
                value={selectedInvoicePermissionUserId}
                onChange={(event) => setSelectedInvoicePermissionUserId(event.target.value)}
              >
                <option value="">Ajouter une personne</option>
                {invoicePermissionUsers
                  .filter((user) => !invoicePermissionDraft.allowedUploaderUserIds.includes(user.id))
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {getDisplayName(user, user.email)}{user.email ? ` · ${user.email}` : ""}
                    </option>
                  ))}
              </select>
              <button
                className="button button--secondary"
                type="button"
                disabled={!selectedInvoicePermissionUserId}
                onClick={addInvoicePermissionUser}
              >
                Ajouter
              </button>
            </div>
          </div>

          {invoicePermissionDraft.allowedUploaderUserIds.length ? (
            <div className="document-tag-list">
              {invoicePermissionDraft.allowedUploaderUserIds.map((userId) => {
                const user = invoicePermissionUsersById.get(userId);
                const label = user ? `${getDisplayName(user, user.email)}${user.email ? ` · ${user.email}` : ""}` : userId;

                return (
                  <button
                    key={`invoice-user-${userId}`}
                    className="document-tag document-tag--removable"
                    type="button"
                    onClick={() => removeInvoicePermissionUser(userId)}
                  >
                    {label} ×
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="panel-note">Aucune personne spécifique ajoutée pour le moment.</p>
          )}

          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              disabled={isSavingInvoicePermissions}
              onClick={saveInvoicePermissions}
            >
              {isSavingInvoicePermissions ? "Sauvegarde..." : "Enregistrer les permissions facture"}
            </button>
          </div>

          <p className="panel-note">
            Les administrateurs gardent toujours l'accès au dépôt et au classement des factures.
          </p>
          {invoicePermissionStatus ? <p className="panel-note">{invoicePermissionStatus}</p> : null}
        </div>
      </Panel>

      <Panel
        title="Nettoyage des doublons"
        subtitle="Détecte les profils Firestore en doublon par e-mail, archive les plus anciens puis les supprime de users."
      >
        <div className="button-row">
          <button
            className="button button--secondary"
            type="button"
            disabled={duplicatesLoading || isCleaningDuplicates}
            onClick={analyzeDuplicateUsers}
          >
            {duplicatesLoading ? "Analyse..." : "Analyser les doublons"}
          </button>
          <button
            className="button button--danger"
            type="button"
            disabled={!duplicateGroups.length || duplicatesLoading || isCleaningDuplicates}
            onClick={cleanupDuplicateUsers}
          >
            {isCleaningDuplicates ? "Nettoyage..." : "Archiver et supprimer les doublons"}
          </button>
        </div>
        <p className="panel-note">
          Règle utilisée : on garde le profil le plus récent pour chaque e-mail et on archive les anciens dans
          `usersCleanupArchive` avant suppression.
        </p>
        {!duplicateGroups.length && !duplicatesLoading ? (
          <p className="panel-note">Aucun doublon analysé pour le moment.</p>
        ) : null}
        {duplicateGroups.length ? (
          <div className="table-wrap">
            <table className="data-table data-table--admin">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Profil conservé</th>
                  <th>Profils supprimés</th>
                </tr>
              </thead>
              <tbody>
                {duplicateGroups.map((group) => (
                  <tr key={group.email}>
                    <td>{group.email}</td>
                    <td>
                      <strong>{getDisplayName(group.keptUser, group.email)}</strong>
                      <br />
                      <span className="panel-note">{group.keptUser.id}</span>
                    </td>
                    <td>
                      {group.removedUsers.map((user) => (
                        <div key={user.id}>
                          <strong>{getDisplayName(user, group.email)}</strong>
                          <br />
                          <span className="panel-note">{user.id}</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

    </div>
  );
}

function TeamsPage(props) {
  const { AuthFormField, DataTable, Panel, syncVolunteerAssignmentToUserProfile } = props;
  const {
    applications: volunteerApplications,
    loading: volunteerApplicationsLoading,
    error: volunteerApplicationsError,
  } = useVolunteerApplicationsList(true);
  const [roles, setRoles] = useState(defaultTeamRoles);
  const [selectedRoleId, setSelectedRoleId] = useState(defaultTeamRoles[0]?.id ?? "");
  const [activeTeamTab, setActiveTeamTab] = useState("configuration");
  const [teamDetailTab, setTeamDetailTab] = useState("settings");
  const [memberSearch, setMemberSearch] = useState("");
  const [teamAssignments, setTeamAssignments] = useState(defaultTeamAssignments);
  const [supportTasks, setSupportTasks] = useState(() => normalizeTeamConfigurationPayload({}).supportTasks);
  const [subRoleDraft, setSubRoleDraft] = useState("");
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsStatus, setTeamsStatus] = useState("");
  const lastPersistedTeamsRef = useRef("");
  const teamsReadyRef = useRef(false);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0];
  const availableVolunteers = useMemo(
    () => volunteerApplications.map((application) => mapVolunteerApplicationToAdminVolunteer(application)),
    [volunteerApplications],
  );

  useEffect(() => {
    if (!availableVolunteers.length) return undefined;

    const volunteerByIdentity = new Map();

    availableVolunteers.forEach((volunteer) => {
      const stableId = getVolunteerStableId(volunteer);
      const fullName = `${volunteer.firstName} ${volunteer.lastName}`.trim().toLowerCase();
      const email = String(volunteer.email || "").trim().toLowerCase();

      [stableId, email, fullName]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
        .forEach((value) => volunteerByIdentity.set(value, volunteer));
    });

    const timeoutId = window.setTimeout(() => {
      setTeamAssignments((current) => {
        let hasChanges = false;
        const nextAssignments = current
          .map((member) => {
            const matchedVolunteer =
              volunteerByIdentity.get(String(member.id || "").trim().toLowerCase()) ||
              volunteerByIdentity.get(String(member.email || "").trim().toLowerCase()) ||
              volunteerByIdentity.get(`${member.firstName} ${member.lastName}`.trim().toLowerCase());

            if (!matchedVolunteer) {
              if (isLegacySeedAssignment(member)) {
                hasChanges = true;
                return null;
              }

              return member;
            }

            const stableId = getVolunteerStableId(matchedVolunteer);
            const nextMember = {
              ...member,
              assignmentEntryId:
                member.assignmentEntryId || (stableId && member.assignedRoleId ? `${stableId}::${member.assignedRoleId}` : ""),
              id: stableId,
              firstName: matchedVolunteer.firstName,
              lastName: matchedVolunteer.lastName,
              email: matchedVolunteer.email,
              phone: matchedVolunteer.phone,
              languages: matchedVolunteer.languages,
              workflowStatus: matchedVolunteer.workflowStatus,
            };

            if (JSON.stringify(nextMember) !== JSON.stringify(member)) {
              hasChanges = true;
            }

            return nextMember;
          })
          .filter(Boolean);

        return hasChanges ? nextAssignments : current;
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [availableVolunteers]);

  useEffect(() => {
    const teamsConfigurationRef = doc(db, ...TEAM_CONFIGURATION_DOC_PATH);

    const unsubscribe = onSnapshot(
      teamsConfigurationRef,
      (snapshot) => {
        const nextData = snapshot.exists()
          ? normalizeTeamConfigurationPayload(snapshot.data())
          : {
              roles: defaultTeamRoles,
              teamAssignments: defaultTeamAssignments,
              supportTasks: normalizeTeamConfigurationPayload({}).supportTasks,
            };
        const serializedPayload = JSON.stringify(nextData);

        lastPersistedTeamsRef.current = serializedPayload;
        teamsReadyRef.current = true;
        setRoles(nextData.roles);
        setTeamAssignments(nextData.teamAssignments);
        setSupportTasks(nextData.supportTasks);
        setSelectedRoleId((current) =>
          nextData.roles.some((role) => role.id === current) ? current : nextData.roles[0]?.id ?? "",
        );
        setTeamsLoading(false);
        setTeamsStatus("");
      },
      () => {
        teamsReadyRef.current = true;
        setTeamsLoading(false);
        setTeamsStatus("Impossible de synchroniser les équipes pour le moment.");
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!teamsReadyRef.current) return undefined;

    const payload = { roles, teamAssignments, supportTasks };
    const serializedPayload = JSON.stringify(payload);

    if (serializedPayload === lastPersistedTeamsRef.current) {
      return undefined;
    }

    let cancelled = false;

    setTeamsStatus("Enregistrement des équipes...");

    setDoc(
      doc(db, ...TEAM_CONFIGURATION_DOC_PATH),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
      .then(() => {
        if (cancelled) return;
        lastPersistedTeamsRef.current = serializedPayload;
        setTeamsStatus("Équipes enregistrées.");
        // Mirror just the role names (no PII, unlike the full team configuration
        // above) onto the already publicly-readable platform doc, so the public
        // volunteer application form can offer an up-to-date mission preference list.
        return setDoc(
          doc(db, "appSettings", "platform"),
          { volunteerRoleOptions: roles.map((role) => role.roleName) },
          { merge: true },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setTeamsStatus("L'enregistrement des équipes a échoué. Réessayez dans un instant.");
      });

    return () => {
      cancelled = true;
    };
  }, [roles, teamAssignments, supportTasks]);

  const roleStats = useMemo(
    () =>
      roles.map((role) => {
        const members = teamAssignments.filter((member) => member.assignedRoleId === role.id);
        const leaders = members.filter((member) => member.teamRole === "Chef d'équipe").length;
        const replacements = members.filter((member) => member.teamRole === "Remplaçant").length;
        const activeMembers = members.filter((member) => member.teamRole !== "Remplaçant").length;
        const remaining = Math.max(role.neededCount - activeMembers, 0);
        const leadGap = Math.max(role.expectedLeadCount - leaders, 0);

        return {
          roleName: role.roleName,
          neededCount: role.neededCount,
          expectedLeadCount: role.expectedLeadCount,
          activeMembers,
          leaders,
          replacements,
          remaining,
          leadGap,
          status:
            remaining === 0 && leadGap === 0
              ? "Objectif idéal atteint"
              : `${remaining} pers. et ${leadGap} chef(s) manquants à l'idéal`,
        };
      }),
    [roles, teamAssignments],
  );

  const selectedRoleMembers = useMemo(
    () => teamAssignments.filter((member) => member.assignedRoleId === selectedRole?.id),
    [selectedRole, teamAssignments],
  );

  const selectedRoleSubRoleCounts = useMemo(() => {
    if (!selectedRole) return [];

    return selectedRole.subRoles
      .map((subRole) => ({
        subRole,
        count: selectedRoleMembers.filter((member) => member.teamRole === subRole).length,
      }))
      .filter((item) => item.count > 0);
  }, [selectedRole, selectedRoleMembers]);

  const candidateResults = useMemo(() => {
    if (!selectedRole) {
      return [];
    }

    const normalizedSearch = memberSearch.trim().toLowerCase();

    return availableVolunteers
      .filter((volunteer) => {
        const haystack = `${volunteer.firstName} ${volunteer.lastName} ${volunteer.email}`.toLowerCase();
        return normalizedSearch ? haystack.includes(normalizedSearch) : true;
      })
      .filter(
        (volunteer) => !selectedRoleMembers.some((member) => member.id === getVolunteerStableId(volunteer)),
      )
      .slice(0, 6);
  }, [availableVolunteers, memberSearch, selectedRole, selectedRoleMembers]);

  const roleSpecificVolunteerOptions = useMemo(
    () =>
      availableVolunteers.filter(
        (volunteer) => !selectedRoleMembers.some((member) => member.id === getVolunteerStableId(volunteer)),
      ),
    [availableVolunteers, selectedRoleMembers],
  );

  async function syncVolunteerApplicationFromTeamAssignments(volunteerId, assignmentsSnapshot) {
    const matchedVolunteer = availableVolunteers.find(
      (volunteer) => getVolunteerStableId(volunteer) === volunteerId,
    );
    if (!matchedVolunteer?.id) return;

    const volunteerAssignments = assignmentsSnapshot.filter((assignment) => assignment.id === volunteerId);
    const assignedRoles = normalizeSubRoles(
      volunteerAssignments.map((assignment) => assignment.assignedRole).filter(Boolean),
    );
    const primaryAssignedRole = assignedRoles[0] || "";
    const teamRoleAssignments = assignedRoles.reduce((accumulator, assignedRole, index) => {
      const matchingAssignment = volunteerAssignments.find((assignment) => assignment.assignedRole === assignedRole);
      accumulator[assignedRole] = String(
        matchingAssignment?.teamRole || (index === 0 ? matchedVolunteer.teamRole : "") || "Bénévole",
      );
      return accumulator;
    }, {});
    const nextWorkflowStatus =
      matchedVolunteer.workflowStatus === "Annulé"
        ? "Annulé"
        : primaryAssignedRole
          ? "Affecté"
          : "Candidature reçue";
    const patch = {
      assignedRole: primaryAssignedRole,
      assignedRoles,
      workflowStatus: nextWorkflowStatus,
      teamRole: primaryAssignedRole ? teamRoleAssignments[primaryAssignedRole] || "Bénévole" : "Bénévole",
      teamRoleAssignments,
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, "volunteerApplications", matchedVolunteer.id), patch);
    await syncVolunteerAssignmentToUserProfile({ ...matchedVolunteer, ...patch });
  }

  function updateRole(field, value) {
    setRoles((current) =>
      current.map((role) => (role.id === selectedRole.id ? { ...role, [field]: value } : role)),
    );
  }

  function updateRoleName(value) {
    setRoles((current) =>
      current.map((role) => (role.id === selectedRole.id ? { ...role, roleName: value } : role)),
    );
    setTeamAssignments((current) =>
      current.map((member) =>
        member.assignedRoleId === selectedRole.id ? { ...member, assignedRole: value } : member,
      ),
    );
  }

  function toggleRoleLanguage(language) {
    const languages = selectedRole.requiredLanguages.includes(language)
      ? selectedRole.requiredLanguages.filter((item) => item !== language)
      : [...selectedRole.requiredLanguages, language];

    updateRole("requiredLanguages", languages);
  }

  function updateRoleShiftBoundary(boundary, value) {
    const [start = "", end = ""] = String(selectedRole.shiftTime || "").split(" - ");
    const nextShiftTime = boundary === "start" ? `${value} - ${end}` : `${start} - ${value}`;
    updateRole("shiftTime", nextShiftTime.trim());
  }

  function updateMemberRole(assignmentEntryId, teamRole) {
    let nextAssignmentsSnapshot = null;
    let volunteerIdToSync = "";

    setTeamAssignments((current) => {
      nextAssignmentsSnapshot = current.map((member) => {
        if (member.assignmentEntryId !== assignmentEntryId) return member;
        volunteerIdToSync = member.id;
        return { ...member, teamRole };
      });

      return nextAssignmentsSnapshot;
    });

    if (!volunteerIdToSync || !nextAssignmentsSnapshot) return;

    syncVolunteerApplicationFromTeamAssignments(volunteerIdToSync, nextAssignmentsSnapshot).catch((error) => {
      console.error("Impossible de synchroniser le rôle d'équipe du bénévole.", error);
      setTeamsStatus("Le rôle d'équipe a été modifié, mais la candidature bénévole n'a pas pu être resynchronisée.");
    });
  }

  function addSubRole() {
    const nextSubRole = subRoleDraft.trim();

    if (!selectedRole || !nextSubRole) return;
    if (defaultTeamRoleOptions.some((roleOption) => roleOption.toLowerCase() === nextSubRole.toLowerCase())) {
      return;
    }
    if (selectedRole.subRoles.some((subRole) => subRole.toLowerCase() === nextSubRole.toLowerCase())) {
      return;
    }

    updateRole("subRoles", [...selectedRole.subRoles, nextSubRole]);
    setSubRoleDraft("");
  }

  function removeSubRole(subRoleToRemove) {
    if (!selectedRole) return;

    updateRole(
      "subRoles",
      selectedRole.subRoles.filter((subRole) => subRole !== subRoleToRemove),
    );
  }

  function addRole() {
    const existingNames = new Set(roles.map((role) => role.roleName.trim().toLowerCase()));
    let suffix = roles.length + 1;
    let roleName = `Nouvelle équipe ${suffix}`;

    while (existingNames.has(roleName.trim().toLowerCase())) {
      suffix += 1;
      roleName = `Nouvelle équipe ${suffix}`;
    }

    const nextRole = {
      id: `role-${Date.now()}`,
      roleName,
      neededCount: 1,
      expectedLeadCount: 1,
      requiredLanguages: [],
      briefingTime: "",
      setupTime: "",
      shiftTime: "",
      leaderName: "",
      leaderContact: "",
      allowLeaderDocuments: false,
      teamInfo: "",
      teamInfoPlaceholder: "Décrivez ici les consignes, missions et informations utiles pour cette équipe.",
      documents: [],
      subRoles: [],
    };

    setRoles((current) => [...current, nextRole]);
    setSelectedRoleId(nextRole.id);
    setMemberSearch("");
  }

  function addMemberToSelectedRole(volunteer) {
    const volunteerId = getVolunteerStableId(volunteer);
    if (!volunteerId) return;

    let nextAssignmentsSnapshot = null;

    setTeamAssignments((current) => {
      const existingMember = current.find(
        (member) => member.id === volunteerId && member.assignedRoleId === selectedRole.id,
      );

      if (existingMember) {
        nextAssignmentsSnapshot = current;
        return current;
      }

      nextAssignmentsSnapshot = [
        ...current,
        {
          assignmentEntryId: `${volunteerId}::${selectedRole.id}`,
          id: volunteerId,
          firstName: volunteer.firstName,
          lastName: volunteer.lastName,
          email: volunteer.email,
          phone: volunteer.phone,
          languages: volunteer.languages,
          workflowStatus: volunteer.workflowStatus,
          assignedRoleId: selectedRole.id,
          assignedRole: selectedRole.roleName,
          teamRole: "Bénévole",
        },
      ];

      return nextAssignmentsSnapshot;
    });
    setMemberSearch("");

    if (!nextAssignmentsSnapshot) return;

    syncVolunteerApplicationFromTeamAssignments(volunteerId, nextAssignmentsSnapshot).catch((error) => {
      console.error("Impossible de synchroniser la candidature bénévole après affectation.", error);
      setTeamsStatus("L'équipe a été mise à jour, mais la candidature bénévole n'a pas pu être resynchronisée.");
    });
  }

  function removeMemberFromSelectedRole(assignmentEntryId) {
    let nextAssignmentsSnapshot = null;
    let volunteerIdToSync = "";

    setTeamAssignments((current) => {
      const memberToRemove = current.find((member) => member.assignmentEntryId === assignmentEntryId);
      volunteerIdToSync = memberToRemove?.id || "";
      nextAssignmentsSnapshot = current.filter((member) => member.assignmentEntryId !== assignmentEntryId);
      return nextAssignmentsSnapshot;
    });

    if (!volunteerIdToSync || !nextAssignmentsSnapshot) return;

    syncVolunteerApplicationFromTeamAssignments(volunteerIdToSync, nextAssignmentsSnapshot).catch((error) => {
      console.error("Impossible de synchroniser la candidature bénévole après retrait d'équipe.", error);
      setTeamsStatus("L'équipe a été mise à jour, mais la candidature bénévole n'a pas pu être resynchronisée.");
    });
  }

  function addSupportTask() {
    setSupportTasks((current) => [
      ...current,
      {
        id: `support-task-${Date.now()}`,
        day: "Vendredi",
        startTime: "",
        endTime: "",
        taskLabel: supportTaskOptions[0] || "",
      },
    ]);
  }

  function updateSupportTaskConfig(taskId, field, value) {
    setSupportTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, [field]: value } : task)),
    );
  }

  function removeSupportTask(taskId) {
    setSupportTasks((current) => current.filter((task) => task.id !== taskId));
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Gestion des équipes</h1>
          <p>
            Paramétrez ici chaque rôle opérationnel: besoin, langues, horaires et informations à
            transmettre à l'équipe.
          </p>
        </div>
      </section>
      {volunteerApplicationsError ? <p className="status-note">{volunteerApplicationsError}</p> : null}
      <div className="admin-subtabs">
        <button
          className={`admin-subtab ${activeTeamTab === "configuration" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => setActiveTeamTab("configuration")}
        >
          Paramétrage & composition
        </button>
        <button
          className={`admin-subtab ${activeTeamTab === "overview" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => setActiveTeamTab("overview")}
        >
          Récapitulatif équipes
        </button>
        <button
          className={`admin-subtab ${activeTeamTab === "support" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => setActiveTeamTab("support")}
        >
          Autour du meeting
        </button>
      </div>

      {activeTeamTab === "configuration" ? (
        selectedRole ? (
          <section className="admin-stack">
            {teamsLoading || volunteerApplicationsLoading ? (
              <p className="status-note">Chargement des équipes...</p>
            ) : null}
            {teamsStatus ? <p className="status-note">{teamsStatus}</p> : null}
            <Panel
              title="Équipes disponibles"
              subtitle="Sélectionne une équipe à configurer."
              actions={
                <button className="button button--secondary button--small" type="button" onClick={addRole}>
                  + Ajouter une équipe
                </button>
              }
            >
              <div className="role-chip-grid role-chip-grid--compact">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    className={`role-chip role-chip--compact ${selectedRoleId === role.id ? "role-chip--active" : ""}`}
                    type="button"
                    onClick={() => setSelectedRoleId(role.id)}
                  >
                    <strong>{role.roleName}</strong>
                    <span>
                      {role.neededCount} pers. • {role.expectedLeadCount} chef(s)
                    </span>
                  </button>
                ))}
              </div>
            </Panel>

            <div className="admin-stack">
              {teamDetailTab === "settings" ? (
              <Panel
                title={
                  <span className="panel-tab-switch">
                    <button
                      type="button"
                      className="panel-tab panel-tab--active"
                      onClick={() => setTeamDetailTab("settings")}
                    >
                      Paramétrage
                    </button>
                    <button
                      type="button"
                      className="panel-tab"
                      onClick={() => setTeamDetailTab("composition")}
                    >
                      Composition actuelle ({selectedRoleMembers.length})
                    </button>
                  </span>
                }
                subtitle={`${selectedRole.roleName} — définis ici les volumes idéaux, les sous-rôles, les langues attendues et les horaires d'équipe.`}
              >
                <div className="team-stats-inline" aria-live="polite">
                  <div>
                    <strong>{selectedRole.neededCount}</strong>
                    <span>Personnes attendues</span>
                  </div>
                  <div>
                    <strong>{selectedRole.expectedLeadCount}</strong>
                    <span>Chefs attendus</span>
                  </div>
                  <div>
                    <strong>{selectedRoleMembers.length}</strong>
                    <span>Déjà affectées</span>
                  </div>
                  <div>
                    <strong>{Math.max(selectedRole.neededCount - selectedRoleMembers.length, 0)}</strong>
                    <span>Écart à l'idéal</span>
                  </div>
                </div>
                <div className="field-grid">
                  <AuthFormField label="Nom du rôle">
                    <input
                      value={selectedRole.roleName}
                      onChange={(event) => updateRoleName(event.target.value)}
                    />
                  </AuthFormField>
                  <AuthFormField label="Nombre de personnes attendues (idéal)">
                    <input
                      type="number"
                      min="0"
                      value={selectedRole.neededCount}
                      onChange={(event) => updateRole("neededCount", Number(event.target.value))}
                    />
                  </AuthFormField>
                  <AuthFormField label="Nombre de chefs d'équipe attendus (idéal)">
                    <input
                      type="number"
                      min="0"
                      value={selectedRole.expectedLeadCount}
                      onChange={(event) => updateRole("expectedLeadCount", Number(event.target.value))}
                    />
                  </AuthFormField>
                </div>

                <div className="field">
                  <span>Sous-rôles dans l'équipe</span>
                  <div className="team-subrole-editor">
                    <input
                      placeholder="Ex. Responsable matériel"
                      value={subRoleDraft}
                      onChange={(event) => setSubRoleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addSubRole();
                        }
                      }}
                    />
                    <button className="button button--secondary" type="button" onClick={addSubRole}>
                      Ajouter le sous-rôle
                    </button>
                  </div>
                  <small>
                    Ces nombres et sous-rôles servent de repère idéal uniquement. Ils ne bloquent aucune affectation.
                  </small>
                  <div className="team-subrole-list">
                    {selectedRole.subRoles.length > 0 ? (
                      selectedRole.subRoles.map((subRole) => (
                        <button
                          key={`${selectedRole.id}-${subRole}`}
                          className="team-subrole-chip"
                          type="button"
                          onClick={() => removeSubRole(subRole)}
                        >
                          {subRole} ×
                        </button>
                      ))
                    ) : (
                      <span className="team-subrole-empty">Aucun sous-rôle défini pour l'instant.</span>
                    )}
                  </div>
                </div>

                <div className="field">
                  <span>Conditions de langue</span>
                  <div className="choice-grid choice-grid--2">
                    {["Français", "Anglais", "Allemand", "Luxembourgeois"].map((language) => (
                      <label key={language} className="selection-card selection-card--compact">
                        <input
                          checked={selectedRole.requiredLanguages.includes(language)}
                          type="checkbox"
                          onChange={() => toggleRoleLanguage(language)}
                        />
                        <div>
                          <strong>{language}</strong>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="field-grid">
                  <AuthFormField label="Horaire du briefing">
                    <input
                      type="time"
                      value={selectedRole.briefingTime}
                      onChange={(event) => updateRole("briefingTime", event.target.value)}
                    />
                  </AuthFormField>
                  <AuthFormField label="Horaire de mise en place">
                    <input
                      type="time"
                      value={selectedRole.setupTime}
                      onChange={(event) => updateRole("setupTime", event.target.value)}
                    />
                  </AuthFormField>
                </div>

                <div className="field-grid">
                  <AuthFormField label="Début du poste">
                    <input
                      type="time"
                      value={String(selectedRole.shiftTime || "").split(" - ")[0] || ""}
                      onChange={(event) => updateRoleShiftBoundary("start", event.target.value)}
                    />
                  </AuthFormField>
                  <AuthFormField label="Fin du poste">
                    <input
                      type="time"
                      value={String(selectedRole.shiftTime || "").split(" - ")[1] || ""}
                      onChange={(event) => updateRoleShiftBoundary("end", event.target.value)}
                    />
                  </AuthFormField>
                </div>

                <AuthFormField label="Information générale pour l'équipe">
                  <textarea
                    rows="4"
                    value={selectedRole.teamInfo}
                    placeholder={selectedRole.teamInfoPlaceholder || "Informations générales pour l'équipe"}
                    onChange={(event) => updateRole("teamInfo", event.target.value)}
                  />
                </AuthFormField>

                <div className="admin-preview">
                  <div>
                    <strong>Résumé du rôle</strong>
                    <p>{selectedRole.roleName}</p>
                  </div>
                  <div>
                    <strong>Objectif idéal</strong>
                    <p>
                      {selectedRole.neededCount} personnes dont {selectedRole.expectedLeadCount} chef(s)
                      d'équipe
                    </p>
                  </div>
                  <div>
                    <strong>Langues</strong>
                    <p>{selectedRole.requiredLanguages.join(", ") || "Aucune condition"}</p>
                  </div>
                  <div>
                    <strong>Horaires</strong>
                    <p>
                      Briefing {selectedRole.briefingTime}, mise en place {selectedRole.setupTime},
                      poste {selectedRole.shiftTime}
                    </p>
                  </div>
                  <div>
                    <strong>Informations équipe</strong>
                    <p>{selectedRole.teamInfo || selectedRole.teamInfoPlaceholder || "Non renseigné"}</p>
                  </div>
                  <div>
                    <strong>Sous-rôles</strong>
                    <p>{selectedRole.subRoles.join(", ") || "Aucun sous-rôle"}</p>
                  </div>
                </div>
              </Panel>
              ) : (
              <Panel
                title={
                  <span className="panel-tab-switch">
                    <button
                      type="button"
                      className="panel-tab"
                      onClick={() => setTeamDetailTab("settings")}
                    >
                      Paramétrage
                    </button>
                    <button
                      type="button"
                      className="panel-tab panel-tab--active"
                      onClick={() => setTeamDetailTab("composition")}
                    >
                      Composition actuelle ({selectedRoleMembers.length})
                    </button>
                  </span>
                }
                subtitle={`${selectedRole.roleName} — chefs d'équipe, bénévoles, remplaçants et sous-rôles déjà affectés.`}
              >
                <div className="team-composition-summary">
                  <div className="team-summary-pill">
                    <strong>{selectedRoleMembers.length}</strong>
                    <span>Total affectés</span>
                  </div>
                  <div className="team-summary-pill">
                    <strong>
                      {selectedRoleMembers.filter((member) => member.teamRole === "Chef d'équipe").length}
                    </strong>
                    <span>Chefs réels</span>
                  </div>
                  <div className="team-summary-pill">
                    <strong>
                      {selectedRoleMembers.filter((member) => member.teamRole === "Bénévole").length}
                    </strong>
                    <span>Bénévoles</span>
                  </div>
                  <div className="team-summary-pill">
                    <strong>
                      {selectedRoleMembers.filter((member) => member.teamRole === "Remplaçant").length}
                    </strong>
                    <span>Remplaçants</span>
                  </div>
                </div>

                {selectedRoleSubRoleCounts.length > 0 ? (
                  <div className="team-subrole-stats">
                    {selectedRoleSubRoleCounts.map((item) => (
                      <div key={`${selectedRole.id}-stat-${item.subRole}`} className="team-summary-pill">
                        <strong>{item.count}</strong>
                        <span>{item.subRole}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <label className="field">
                  <span>Rechercher quelqu'un à ajouter</span>
                  <input
                    placeholder="Nom ou email"
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                  />
                </label>

                <div className="team-candidate-list">
                  {candidateResults.map((volunteer) => (
                    <div key={volunteer.id} className="team-candidate-row">
                      <div className="table-stack">
                        <strong>
                          {volunteer.firstName} {volunteer.lastName}
                        </strong>
                        <span>{volunteer.email}</span>
                      </div>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => addMemberToSelectedRole(volunteer)}
                      >
                        Ajouter
                      </button>
                    </div>
                  ))}
                </div>

                {candidateResults.length === 0 && roleSpecificVolunteerOptions.length > 0 ? (
                  <p className="panel-note">
                    Aucun nouveau résultat pour cette recherche. Les personnes déjà dans cette équipe restent exclues, mais
                    elles peuvent maintenant être affectées ailleurs sans écrasement.
                  </p>
                ) : null}

                <div className="table-wrap">
                  <table className="data-table data-table--admin">
                    <thead>
                      <tr>
                        <th>Membre</th>
                        <th>Coordonnées</th>
                        <th>Langues</th>
                        <th>Statut candidature</th>
                        <th>Rôle dans l'équipe</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRoleMembers.map((member) => (
                        <tr key={member.assignmentEntryId || `${member.id}-${member.assignedRoleId}`}>
                          <td>
                            <div className="table-stack">
                              <strong>
                                {member.firstName} {member.lastName}
                              </strong>
                              <span className={getWorkflowStatusClass(member.workflowStatus)}>
                                {member.workflowStatus}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="table-stack">
                              <span>{member.email}</span>
                              <span>{member.phone}</span>
                            </div>
                          </td>
                          <td>{member.languages.join(", ")}</td>
                          <td>{member.workflowStatus}</td>
                          <td>
                            <select
                              value={member.teamRole}
                              onChange={(event) => updateMemberRole(member.assignmentEntryId, event.target.value)}
                            >
                              {getAvailableTeamRoles(selectedRole, [member.teamRole]).map((teamRole) => (
                                <option key={`${member.assignmentEntryId}-${teamRole}`}>{teamRole}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              className="button button--secondary"
                              type="button"
                              onClick={() => removeMemberFromSelectedRole(member.assignmentEntryId)}
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              )}
            </div>
          </section>
        ) : null
      ) : activeTeamTab === "overview" ? (
        <section>
          <Panel
            title="Récapitulatif des équipes"
            subtitle="Vue rapide des objectifs idéaux, des personnes déjà affectées et des écarts restants."
          >
            <DataTable
              columns={[
                { key: "roleName", label: "Equipe" },
                { key: "neededCount", label: "Pers. idéales" },
                { key: "expectedLeadCount", label: "Chefs idéaux" },
                { key: "activeMembers", label: "Affectés" },
                { key: "leaders", label: "Chefs réels" },
                { key: "replacements", label: "Remplaçants" },
                { key: "remaining", label: "Écart pers." },
                { key: "leadGap", label: "Écart chefs" },
                { key: "status", label: "Statut" },
              ]}
              rows={roleStats}
            />
          </Panel>
        </section>
      ) : (
        <section className="admin-stack">
          {teamsLoading ? <p className="status-note">Chargement des tâches autour du meeting...</p> : null}
          {teamsStatus ? <p className="status-note">{teamsStatus}</p> : null}
          <Panel
            title="Tâches autour du meeting"
            subtitle="Paramétrez ici les créneaux de support avant, pendant ou après le meeting : jour, plage horaire et tâche."
          >
            <div className="support-config-toolbar">
              <button className="button button--primary" type="button" onClick={addSupportTask}>
                Ajouter un créneau
              </button>
            </div>

            <div className="table-wrap">
              <table className="data-table data-table--admin support-config-table">
                <thead>
                  <tr>
                    <th>Jour</th>
                    <th>Début</th>
                    <th>Fin</th>
                    <th>Intitulé de la tâche</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {supportTasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <select
                          value={task.day}
                          onChange={(event) => updateSupportTaskConfig(task.id, "day", event.target.value)}
                        >
                          <option value="">Choisir</option>
                          {supportTaskDayOptions.map((day) => (
                            <option key={`${task.id}-${day}`}>{day}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="time"
                          value={task.startTime}
                          onChange={(event) => updateSupportTaskConfig(task.id, "startTime", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          value={task.endTime}
                          onChange={(event) => updateSupportTaskConfig(task.id, "endTime", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          list={`support-task-suggestions-${task.id}`}
                          value={task.taskLabel}
                          placeholder="Décrire la tâche"
                          onChange={(event) => updateSupportTaskConfig(task.id, "taskLabel", event.target.value)}
                        />
                        <datalist id={`support-task-suggestions-${task.id}`}>
                          {supportTaskOptions.map((option) => (
                            <option key={`${task.id}-${option}`} value={option} />
                          ))}
                        </datalist>
                      </td>
                      <td>
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => removeSupportTask(task.id)}
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      )}
    </div>
  );
}

function PresencePage(props) {
  const { Panel, formatDateTimeForDisplay, getTimestampMs } = props;
  const { signatoryName, signatoryTitle, signatureImageUrl } = useCertificateConfiguration();
  const { currentUser, userProfile } = useAuth();
  const activeRoles = getActiveRoles(userProfile);
  const canManageAllTeams = activeRoles.includes("admin") || activeRoles.includes("gestionnaire");
  const { roles, teamAssignments, loading: teamsLoading, error: teamsError } = useTeamConfiguration();
  const { activeEditionId } = useActiveEdition(true);
  const { volunteerOverrides } = useAccreditationConfiguration(roles);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [activePresenceTab, setActivePresenceTab] = useState(canManageAllTeams ? "welcome" : "departures");
  const [arrivalDrafts, setArrivalDrafts] = useState({});
  const [departureDrafts, setDepartureDrafts] = useState({});
  const [visibleListCountByKey, setVisibleListCountByKey] = useState({});
  const actorId = String(currentUser?.uid || userProfile?.uid || "").trim();
  const userIdentitySet = useMemo(
    () => buildUserIdentitySet(userProfile, currentUser),
    [buildUserIdentitySet, currentUser, userProfile],
  );

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        setUsers(
          snapshot.docs.map((userSnapshot) => ({
            id: userSnapshot.id,
            ...userSnapshot.data(),
          })),
        );
        setUsersLoading(false);
        setUsersError("");
      },
      () => {
        setUsers([]);
        setUsersLoading(false);
        setUsersError("Impossible de charger les présences pour le moment.");
      },
    );

    return unsubscribe;
  }, []);

  const allVolunteers = useMemo(() => buildAccreditationUsers(users, teamAssignments), [buildAccreditationUsers, teamAssignments, users]);
  const myAssignments = useMemo(
    () =>
      teamAssignments.filter((member) =>
        [member.id, member.email, `${member.firstName} ${member.lastName}`.trim()]
          .map((value) => String(value || "").trim().toLowerCase())
          .some((value) => value && userIdentitySet.has(value)),
      ),
    [teamAssignments, userIdentitySet],
  );
  const myLeadAssignments = useMemo(
    () => myAssignments.filter((assignment) => isTeamLeadAssignment(assignment)),
    [isTeamLeadAssignment, myAssignments],
  );
  const myLeadRoleIds = useMemo(
    () =>
      roles
        .filter(
          (role) =>
            userIdentitySet.has(String(role.leaderName || "").trim().toLowerCase()) ||
            myLeadAssignments.some((assignment) => assignment.assignedRoleId === role.id),
        )
        .map((role) => role.id),
    [myLeadAssignments, roles, userIdentitySet],
  );
  const availableRoles = useMemo(() => {
    if (canManageAllTeams) return roles;

    const visibleRoleIds = new Set([...myLeadAssignments.map((assignment) => assignment.assignedRoleId), ...myLeadRoleIds]);
    return roles.filter((role) => visibleRoleIds.has(role.id));
  }, [canManageAllTeams, myLeadAssignments, myLeadRoleIds, roles]);

  const effectiveSelectedRoleId = availableRoles.some((role) => role.id === selectedRoleId)
    ? selectedRoleId
    : canManageAllTeams
      ? ""
      : availableRoles[0]?.id ?? "";
  const selectedRole = availableRoles.find((role) => role.id === effectiveSelectedRoleId) ?? null;
  const visibleVolunteers = useMemo(() => {
    if (canManageAllTeams) return allVolunteers;

    const allowedRoleIds = new Set(availableRoles.map((role) => role.id));
    return allVolunteers.filter((volunteer) =>
      teamAssignments.some(
        (assignment) => assignment.id === volunteer.id && allowedRoleIds.has(assignment.assignedRoleId),
      ),
    );
  }, [allVolunteers, availableRoles, canManageAllTeams, teamAssignments]);

  const volunteersWithTeams = useMemo(
    () =>
      visibleVolunteers.map((volunteer) => {
        const assignments = teamAssignments.filter((assignment) => assignment.id === volunteer.id);
        const teamNames = normalizeSubRoles(assignments.map((assignment) => assignment.assignedRole).filter(Boolean));
        const scopedAssignments = selectedRole
          ? assignments.filter((assignment) => assignment.assignedRoleId === selectedRole.id)
          : assignments;
        const scopedTeamRole =
          scopedAssignments[0]?.teamRole || assignments[0]?.teamRole || volunteer.teamRole || "Bénévole";

        return {
          ...volunteer,
          presence: normalizePresenceRecord(volunteer.presence),
          teamNames,
          scopedTeamRole,
          primaryTeam: teamNames[0] || volunteer.assignedRole || "En attente",
        };
      }),
    [normalizePresenceRecord, selectedRole, teamAssignments, visibleVolunteers],
  );

  const normalizedSearch = normalizeSearchValue(search);
  const scopedVolunteers = useMemo(() => {
    if (!selectedRole) return volunteersWithTeams;
    return volunteersWithTeams.filter((volunteer) => volunteer.teamNames.includes(selectedRole.roleName));
  }, [selectedRole, volunteersWithTeams]);
  const filteredVolunteers = useMemo(
    () =>
      scopedVolunteers
      .filter((volunteer) => {
        if (!normalizedSearch) return true;
        const haystack = normalizeSearchValue(
          [
            volunteer.firstName,
            volunteer.lastName,
            volunteer.email,
            volunteer.primaryTeam,
            ...(volunteer.teamNames || []),
          ].join(" "),
        );
        return normalizedSearch
          .split(/\s+/)
          .filter(Boolean)
          .every((term) => haystack.includes(term));
      }),
    [normalizedSearch, scopedVolunteers],
  );
  const welcomeVolunteers = useMemo(
    () =>
      [...filteredVolunteers].sort((left, right) => {
        const leftPriority = left.presence.checkedInAt ? 1 : 0;
        const rightPriority = right.presence.checkedInAt ? 1 : 0;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return String(`${left.lastName} ${left.firstName}`).localeCompare(
          String(`${right.lastName} ${right.firstName}`),
          "fr",
        );
      }),
    [filteredVolunteers],
  );
  const lunchVolunteers = useMemo(
    () =>
      filteredVolunteers.filter(
        (volunteer) => volunteer.presence.status === "present" || Boolean(volunteer.presence.checkedInAt),
      ),
    [filteredVolunteers],
  );
  const departureVolunteers = filteredVolunteers;

  const presentCount = volunteersWithTeams.filter((volunteer) => volunteer.presence.status === "present").length;
  const absentCount = Math.max(volunteersWithTeams.length - presentCount, 0);
  const lunchCount = volunteersWithTeams.filter((volunteer) => volunteer.presence.lunchCollectedAt).length;
  const completedCount = volunteersWithTeams.filter((volunteer) => volunteer.presence.missionCompletedAt).length;
  const selectedTeamPresentCount = departureVolunteers.filter((volunteer) => volunteer.presence.status === "present").length;
  const effectivePresenceTab = canManageAllTeams ? activePresenceTab : "departures";
  const visibleWelcomeVolunteers = welcomeVolunteers.slice(
    0,
    visibleListCountByKey["presence-welcome"] ?? DEFAULT_LIST_PAGE_SIZE,
  );
  const visibleLunchVolunteers = lunchVolunteers.slice(
    0,
    visibleListCountByKey["presence-lunch"] ?? DEFAULT_LIST_PAGE_SIZE,
  );
  const visibleDepartureVolunteers = departureVolunteers.slice(
    0,
    visibleListCountByKey["presence-departures"] ?? DEFAULT_LIST_PAGE_SIZE,
  );

  function canShowMoreListItems(listKey, items) {
    return items.length > (visibleListCountByKey[listKey] ?? DEFAULT_LIST_PAGE_SIZE);
  }

  function showMoreListItems(listKey) {
    setVisibleListCountByKey((current) => ({
      ...current,
      [listKey]: (current[listKey] ?? DEFAULT_LIST_PAGE_SIZE) + DEFAULT_LIST_PAGE_SIZE,
    }));
  }

  function formatPresenceDateForInput(value) {
    const timestamp = getTimestampMs(value);
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  async function updateVolunteerPresence(volunteer, patch, successMessage) {
    if (!volunteer?.id) return;

    const currentPresence = normalizePresenceRecord(volunteer.presence);
    const nextPresence = normalizePresenceRecord({
      ...currentPresence,
      ...patch,
    });

    setIsSaving(true);

    try {
      await setDoc(
        doc(db, "users", volunteer.id),
        {
          presence: nextPresence,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setStatusMessage(successMessage);
    } catch (error) {
      console.error("Impossible de mettre à jour la présence.", error);
      setStatusMessage("La mise à jour de présence a échoué.");
    } finally {
      setIsSaving(false);
    }
  }

  async function markVolunteerPresent(volunteer) {
    const now = new Date().toISOString();
    const currentPresence = normalizePresenceRecord(volunteer.presence);

    await updateVolunteerPresence(
      volunteer,
      {
        status: "present",
        checkedInAt: currentPresence.checkedInAt || now,
        checkedInBy: currentPresence.checkedInAt ? currentPresence.checkedInBy : actorId,
      },
      `${volunteer.firstName} ${volunteer.lastName}`.trim() + " marqué(e) présent(e).",
    );
  }

  function isBadgeHandedOver(volunteerId) {
    return Boolean(volunteerOverrides[volunteerId]?.handedOverAt);
  }

  async function setBadgeHandedOver(volunteerId, handedOver) {
    const existingOverride = volunteerOverrides[volunteerId] || {};
    const nextOverride = {
      ...existingOverride,
      handedOverAt: handedOver ? new Date().toISOString() : null,
      handedOverBy: handedOver ? actorId : "",
    };

    await setDoc(
      doc(db, ...ACCREDITATION_CONFIGURATION_DOC_PATH),
      {
        volunteerOverrides: {
          ...volunteerOverrides,
          [volunteerId]: nextOverride,
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  // "Welcome pack" = badge remis (statut partagé avec l'écran Accréditation,
  // seule source de vérité pour "le badge a été donné") + t-shirt remis (suivi
  // uniquement ici, ça ne concerne pas l'accréditation).
  async function toggleWelcomePack(volunteer) {
    const currentPresence = normalizePresenceRecord(volunteer.presence);
    if (isPresenceLocked(currentPresence)) return;

    const hasWelcomePack = isBadgeHandedOver(volunteer.id) && Boolean(currentPresence.tshirtDeliveredAt);
    const nextHandedOver = !hasWelcomePack;
    const now = new Date().toISOString();

    await setBadgeHandedOver(volunteer.id, nextHandedOver);
    await updateVolunteerPresence(
      volunteer,
      {
        accreditationDeliveredAt: nextHandedOver ? currentPresence.accreditationDeliveredAt || now : null,
        accreditationDeliveredBy: nextHandedOver ? actorId : "",
        tshirtDeliveredAt: nextHandedOver ? currentPresence.tshirtDeliveredAt || now : null,
        tshirtDeliveredBy: nextHandedOver ? actorId : "",
      },
      nextHandedOver
        ? `Welcome pack remis à ${`${volunteer.firstName} ${volunteer.lastName}`.trim()}.`
        : `Welcome pack retiré pour ${`${volunteer.firstName} ${volunteer.lastName}`.trim()}.`,
    );
  }

  async function markVolunteerAbsent(volunteer) {
    const currentPresence = normalizePresenceRecord(volunteer.presence);
    if (isPresenceLocked(currentPresence)) return;

    if (isBadgeHandedOver(volunteer.id)) {
      await setBadgeHandedOver(volunteer.id, false);
    }

    await updateVolunteerPresence(
      volunteer,
      {
        status: "absent",
        checkedInAt: null,
        checkedInBy: "",
        accreditationDeliveredAt: null,
        accreditationDeliveredBy: "",
        tshirtDeliveredAt: null,
        tshirtDeliveredBy: "",
        lunchCollectedAt: null,
        lunchCollectedBy: "",
        departureTime: "",
        departureRecordedAt: null,
        departureRecordedBy: "",
      },
      `${volunteer.firstName} ${volunteer.lastName}`.trim() + " repassé(e) absent(e).",
    );
  }

  async function togglePresenceStamp(volunteer, field, successMessage) {
    const currentPresence = normalizePresenceRecord(volunteer.presence);
    if (isPresenceLocked(currentPresence)) return;
    const actorField = {
      accreditationDeliveredAt: "accreditationDeliveredBy",
      tshirtDeliveredAt: "tshirtDeliveredBy",
      lunchCollectedAt: "lunchCollectedBy",
    }[field];
    const nextValue = currentPresence[field] ? null : new Date().toISOString();

    await updateVolunteerPresence(
      volunteer,
      {
        [field]: nextValue,
        ...(actorField ? { [actorField]: nextValue ? actorId : "" } : {}),
      },
      successMessage,
    );
  }

  async function saveDepartureTime(volunteer, explicitValue) {
    const currentPresence = normalizePresenceRecord(volunteer.presence);
    if (isPresenceLocked(currentPresence)) return;

    const nextValue = String(explicitValue ?? departureDrafts[volunteer.id] ?? "").trim();
    setDepartureDrafts((current) => ({
      ...current,
      [volunteer.id]: nextValue,
    }));

    await updateVolunteerPresence(
      volunteer,
      {
        departureTime: nextValue,
        departureRecordedAt: nextValue ? new Date().toISOString() : null,
        departureRecordedBy: nextValue ? actorId : "",
      },
      nextValue
        ? `Horaire de départ enregistré pour ${`${volunteer.firstName} ${volunteer.lastName}`.trim()}.`
        : `Horaire de départ supprimé pour ${`${volunteer.firstName} ${volunteer.lastName}`.trim()}.`,
    );
  }

  async function saveArrivalTime(volunteer, explicitValue) {
    const currentPresence = normalizePresenceRecord(volunteer.presence);
    if (isPresenceLocked(currentPresence) || !canManageAllTeams) return;

    const nextValue = String(explicitValue ?? arrivalDrafts[volunteer.id] ?? "").trim();
    setArrivalDrafts((current) => ({
      ...current,
      [volunteer.id]: nextValue,
    }));

    let nextCheckedInAt = null;
    if (nextValue) {
      const baseTimestamp = getTimestampMs(currentPresence.checkedInAt) || Date.now();
      const baseDate = new Date(baseTimestamp);
      const [hours, minutes] = nextValue.split(":").map((item) => Number(item));
      if (Number.isFinite(hours) && Number.isFinite(minutes)) {
        baseDate.setHours(hours, minutes, 0, 0);
        nextCheckedInAt = baseDate.toISOString();
      }
    }

    await updateVolunteerPresence(
      volunteer,
      {
        status: nextCheckedInAt ? "present" : currentPresence.status,
        checkedInAt: nextCheckedInAt,
        checkedInBy: nextCheckedInAt ? actorId : "",
      },
      nextCheckedInAt
        ? `Horaire d'arrivée enregistré pour ${`${volunteer.firstName} ${volunteer.lastName}`.trim()}.`
        : `Horaire d'arrivée supprimé pour ${`${volunteer.firstName} ${volunteer.lastName}`.trim()}.`,
    );
  }

  async function completeMission(volunteer) {
    const currentPresence = normalizePresenceRecord(volunteer.presence);
    if (isPresenceLocked(currentPresence)) return;

    await updateVolunteerPresence(
      volunteer,
      {
        missionCompletedAt: new Date().toISOString(),
        missionCompletedBy: actorId,
      },
      `Mission terminée pour ${`${volunteer.firstName} ${volunteer.lastName}`.trim()}. La fiche est maintenant verrouillée.`,
    );
  }

  function openCertificate(volunteer) {
    if (typeof window === "undefined") return;

    const roundedHours = getRoundedParticipationHours(volunteer.presence, getTimestampMs);
    if (!roundedHours) {
      setStatusMessage("Le certificat nécessite une arrivée et un horaire de départ cohérents.");
      return;
    }

    const printWindow = window.open("", "_blank", "width=1100,height=850");
    if (!printWindow) return;

    const markup = buildParticipationCertificateMarkup({
      fullName: `${volunteer.firstName} ${volunteer.lastName}`.trim(),
      teamName: selectedRole?.roleName || volunteer.primaryTeam,
      roleLabel: volunteer.scopedTeamRole,
      roundedHours,
      signatory: signatoryName,
      signatoryTitle,
      signatureImageUrl,
      editionLabel: activeEditionId ? `Edition ${activeEditionId}` : "",
    });

    printWindow.document.write(markup);
    printWindow.document.close();
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Jour J</p>
          <h1>Présences</h1>
          <p>Vue opérationnelle pour l'accueil, les sandwichs et les départs d'équipe.</p>
          {teamsLoading || usersLoading ? <p className="panel-note">Chargement des présences...</p> : null}
          {teamsError || usersError ? <p className="panel-note">{teamsError || usersError}</p> : null}
          {statusMessage ? <p className="panel-note">{statusMessage}</p> : null}
          {isSaving ? <p className="panel-note">Sauvegarde en cours...</p> : null}
        </div>
      </section>

      <section className="metric-grid metric-grid--3">
        <article className="metric-card metric-card--accent">
          <span>Bénévoles visibles</span>
          <strong>{volunteersWithTeams.length}</strong>
        </article>
        <article className="metric-card metric-card--warn">
          <span>Présents</span>
          <strong>{presentCount}</strong>
        </article>
        <article className="metric-card">
          <span>Sandwichs récupérés</span>
          <strong>{lunchCount}</strong>
        </article>
      </section>

      <Panel
        title="Filtrer et rechercher"
        subtitle={
          canManageAllTeams
            ? "Les gestionnaires et administrateurs voient toutes les équipes."
            : "En tant que chef d'équipe, tu ne vois que les équipes dont tu es responsable."
        }
      >
        <div className="presence-toolbar">
          <div className="presence-toolbar__filters">
            <label className="field">
              <span>Recherche</span>
              <input
                type="search"
                placeholder="Nom, prénom, email..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Équipe</span>
              <select value={effectiveSelectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>
                {canManageAllTeams ? <option value="">Toutes les équipes</option> : null}
                {availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.roleName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="team-selection-summary" aria-live="polite">
            <div className="team-summary-pill">
              <strong>{filteredVolunteers.length}</strong>
              <span>Résultats</span>
            </div>
            <div className="team-summary-pill">
              <strong>{selectedTeamPresentCount}</strong>
              <span>Présents</span>
            </div>
            <div className="team-summary-pill">
              <strong>{lunchVolunteers.filter((volunteer) => volunteer.presence.lunchCollectedAt).length}</strong>
              <span>Sandwichs pointés</span>
            </div>
            <div className="team-summary-pill">
              <strong>{departureVolunteers.filter((volunteer) => volunteer.presence.missionCompletedAt).length}</strong>
              <span>Missions terminées</span>
            </div>
          </div>
        </div>
      </Panel>

      {canManageAllTeams ? (
        <div className="admin-subtabs" role="tablist" aria-label="Navigation du module Présences">
          <button
            type="button"
            className={`admin-subtab ${effectivePresenceTab === "welcome" ? "admin-subtab--active" : ""}`}
            onClick={() => setActivePresenceTab("welcome")}
          >
            Accueil
          </button>
          <button
            type="button"
            className={`admin-subtab ${effectivePresenceTab === "lunch" ? "admin-subtab--active" : ""}`}
            onClick={() => setActivePresenceTab("lunch")}
          >
            Sandwichs
          </button>
          <button
            type="button"
            className={`admin-subtab ${effectivePresenceTab === "departures" ? "admin-subtab--active" : ""}`}
            onClick={() => setActivePresenceTab("departures")}
          >
            Départs équipes
          </button>
        </div>
      ) : null}

      {canManageAllTeams && effectivePresenceTab === "welcome" ? (
        <section className="panel-grid panel-grid--1">
          <Panel title="Accueil bénévoles" subtitle="Tableau de check-in et pointage du welcome pack.">
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Bénévole</th>
                    <th>Équipe</th>
                    <th>Présence</th>
                    <th>Arrivée</th>
                    <th>Actions</th>
                    <th>Welcome pack</th>
                  </tr>
                </thead>
                <tbody>
                  {welcomeVolunteers.length ? (
                    visibleWelcomeVolunteers.map((volunteer) => {
                      const locked = isPresenceLocked(volunteer.presence);
                      return (
                        <tr key={volunteer.id} className={volunteer.presence.status === "present" ? "data-table__row--success" : ""}>
                          <td>
                            <div className="table-stack">
                              <strong>{`${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email}</strong>
                              <span>{volunteer.email || volunteer.phone || "Sans contact"}</span>
                            </div>
                          </td>
                          <td>
                            <div className="table-stack">
                              <strong>{volunteer.primaryTeam}</strong>
                              <span>{volunteer.scopedTeamRole}</span>
                            </div>
                          </td>
                          <td>
                            <span className={getPresenceStatusClass(volunteer.presence.status, normalizeComparableValue)}>
                              {getPresenceStatusLabel(volunteer.presence.status, normalizeComparableValue)}
                            </span>
                          </td>
                          <td>{volunteer.presence.checkedInAt ? formatDateTimeForDisplay(volunteer.presence.checkedInAt) : "Non pointé"}</td>
                          <td>
                            <div className="presence-action-grid">
                              <button className="button button--secondary" type="button" disabled={locked} onClick={() => markVolunteerPresent(volunteer)}>
                                Présent
                              </button>
                              <button className="button button--ghost" type="button" disabled={locked} onClick={() => markVolunteerAbsent(volunteer)}>
                                Absent
                              </button>
                            </div>
                          </td>
                          <td>
                            <button
                              className="button button--primary"
                              type="button"
                              disabled={locked}
                              onClick={() => toggleWelcomePack(volunteer)}
                            >
                              {isBadgeHandedOver(volunteer.id) && volunteer.presence.tshirtDeliveredAt
                                ? "Remis"
                                : "Welcome pack"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="6">{normalizedSearch ? "Aucun bénévole trouvé." : "Aucun bénévole sur ce périmètre."}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("presence-welcome", welcomeVolunteers) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("presence-welcome")}
                >
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}
          </Panel>
        </section>
      ) : null}

      {canManageAllTeams && effectivePresenceTab === "lunch" ? (
        <section className="panel-grid panel-grid--1">
          <Panel title="Sandwichs" subtitle="Pointage rapide des sandwichs remis aux bénévoles déjà arrivés.">
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Bénévole</th>
                    <th>Équipe</th>
                    <th>Arrivée</th>
                    <th>Sandwich</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lunchVolunteers.length ? (
                    visibleLunchVolunteers.map((volunteer) => {
                      const locked = isPresenceLocked(volunteer.presence);
                      return (
                        <tr key={volunteer.id} className={volunteer.presence.lunchCollectedAt ? "data-table__row--success" : ""}>
                          <td>
                            <div className="table-stack">
                              <strong>{`${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email}</strong>
                              <span>{volunteer.scopedTeamRole}</span>
                            </div>
                          </td>
                          <td>{volunteer.primaryTeam}</td>
                          <td>{volunteer.presence.checkedInAt ? formatDateTimeForDisplay(volunteer.presence.checkedInAt) : "Non pointé"}</td>
                          <td>{volunteer.presence.lunchCollectedAt ? formatDateTimeForDisplay(volunteer.presence.lunchCollectedAt) : "Non récupéré"}</td>
                          <td>
                            <button
                              className="button button--secondary"
                              type="button"
                              disabled={locked}
                              onClick={() =>
                                togglePresenceStamp(
                                  volunteer,
                                  "lunchCollectedAt",
                                  `Statut sandwich mis à jour pour ${`${volunteer.firstName} ${volunteer.lastName}`.trim()}.`,
                                )
                              }
                            >
                              {volunteer.presence.lunchCollectedAt ? "Annuler" : "Sandwich remis"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="5">Aucun bénévole présent à pointer pour les sandwichs.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("presence-lunch", lunchVolunteers) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("presence-lunch")}
                >
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}
          </Panel>
        </section>
      ) : null}

      {effectivePresenceTab === "departures" ? (
      <Panel title="Départs d'équipe" subtitle="Les chefs d'équipe et les gestionnaires enregistrent ici les départs et la fin de mission.">
        {selectedRole || canManageAllTeams ? (
          <>
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Bénévole</th>
                    <th>Équipe</th>
                    <th>Présence</th>
                    <th>Arrivée</th>
                    <th>Départ</th>
                    <th>Mission</th>
                    <th>Certificat</th>
                  </tr>
                </thead>
                <tbody>
                  {departureVolunteers.length ? (
                    visibleDepartureVolunteers.map((volunteer) => {
                      const locked = isPresenceLocked(volunteer.presence);
                      const roundedHours = getRoundedParticipationHours(volunteer.presence, getTimestampMs);
                      return (
                        <tr key={volunteer.id} className={volunteer.presence.status === "present" ? "data-table__row--success" : ""}>
                          <td>
                            <div className="table-stack">
                              <strong>{`${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email}</strong>
                              <span>{volunteer.email || volunteer.phone || "Sans contact"}</span>
                            </div>
                          </td>
                          <td>
                            <div className="table-stack">
                              <strong>{volunteer.primaryTeam}</strong>
                              <span>{volunteer.scopedTeamRole}</span>
                            </div>
                          </td>
                          <td>
                            <div className="table-stack">
                              <span className={getPresenceStatusClass(volunteer.presence.status, normalizeComparableValue)}>
                                {getPresenceStatusLabel(volunteer.presence.status, normalizeComparableValue)}
                              </span>
                              <span>{volunteer.presence.checkedInAt ? formatDateTimeForDisplay(volunteer.presence.checkedInAt) : "Non pointé"}</span>
                            </div>
                          </td>
                          <td>
                            {canManageAllTeams ? (
                              <div className="table-actions">
                                <input
                                  type="time"
                                  value={arrivalDrafts[volunteer.id] ?? formatPresenceDateForInput(volunteer.presence.checkedInAt)}
                                  disabled={locked}
                                  onChange={(event) =>
                                    setArrivalDrafts((current) => ({
                                      ...current,
                                      [volunteer.id]: event.target.value,
                                    }))
                                  }
                                  onBlur={(event) => saveArrivalTime(volunteer, event.target.value)}
                                />
                                <span>{volunteer.presence.checkedInAt ? formatDateTimeForDisplay(volunteer.presence.checkedInAt) : "Non pointé"}</span>
                              </div>
                            ) : (
                              <span>{volunteer.presence.checkedInAt ? formatDateTimeForDisplay(volunteer.presence.checkedInAt) : "Non pointé"}</span>
                            )}
                          </td>
                          <td>
                            <div className="table-actions">
                              <input
                                type="time"
                                value={departureDrafts[volunteer.id] ?? volunteer.presence.departureTime ?? ""}
                                disabled={locked}
                                onChange={(event) =>
                                  setDepartureDrafts((current) => ({
                                    ...current,
                                    [volunteer.id]: event.target.value,
                                  }))
                                }
                                onBlur={(event) => saveDepartureTime(volunteer, event.target.value)}
                              />
                              <span>{formatTimeForDisplay(volunteer.presence.departureTime)}</span>
                            </div>
                          </td>
                          <td>
                            <div className="table-actions">
                              <span>{locked ? `Terminée le ${formatDateTimeForDisplay(volunteer.presence.missionCompletedAt)}` : "En cours"}</span>
                              <button
                                className="button button--primary"
                                type="button"
                                disabled={locked}
                                onClick={() => completeMission(volunteer)}
                              >
                                Mission terminée
                              </button>
                            </div>
                          </td>
                          <td>
                            <div className="table-actions">
                              <span>{roundedHours ? `${roundedHours} h` : "Non calculable"}</span>
                              <button
                                className="button button--secondary"
                                type="button"
                                disabled={!roundedHours}
                                onClick={() => openCertificate(volunteer)}
                              >
                                Générer
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="7">
                        {normalizedSearch ? "Aucun bénévole ne correspond à cette recherche." : "Aucun bénévole visible sur ce périmètre."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("presence-departures", departureVolunteers) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("presence-departures")}
                >
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="panel-note">
            {canManageAllTeams
              ? "Aucune équipe n'est configurée pour le moment."
              : "Aucune équipe chef d'équipe n'est liée à ce profil."}
          </p>
        )}
      </Panel>
      ) : null}
    </div>
  );
}

function CertificateSettingsPage(props) {
  const { AuthFormField, Panel } = props;
  const { signatoryName, signatoryTitle, signatureImageUrl, loading, error } = useCertificateConfiguration();
  const [form, setForm] = useState({ signatoryName: "", signatoryTitle: "", signatureImageUrl: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (loading) return;
    setForm({ signatoryName, signatoryTitle, signatureImageUrl });
  }, [loading, signatoryName, signatoryTitle, signatureImageUrl]);

  function handleFieldChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSave(event) {
    event.preventDefault();
    setIsSaving(true);
    setStatusMessage("");

    try {
      await setDoc(
        doc(db, ...CERTIFICATE_CONFIGURATION_DOC_PATH),
        {
          signatoryName: form.signatoryName.trim(),
          signatoryTitle: form.signatoryTitle.trim(),
          signatureImageUrl: form.signatureImageUrl.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setStatusMessage("Réglages du certificat enregistrés.");
    } catch (saveError) {
      console.error("Impossible d'enregistrer les réglages du certificat.", saveError);
      setStatusMessage("Impossible d'enregistrer les réglages du certificat.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Réglages</p>
          <h1>Certificat de participation</h1>
          <p>Nom, titre et signature affichés sur le certificat remis aux bénévoles depuis "Départs équipes".</p>
        </div>
      </section>

      {loading ? <p className="panel-note">Chargement...</p> : null}
      {error ? <p className="panel-note">{error}</p> : null}

      <Panel
        title="Signataire du certificat"
        subtitle="Ces informations remplacent les valeurs par défaut sur tous les certificats générés, y compris ceux que les bénévoles téléchargent eux-mêmes."
      >
        <form className="auth-form auth-form--compact" onSubmit={handleSave}>
          <AuthFormField label="Nom du signataire">
            <input
              name="signatoryName"
              placeholder="Ex : Responsable bénévoles"
              value={form.signatoryName}
              onChange={handleFieldChange}
            />
          </AuthFormField>
          <AuthFormField label="Titre affiché sous le nom">
            <input
              name="signatoryTitle"
              placeholder="Ex : Head of CMCM Luxembourg Indoor Meeting"
              value={form.signatoryTitle}
              onChange={handleFieldChange}
            />
          </AuthFormField>
          <div className="field">
            <span>Image de signature (PNG)</span>
            <FileUpload
              value={form.signatureImageUrl}
              onChange={(url) => setForm((current) => ({ ...current, signatureImageUrl: url }))}
              accept="image/png"
              storagePath="certificate-signatures"
              label="Signature"
              helperText="PNG avec fond transparent recommandé · Max 20 Mo"
            />
          </div>
          {form.signatureImageUrl ? (
            <div className="accreditation-inline-panel">
              <strong>Aperçu</strong>
              <img
                src={form.signatureImageUrl}
                alt="Aperçu de la signature"
                style={{ maxWidth: "220px", maxHeight: "100px", objectFit: "contain" }}
              />
            </div>
          ) : null}
          {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
          <div className="panel-actions">
            <button className="button button--primary" type="submit" disabled={isSaving}>
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

export { CertificateSettingsPage, PresencePage, RoleManagementPage, TeamsPage };
