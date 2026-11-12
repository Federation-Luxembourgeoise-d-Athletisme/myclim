import { useEffect, useMemo, useRef, useState } from "react";
import { searchUserAccounts } from "./organisation-hooks";
import { platformRoleOptions } from "./seed-data";

// « Ajouter quelqu'un » dans une carte d'équipe (Affectations). Margot,
// 12/11/2026 : la liste déroulante devient trop longue et on doit pouvoir
// mettre n'importe qui. Champ vide : les bénévoles pas encore affectés.
// En tapant : tout le monde (bénévoles déjà dans une autre équipe, et tout
// compte MyCLIM sans candidature). Une personne qui a déjà une équipe ou un
// rôle passe par une ligne « Attention » à confirmer avant l'ajout.

const ROLE_LABELS = Object.fromEntries(platformRoleOptions.map((role) => [role.value, role.label]));
// Rôles qui méritent un avertissement (pas les rôles bénévoles de base).
const QUIET_ROLES = new Set(["benevole", "parent_u14", "athlete_preprogram"]);

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function fullName(person) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email || "—";
}

function roleWarnings(userTypes = []) {
  return userTypes.filter((role) => !QUIET_ROLES.has(role)).map((role) => ROLE_LABELS[role] || role);
}

export function TeamAddPicker({ teamName, volunteers, getAssignedTeams, onAddVolunteer, onAddAccount }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [accounts, setAccounts] = useState({ needle: "", users: [] });
  const [pending, setPending] = useState(null);
  const boxRef = useRef(null);
  const needle = normalize(text.trim());

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) {
        setOpen(false);
        setPending(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (needle.length < 2) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchUserAccounts(text)
        .then((users) => !cancelled && setAccounts({ needle, users }))
        .catch(() => !cancelled && setAccounts({ needle, users: [] }));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needle, text]);

  const items = useMemo(() => {
    const candidates = volunteers.filter((volunteer) => !getAssignedTeams(volunteer).includes(teamName));
    if (needle.length < 2) {
      return candidates
        .filter((volunteer) => getAssignedTeams(volunteer).length === 0)
        .slice(0, 40)
        .map((volunteer) => ({ key: `v:${volunteer.id}`, kind: "volunteer", person: volunteer, warnings: [] }));
    }
    const matching = candidates.filter((volunteer) => normalize(`${fullName(volunteer)} ${volunteer.email}`).includes(needle));
    const known = new Set(volunteers.flatMap((volunteer) => [volunteer.uid, normalize(volunteer.email)]).filter(Boolean));
    const fromVolunteers = matching.map((volunteer) => {
      const teams = getAssignedTeams(volunteer);
      return { key: `v:${volunteer.id}`, kind: "volunteer", person: volunteer, warnings: teams.length ? [`déjà dans ${teams.join(", ")}`] : [] };
    });
    const fromAccounts = (accounts.needle === needle ? accounts.users : [])
      .filter((user) => !known.has(user.id) && !known.has(normalize(user.email)))
      .map((user) => {
        const roles = roleWarnings(Array.isArray(user.userTypes) ? user.userTypes : []);
        return {
          key: `u:${user.id}`,
          kind: "account",
          person: user,
          warnings: ["pas de candidature bénévole", ...(roles.length ? [`rôle ${roles.join(", ")}`] : [])],
        };
      });
    return [...fromVolunteers, ...fromAccounts].slice(0, 40);
  }, [accounts, getAssignedTeams, needle, teamName, volunteers]);

  function choose(item) {
    // Une personne déjà dans une équipe, ou avec un rôle : on confirme d'abord.
    const needsConfirm = item.kind === "account" ? item.warnings.length > 1 : item.warnings.length > 0;
    if (needsConfirm && pending?.key !== item.key) {
      setPending(item);
      return;
    }
    if (item.kind === "volunteer") onAddVolunteer(item.person.id, teamName);
    else onAddAccount(item.person, teamName);
    setText("");
    setPending(null);
    setOpen(false);
  }

  const searching = needle.length >= 2 && accounts.needle !== needle;

  return (
    <div className="assign-pick" ref={boxRef}>
      <input
        aria-label={`Ajouter quelqu'un à ${teamName}`}
        className="assign-pick__input"
        placeholder="Ajouter quelqu'un… (tapez un nom pour chercher partout)"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setPending(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setPending(null);
          }
        }}
      />
      {open ? (
        <div className="assign-pick__menu" role="listbox">
          <p className="assign-pick__hint">
            {needle.length < 2 ? "Bénévoles pas encore affectés" : searching ? "Recherche dans tous les comptes…" : "Bénévoles et comptes MyCLIM"}
          </p>
          {items.length === 0 && !searching ? (
            <p className="assign-pick__empty">
              {needle.length < 2 ? "Tout le monde est affecté. Tapez un nom pour chercher partout." : "Personne. Pour quelqu'un sans compte : « + Personne sans candidature »."}
            </p>
          ) : null}
          {items.map((item) => (
            <div key={item.key} className={`assign-pick__item${pending?.key === item.key ? " assign-pick__item--pending" : ""}`}>
              <button type="button" onClick={() => choose(item)}>
                <strong>{fullName(item.person)}</strong>
                {item.kind === "account" ? <span className="assign-pick__tag">compte</span> : null}
                {item.warnings.length ? <small>{item.warnings.join(" · ")}</small> : null}
              </button>
              {pending?.key === item.key ? (
                <div className="assign-pick__confirm">
                  <span>
                    Attention : {item.warnings.join(", ")}. L'ajouter quand même à {teamName} ?
                  </span>
                  <button className="assign-pick__ok" type="button" onClick={() => choose(item)}>
                    Ajouter
                  </button>
                  <button className="assign-pick__cancel" type="button" onClick={() => setPending(null)}>
                    Annuler
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
