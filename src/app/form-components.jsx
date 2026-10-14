import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import cmcmLogo from "../assets/cmcm-logo.png";
import { LanguageSwitch } from "./language";
import { useLanguage } from "./language-context";
import { PHONE_COUNTRY_OPTIONS, buildPhoneValue, parsePhoneValue } from "./utils";

function AuthLayout({ title, subtitle, children, sideCard, headerContent, languages }) {
  const { t } = useLanguage();

  return (
    <div className="auth-page">
      <section className="auth-page-header">
        <div className="auth-header-shell">
          <div className="auth-header-brand">
            <div className="auth-header-logo-shell">
              <img alt="Logo CMCM Luxembourg Indoor Meeting" className="auth-header-logo" src={cmcmLogo} />
            </div>
            <div className="auth-header-copy">
              <div className="hero-badge">{t("myclim")}</div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          <div className="auth-header-actions">
            {headerContent ? <div className="auth-header-extra">{headerContent}</div> : null}
            <LanguageSwitch languages={languages} />
            <NavLink className="auth-header-link" to="/">
              {t("returnHome")}
            </NavLink>
          </div>
        </div>
      </section>
      <section className={`auth-page-body ${sideCard ? "" : "auth-page-body--single"}`.trim()}>
        <div className="auth-panel auth-panel--form">{children}</div>
        {sideCard ? <aside className="auth-side-card">{sideCard}</aside> : null}
      </section>
    </div>
  );
}

function AuthFormField({ label, children, hint, required = false }) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? <span className="field-required" aria-hidden="true"> *</span> : null}
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function PhoneInput({
  name,
  value,
  onChange,
  required = false,
  placeholder,
}) {
  const { t, language } = useLanguage();
  const phoneParts = useMemo(() => parsePhoneValue(value), [value]);
  const [countryCode, setCountryCode] = useState(phoneParts.countryCode);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const pickerRef = useRef(null);
  const effectiveCountryCode = String(value || "").trim() ? phoneParts.countryCode : countryCode;

  const countryOptions = useMemo(() => {
    let regionNames = null;
    try {
      regionNames = new Intl.DisplayNames([language], { type: "region" });
    } catch {
      regionNames = null;
    }

    return PHONE_COUNTRY_OPTIONS.map((option) => ({
      ...option,
      label: regionNames?.of(option.region) || option.label,
    }));
  }, [language]);

  const filteredCountryOptions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return countryOptions;

    return countryOptions.filter((option) => {
      const countryLabel = option.label.toLowerCase();
      return countryLabel.includes(normalizedSearch) || option.code.includes(normalizedSearch);
    });
  }, [countryOptions, searchTerm]);

  useEffect(() => {
    if (!isPickerOpen) return undefined;

    function handlePointerDown(event) {
      if (!pickerRef.current?.contains(event.target)) {
        setIsPickerOpen(false);
        setSearchTerm("");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isPickerOpen]);

  function emitChange(nextCountryCode, nextLocalNumber) {
    onChange({
      target: {
        name,
        value: buildPhoneValue(nextCountryCode, nextLocalNumber),
        type: "text",
      },
    });
  }

  function handleCountrySelect(nextCountryCode) {
    setCountryCode(nextCountryCode);
    emitChange(nextCountryCode, phoneParts.localNumber);
    setIsPickerOpen(false);
    setSearchTerm("");
  }

  function handleNumberChange(event) {
    emitChange(effectiveCountryCode, event.target.value);
  }

  return (
    <div className="phone-input">
      <div className="phone-picker" ref={pickerRef}>
        <button
          aria-expanded={isPickerOpen}
          aria-haspopup="listbox"
          className="phone-picker__trigger"
          onClick={() => setIsPickerOpen((current) => !current)}
          type="button"
        >
          <span>{effectiveCountryCode}</span>
          <span className="phone-picker__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {isPickerOpen ? (
          <div className="phone-picker__popover">
            <input
              autoFocus
              className="phone-picker__search"
              inputMode="search"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t("phoneSearchCountry")}
              value={searchTerm}
            />
            <div className="phone-picker__list" role="listbox">
              {filteredCountryOptions.map((option) => (
                <button
                  className={`phone-picker__option${option.code === effectiveCountryCode ? " phone-picker__option--active" : ""}`}
                  key={option.code}
                  onClick={() => handleCountrySelect(option.code)}
                  type="button"
                >
                  <span>{option.code}</span>
                  <small>{option.label}</small>
                </button>
              ))}
              {filteredCountryOptions.length === 0 ? (
                <p className="phone-picker__empty">{t("phoneNoCountryFound")}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <input
        autoComplete="tel-national"
        className="phone-input__number"
        inputMode="tel"
        name={name}
        onChange={handleNumberChange}
        placeholder={placeholder ?? t("phoneLocalNumberPlaceholder")}
        required={required}
        type="tel"
        value={phoneParts.localNumber}
      />
    </div>
  );
}

export { AuthFormField, AuthLayout, PhoneInput };
