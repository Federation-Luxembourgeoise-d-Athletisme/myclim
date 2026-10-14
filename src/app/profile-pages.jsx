import { useEffect, useMemo, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { NavLink } from "react-router-dom";
import { getEditionLabel, normalizeEditionId, useActiveEdition, useVolunteerRoleOptions } from "./edition";
import { formatVolunteerApplicationStatus } from "./common-helpers";
import { AuthFormField, PhoneInput } from "./form-components";
import {
  buildVolunteerApplicationPayload,
  createEmptyVolunteerProfileFormData,
  createVolunteerProfileFormData,
  formatRoleLabel,
  formatVolunteerSupportAvailabilityOption,
} from "./volunteer-helpers";
import { useVolunteerApplication } from "./volunteer-hooks";
import { VOLUNTEER_LANGUAGE_OPTIONS, buildUserSearchTokens, getAgeFromBirthDate, getVolunteerLanguageOptionLabel } from "./utils";
import { useLanguage } from "./language-context";
import { getActiveRoles } from "./navigation";
import { useAuth } from "../context/auth-context";
import { auth, db } from "../services/firebase";

function compareAssignmentEditionIds(leftEditionId, rightEditionId) {
  const leftNormalized = normalizeEditionId(leftEditionId);
  const rightNormalized = normalizeEditionId(rightEditionId);
  const leftNumeric = Number(leftNormalized);
  const rightNumeric = Number(rightNormalized);

  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric) && leftNumeric !== rightNumeric) {
    return rightNumeric - leftNumeric;
  }

  if (leftNormalized === "test" && rightNormalized !== "test") return 1;
  if (rightNormalized === "test" && leftNormalized !== "test") return -1;
  return rightNormalized.localeCompare(leftNormalized, "fr");
}

function normalizeAssignmentHistoryEntries(historyByEdition) {
  if (!historyByEdition || typeof historyByEdition !== "object" || Array.isArray(historyByEdition)) return [];

  return Object.entries(historyByEdition)
    .map(([editionId, entry]) => {
      const normalizedEntry = entry && typeof entry === "object" ? entry : {};
      const assignedTeams = Array.isArray(normalizedEntry.assignedTeams)
        ? normalizedEntry.assignedTeams.map((team) => String(team || "").trim()).filter(Boolean)
        : [];
      const teamRoleAssignments =
        normalizedEntry.teamRoleAssignments && typeof normalizedEntry.teamRoleAssignments === "object"
          ? normalizedEntry.teamRoleAssignments
          : {};

      return {
        editionId: normalizeEditionId(normalizedEntry.editionId || editionId),
        assignedRole: String(normalizedEntry.assignedRole || "").trim(),
        assignedTeams,
        assignmentStatus: String(normalizedEntry.assignmentStatus || "").trim(),
        teamRole: String(normalizedEntry.teamRole || "").trim(),
        teamRoleAssignments: Object.entries(teamRoleAssignments)
          .map(([teamName, teamRole]) => ({
            teamName: String(teamName || "").trim(),
            teamRole: String(teamRole || "").trim(),
          }))
          .filter((row) => row.teamName && row.teamRole),
      };
    })
    .filter((entry) => entry.assignedRole || entry.assignedTeams.length || entry.teamRoleAssignments.length)
    .sort((left, right) => compareAssignmentEditionIds(left.editionId, right.editionId));
}

function VolunteerProfilePage(props) {
  const {
    Panel,
    VOLUNTEER_SUPPORT_AVAILABILITY_OPTIONS,
    loadMailQueueModule,
  } = props;
  const { currentUser, userProfile } = useAuth();
  const { t, language } = useLanguage();
  const { application: volunteerApplication, loading, error } = useVolunteerApplication(currentUser?.uid);
  const { activeEditionId, activeEditionLabel } = useActiveEdition(Boolean(currentUser?.uid));
  const volunteerRoleOptions = useVolunteerRoleOptions();
  const [formData, setFormData] = useState(createEmptyVolunteerProfileFormData);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const volunteerAge = getAgeFromBirthDate(formData.birthDate);
  const isUnder14Volunteer = volunteerAge !== null && volunteerAge < 14;
  const isMinorVolunteer = volunteerAge !== null && volunteerAge >= 14 && volunteerAge < 18;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFormData(createVolunteerProfileFormData(volunteerApplication, userProfile));
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [userProfile, volunteerApplication]);

  function handleChange(event) {
    const { name, type, checked, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setStatusMessage("");
    setErrorMessage("");
  }

  function toggleAvailabilityOption(option) {
    setFormData((current) => ({
      ...current,
      availability: current.availability.includes(option)
        ? current.availability.filter((item) => item !== option)
        : [...current.availability, option],
    }));
    setStatusMessage("");
    setErrorMessage("");
  }

  function toggleMissionPreferenceOption(option) {
    setFormData((current) => ({
      ...current,
      missionPreferences: current.missionPreferences.includes(option)
        ? current.missionPreferences.filter((item) => item !== option)
        : [...current.missionPreferences, option],
    }));
    setStatusMessage("");
    setErrorMessage("");
  }

  function toggleLanguageOption(option) {
    setFormData((current) => ({
      ...current,
      languages: current.languages.includes(option)
        ? current.languages.filter((item) => item !== option)
        : [...current.languages, option],
      otherLanguage:
        option === "Autre" && current.languages.includes(option) ? "" : current.otherLanguage,
    }));
    setStatusMessage("");
    setErrorMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!currentUser?.uid) return;

    if (!formData.meetingDayConfirmed) {
      setErrorMessage(t("errorSundayConfirmRequired"));
      return;
    }

    if (isUnder14Volunteer) {
      setErrorMessage(t("under14Body"));
      return;
    }

    if (!formData.imageConsent) {
      setErrorMessage(t("errorImageConsentRequired"));
      return;
    }

    setIsSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    const normalizedRoles = [
      ...new Set([...getActiveRoles(userProfile), "benevole"]),
    ];
    const { age, applicationStatus, legalGuardianRequired, applicationPayload } =
      buildVolunteerApplicationPayload({
        currentUser,
        formData,
        status: volunteerApplication?.status,
      });

    try {
      await setDoc(
        doc(db, "users", currentUser.uid),
        {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          phone: formData.phone.trim(),
          birthDate: formData.birthDate,
          age,
          accountStatus: applicationStatus,
          isMinorVolunteer: legalGuardianRequired,
          legalGuardianRequired,
          userTypes: normalizedRoles,
          searchTokens: buildUserSearchTokens({
            firstName: formData.firstName.trim(),
            lastName: formData.lastName.trim(),
            email: currentUser.email || "",
          }),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      if (volunteerApplication?.id) {
        await updateDoc(doc(db, "volunteerApplications", volunteerApplication.id), applicationPayload);
      } else {
        await addDoc(collection(db, "volunteerApplications"), {
          editionId: activeEditionId,
          ...applicationPayload,
          submittedAt: serverTimestamp(),
        });
      }

      setStatusMessage(volunteerApplication?.id ? t("vpSaved") : t("vpCreated"));

      try {
        const { buildVolunteerModuleCompletedMail, enqueueTransactionalMail } = await loadMailQueueModule();
        await enqueueTransactionalMail(
          buildVolunteerModuleCompletedMail({
            email: currentUser.email,
            firstName: formData.firstName,
            missionPreferences: applicationPayload.missionPreferences,
            availability: applicationPayload.availability,
            status: applicationStatus,
          }),
        );
      } catch (mailError) {
        console.error("Volunteer module email could not be sent", mailError);
      }
    } catch (saveError) {
      console.error("Volunteer module save failed", saveError);
      setErrorMessage(
        `${t("vpSaveError")} ${saveError?.message ? `(${saveError.message})` : ""}`.trim(),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{t("vpEyebrow")}</p>
          <h1>{volunteerApplication ? t("vpTitleExisting") : t("vpTitleNew")}</h1>
          <p>{volunteerApplication ? t("vpIntroExisting") : t("vpIntroNew")}</p>
        </div>
        {volunteerApplication ? (
          <div className="status-cluster">
            <span className="status-pill status-pill--accent">
              {formatVolunteerApplicationStatus(volunteerApplication.status, t)}
            </span>
          </div>
        ) : null}
      </section>

      <section className="panel-grid panel-grid--2">
        <Panel title={t("vpStatusPanelTitle")}>
          <dl className="detail-list">
            <div>
              <dt>{t("vpAccountUsed")}</dt>
              <dd>{currentUser?.email}</dd>
            </div>
            <div>
              <dt>{t("vpVolunteerStatus")}</dt>
              <dd>{volunteerApplication ? formatVolunteerApplicationStatus(volunteerApplication.status, t) : t("vpNotStarted")}</dd>
            </div>
            <div>
              <dt>{t("vpActiveEdition")}</dt>
              <dd>{activeEditionLabel}</dd>
            </div>
            <div>
              <dt>{t("vpActiveRole")}</dt>
              <dd>{getActiveRoles(userProfile).map((role) => formatRoleLabel(role, t)).join(", ")}</dd>
            </div>
          </dl>
          {error ? <p className="panel-note">{error}</p> : null}
          {loading ? <p className="panel-note">{t("vpLoading")}</p> : null}
        </Panel>

        <Panel title={t("vpModulePanelTitle")}>
          <ul className="compact-list">
            <li>{t("vpModuleItemCreate")}</li>
            <li>{t("vpModuleItemFind")}</li>
            <li>{t("vpModuleItemUpdate")}</li>
          </ul>
        </Panel>
      </section>

      <Panel title={t("vpInfoPanelTitle")} subtitle={t("vpInfoPanelSubtitle")}>
        <form className="profile-form" onSubmit={handleSubmit}>
          <div className="panel-grid panel-grid--2">
            <AuthFormField label={t("fieldFirstName")}>
              <input name="firstName" onChange={handleChange} required value={formData.firstName} />
            </AuthFormField>
            <AuthFormField label={t("fieldLastName")}>
              <input name="lastName" onChange={handleChange} required value={formData.lastName} />
            </AuthFormField>
          </div>

          <div className="panel-grid panel-grid--2">
            <AuthFormField label={t("fieldEmail")}>
              <input disabled value={currentUser?.email || ""} />
            </AuthFormField>
            <AuthFormField label={t("fieldPhone")}>
              <PhoneInput name="phone" onChange={handleChange} required value={formData.phone} />
            </AuthFormField>
          </div>

          <div className="panel-grid panel-grid--2">
            <AuthFormField label={t("fieldBirthDate")}>
              <input name="birthDate" onChange={handleChange} required type="date" value={formData.birthDate} />
            </AuthFormField>
            <AuthFormField label={t("fieldGender")}>
              <select name="gender" onChange={handleChange} value={formData.gender}>
                <option value="">{t("fieldSelectPlaceholder")}</option>
                <option value="femme">{t("genderFemale")}</option>
                <option value="homme">{t("genderMale")}</option>
                <option value="autre">{t("otherLabel")}</option>
              </select>
            </AuthFormField>
          </div>

          {volunteerAge !== null ? (
            <div className={`notice-card${isUnder14Volunteer ? " notice-card--danger" : isMinorVolunteer ? " notice-card--warn" : " notice-card--ok"}`}>
              <strong>
                {isUnder14Volunteer ? t("under14Title") : isMinorVolunteer ? t("minorTitle") : t("adultTitle")}
              </strong>
              <p>
                {isUnder14Volunteer ? t("under14Body") : isMinorVolunteer ? t("minorBody") : t("adultBody")}
              </p>
              {isUnder14Volunteer ? (
                <div className="auth-links">
                  <NavLink className="button button--secondary button-link" to="/pre-programme">
                    {t("createParentAccountLink")}
                  </NavLink>
                </div>
              ) : null}
            </div>
          ) : null}

          {isMinorVolunteer ? (
            <section className="minor-guardian-card">
              <div className="form-section-head">
                <p className="eyebrow">{t("guardianEyebrow")}</p>
                <h3>{t("guardianHeading")}</h3>
              </div>
              <div className="panel-grid panel-grid--2">
                <AuthFormField label={t("guardianFirstNameLabel")}>
                  <input
                    name="guardianFirstName"
                    onChange={handleChange}
                    required={isMinorVolunteer}
                    value={formData.guardianFirstName}
                  />
                </AuthFormField>
                <AuthFormField label={t("guardianLastNameLabel")}>
                  <input
                    name="guardianLastName"
                    onChange={handleChange}
                    required={isMinorVolunteer}
                    value={formData.guardianLastName}
                  />
                </AuthFormField>
              </div>
              <div className="panel-grid panel-grid--2">
                <AuthFormField label={t("guardianEmailLabel")}>
                  <input
                    name="guardianEmail"
                    onChange={handleChange}
                    required={isMinorVolunteer}
                    type="email"
                    value={formData.guardianEmail}
                  />
                </AuthFormField>
                <AuthFormField label={t("guardianPhoneLabel")}>
                  <PhoneInput
                    name="guardianPhone"
                    onChange={handleChange}
                    required={isMinorVolunteer}
                    value={formData.guardianPhone}
                  />
                </AuthFormField>
              </div>
            </section>
          ) : null}

          <div className="panel-grid panel-grid--2">
            <div className="language-card">
              <div className="form-section-head">
                <p className="eyebrow">{t("languagesEyebrow")}</p>
                <h3>{t("languagesHeading")}</h3>
              </div>
              <div className="choice-grid">
                {VOLUNTEER_LANGUAGE_OPTIONS.map((option) => (
                  <label key={option} className="selection-card selection-card--compact">
                    <input
                      checked={formData.languages.includes(option)}
                      type="checkbox"
                      onChange={() => toggleLanguageOption(option)}
                    />
                    <div>
                      <strong>{getVolunteerLanguageOptionLabel(option, language)}</strong>
                    </div>
                  </label>
                ))}
              </div>
              {formData.languages.includes("Autre") ? (
                <AuthFormField label={t("otherLanguageLabel")}>
                  <input name="otherLanguage" onChange={handleChange} value={formData.otherLanguage} />
                </AuthFormField>
              ) : null}
            </div>
            <div className="lunex-card">
              <div className="form-section-head">
                <p className="eyebrow">{t("lunexEyebrow")}</p>
                <h3>{t("lunexHeading")}</h3>
              </div>
              <div className="lunex-choice-row">
                <label className="selection-card selection-card--inline">
                  <input
                    checked={formData.lunexStudent === "oui"}
                    name="lunexStudent"
                    onChange={handleChange}
                    type="radio"
                    value="oui"
                  />
                  <div>
                    <strong>{t("yesLabel")}</strong>
                  </div>
                </label>
                <label className="selection-card selection-card--inline">
                  <input
                    checked={formData.lunexStudent === "non"}
                    name="lunexStudent"
                    onChange={handleChange}
                    type="radio"
                    value="non"
                  />
                  <div>
                    <strong>{t("noLabel")}</strong>
                  </div>
                </label>
              </div>
              {formData.lunexStudent === "oui" ? (
                <AuthFormField label={t("lunexProgramLabel")}>
                  <input name="lunexProgram" onChange={handleChange} value={formData.lunexProgram} />
                </AuthFormField>
              ) : null}
            </div>
          </div>

          <div className="panel-grid panel-grid--2">
            <AuthFormField label={t("fieldTshirtSize")}>
              <select name="tshirtSize" onChange={handleChange} value={formData.tshirtSize}>
                <option>S</option>
                <option>M</option>
                <option>L</option>
                <option>XL</option>
              </select>
            </AuthFormField>
            <div />
          </div>

          <AuthFormField label={t("occupationLabel")}>
            <input name="occupation" onChange={handleChange} value={formData.occupation} />
          </AuthFormField>
          <AuthFormField label={t("cmcmExperienceLabel")}>
            <textarea name="cmcmExperience" onChange={handleChange} rows="3" value={formData.cmcmExperience} />
          </AuthFormField>
          <AuthFormField label={t("otherVolunteerExperienceLabel")}>
            <textarea
              name="volunteerExperience"
              onChange={handleChange}
              rows="3"
              value={formData.volunteerExperience}
            />
          </AuthFormField>
          <div className="availability-card">
            <div className="form-section-head">
              <p className="eyebrow">{t("availabilityEyebrow")}</p>
              <h3>{t("availabilityHeading")}</h3>
            </div>
            <p className="availability-lead">{t("availabilityIntro")}</p>
            <div className="notice-card notice-card--warn">
              <strong>{t("mandatorySundayTitle")}</strong>
              <p>{t("mandatorySundayBody")}</p>
            </div>
            <label className="selection-card availability-confirm-card">
              <input
                checked={formData.meetingDayConfirmed}
                name="meetingDayConfirmed"
                onChange={handleChange}
                type="checkbox"
              />
              <div>
                <strong>{t("confirmSundayLabel")}</strong>
                <p>{t("confirmSundayBody")}</p>
              </div>
            </label>
            <p className="availability-subnote">{t("availabilitySubnote")}</p>
            <div className="availability-options">
              {VOLUNTEER_SUPPORT_AVAILABILITY_OPTIONS.map((option) => (
                <label key={option} className="selection-card">
                  <input
                    checked={formData.availability.includes(option)}
                    type="checkbox"
                    onChange={() => toggleAvailabilityOption(option)}
                  />
                  <div>
                    <strong>{formatVolunteerSupportAvailabilityOption(option, t)}</strong>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="language-card">
            <div className="form-section-head">
              <p className="eyebrow">{t("missionPreferencesEyebrow")}</p>
              <h3>{t("missionPreferencesLabel")}</h3>
              <p className="availability-lead">{t("missionPreferencesHint")}</p>
            </div>
            {volunteerRoleOptions.length ? (
              <div className="choice-grid">
                {volunteerRoleOptions.map((option) => (
                  <label key={option} className="selection-card selection-card--compact">
                    <input
                      checked={formData.missionPreferences.includes(option)}
                      type="checkbox"
                      onChange={() => toggleMissionPreferenceOption(option)}
                    />
                    <div><strong>{option}</strong></div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="availability-lead">{t("vpMissionsUnavailable")}</p>
            )}
          </div>
          <AuthFormField label={t("healthSafetyLabel")}>
            <textarea
              name="healthSafetyInfo"
              onChange={handleChange}
              rows="3"
              value={formData.healthSafetyInfo}
            />
          </AuthFormField>

          <div className="selection-card-group">
            <label className="selection-card">
              <input
                checked={formData.retainForNextYear}
                name="retainForNextYear"
                onChange={handleChange}
                type="checkbox"
              />
              <div>
                <strong>{t("nextEditionTitle")}</strong>
                <p>{t("nextEditionBody")}</p>
              </div>
            </label>
            <label className="selection-card">
              <input checked={formData.imageConsent} name="imageConsent" onChange={handleChange} type="checkbox" />
              <div>
                <strong>{t("imageRightsTitle")}</strong>
                <p>{t("imageRightsBody")}</p>
              </div>
            </label>
          </div>

          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
          {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}

          <div className="profile-form__actions">
            <button className="button button--primary" disabled={isSaving || loading} type="submit">
              {isSaving ? t("commonSaving") : volunteerApplication ? t("vpUpdateButton") : t("vpActivateButton")}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function ProfilePage(props) {
  const { Panel } = props;
  const { currentUser, userProfile } = useAuth();
  const { t } = useLanguage();
  const assignmentHistoryEntries = useMemo(
    () => normalizeAssignmentHistoryEntries(userProfile?.assignmentHistoryByEdition),
    [userProfile?.assignmentHistoryByEdition],
  );
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    nextPassword: "",
    confirmPassword: "",
  });
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordStatusMessage, setPasswordStatusMessage] = useState("");
  const [passwordErrorMessage, setPasswordErrorMessage] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFormData({
        firstName: userProfile?.firstName || "",
        lastName: userProfile?.lastName || "",
        phone: userProfile?.phone || "",
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [userProfile]);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
    setStatusMessage("");
    setErrorMessage("");
  }

  function handlePasswordChange(event) {
    const { name, value } = event.target;
    setPasswordForm((current) => ({
      ...current,
      [name]: value,
    }));
    setPasswordStatusMessage("");
    setPasswordErrorMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!currentUser?.uid) return;

    setIsSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "users", currentUser.uid), {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone.trim(),
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(t("accountSaved"));
    } catch {
      setErrorMessage(t("accountSaveError"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    if (!currentUser?.email) return;

    if (!passwordForm.currentPassword || !passwordForm.nextPassword || !passwordForm.confirmPassword) {
      setPasswordErrorMessage(t("accountPasswordFieldsRequired"));
      return;
    }

    if (passwordForm.nextPassword.length < 6) {
      setPasswordErrorMessage(t("accountPasswordTooShort"));
      return;
    }

    if (passwordForm.nextPassword !== passwordForm.confirmPassword) {
      setPasswordErrorMessage(t("accountPasswordMismatch"));
      return;
    }

    setIsSavingPassword(true);
    setPasswordStatusMessage("");
    setPasswordErrorMessage("");

    try {
      const credential = EmailAuthProvider.credential(currentUser.email, passwordForm.currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, passwordForm.nextPassword);
      setPasswordForm({
        currentPassword: "",
        nextPassword: "",
        confirmPassword: "",
      });
      setPasswordStatusMessage(t("accountPasswordUpdated"));
    } catch (error) {
      if (error?.code === "auth/invalid-credential" || error?.code === "auth/wrong-password") {
        setPasswordErrorMessage(t("accountPasswordWrong"));
      } else {
        setPasswordErrorMessage(t("accountPasswordError"));
      }
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{t("accountEyebrow")}</p>
          <h1>{t("accountTitle")}</h1>
          <p>{t("accountIntro")}</p>
        </div>
      </section>
      <section>
        <Panel title={t("accountIdentityTitle")} subtitle={t("accountIdentitySubtitle")}>
          <form className="profile-form" onSubmit={handleSubmit}>
            <div className="panel-grid panel-grid--2">
              <AuthFormField label={t("fieldFirstName")}>
                <input name="firstName" onChange={handleChange} value={formData.firstName} />
              </AuthFormField>
              <AuthFormField label={t("fieldLastName")}>
                <input name="lastName" onChange={handleChange} value={formData.lastName} />
              </AuthFormField>
            </div>
            <div className="panel-grid panel-grid--2">
              <AuthFormField label={t("fieldEmail")} hint={t("accountEmailHint")}>
                <input disabled value={currentUser?.email || ""} />
              </AuthFormField>
              <AuthFormField label={t("fieldPhone")}>
                <PhoneInput name="phone" onChange={handleChange} value={formData.phone} />
              </AuthFormField>
            </div>
            {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
            {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
            <div className="profile-form__actions">
              <button className="button button--primary" disabled={isSaving} type="submit">
                {isSaving ? t("commonSaving") : t("commonSave")}
              </button>
            </div>
          </form>
        </Panel>
      </section>

      <Panel
        title={t("accountHistoryTitle")}
        subtitle={t("accountHistorySubtitle")}
      >
        {assignmentHistoryEntries.length ? (
          <div className="compact-list">
            {assignmentHistoryEntries.map((entry) => (
              <div key={entry.editionId} className="detail-list" style={{ marginBottom: "1rem" }}>
                <div>
                  <dt>{t("accountHistoryEdition")}</dt>
                  <dd>{getEditionLabel(entry.editionId)}</dd>
                </div>
                <div>
                  <dt>{t("accountHistoryStatus")}</dt>
                  <dd>{entry.assignmentStatus || t("accountHistoryPending")}</dd>
                </div>
                <div>
                  <dt>{t("accountHistoryMainRole")}</dt>
                  <dd>{entry.assignedRole || "—"}</dd>
                </div>
                <div>
                  <dt>{t("accountHistoryTeams")}</dt>
                  <dd>{entry.assignedTeams.length ? entry.assignedTeams.join(", ") : "—"}</dd>
                </div>
                <div>
                  <dt>{t("accountHistoryTeamRoles")}</dt>
                  <dd>
                    {entry.teamRoleAssignments.length
                      ? entry.teamRoleAssignments.map((row) => `${row.teamName}: ${row.teamRole}`).join(" · ")
                      : entry.teamRole || "—"}
                  </dd>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-note">{t("accountHistoryEmpty")}</p>
        )}
      </Panel>

      <Panel
        title={t("accountSecurityTitle")}
        subtitle={t("accountSecuritySubtitle")}
      >
        <form className="profile-form" onSubmit={handlePasswordSubmit}>
          <div className="panel-grid panel-grid--2">
            <AuthFormField label={t("accountCurrentPassword")}>
              <input
                name="currentPassword"
                onChange={handlePasswordChange}
                type="password"
                value={passwordForm.currentPassword}
              />
            </AuthFormField>
            <div />
          </div>
          <div className="panel-grid panel-grid--2">
            <AuthFormField label={t("accountNewPassword")}>
              <input
                name="nextPassword"
                onChange={handlePasswordChange}
                type="password"
                value={passwordForm.nextPassword}
              />
            </AuthFormField>
            <AuthFormField label={t("accountConfirmNewPassword")}>
              <input
                name="confirmPassword"
                onChange={handlePasswordChange}
                type="password"
                value={passwordForm.confirmPassword}
              />
            </AuthFormField>
          </div>
          {passwordErrorMessage ? <p className="form-error">{passwordErrorMessage}</p> : null}
          {passwordStatusMessage ? (
            <p className="panel-note panel-note--success">{passwordStatusMessage}</p>
          ) : null}
          <div className="profile-form__actions">
            <button className="button button--primary" disabled={isSavingPassword} type="submit">
              {isSavingPassword ? t("accountPasswordUpdating") : t("accountPasswordButton")}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

export { ProfilePage, VolunteerProfilePage };
