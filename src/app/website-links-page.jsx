import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { DEFAULT_LINKS_PAGE, LINKS_PAGE_BLOCKS, PUBLIC_LINKS_URL } from "../site/links-page-config";
import { saveLinksPageSettings, useLinksPageSettings } from "../site/site-hooks";
import { AuthFormField } from "./form-components";
import "./website-links-page.css";

// Admin de la page « liens » grand public (/links) : liens éditables, blocs
// affichés et QR code à imprimer. Les infos d'édition (date, lieu, résultats,
// streaming, horaire, e-magazine) se règlent dans « Édition courante ».

function setIn(object, path, value) {
  const [head, ...rest] = path;
  return { ...object, [head]: rest.length ? setIn(object?.[head] || {}, rest, value) : value };
}

function getIn(object, path) {
  return path.reduce((value, key) => value?.[key], object);
}

// Champs définis hors du composant de page pour ne pas perdre le focus à
// chaque frappe (un composant recréé à chaque rendu remonte son <input>).
function TextField({ draft, onChange, label, path, placeholder, type = "text", hint }) {
  return (
    <AuthFormField label={label} hint={hint}>
      <input type={type} value={getIn(draft, path) || ""} placeholder={placeholder} onChange={(event) => onChange(path, event.target.value)} />
    </AuthFormField>
  );
}

function LocalizedField({ draft, onChange, label, path, hint }) {
  return (
    <div className="links-admin-pair">
      <TextField draft={draft} onChange={onChange} label={`${label} (FR)`} path={[...path, "fr"]} hint={hint} />
      <TextField draft={draft} onChange={onChange} label={`${label} (EN)`} path={[...path, "en"]} />
    </div>
  );
}

function WebsiteLinksPage({ Panel }) {
  const { settings, loading } = useLinksPageSettings();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [qr, setQr] = useState({ png: "", svg: "" });

  useEffect(() => {
    if (!loading && draft === null) setDraft(settings);
  }, [draft, loading, settings]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      QRCode.toDataURL(PUBLIC_LINKS_URL, { errorCorrectionLevel: "M", margin: 2, width: 1200 }),
      QRCode.toString(PUBLIC_LINKS_URL, { type: "svg", errorCorrectionLevel: "M", margin: 2 }),
    ])
      .then(([png, svg]) => {
        if (!cancelled) setQr({ png, svg: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
      })
      .catch((qrError) => console.error("Links page QR generation failed", qrError));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!draft) {
    return (
      <Panel title="Page liens (QR code)" subtitle="Chargement…">
        <p className="panel-note">Chargement des réglages…</p>
      </Panel>
    );
  }

  function update(path, value) {
    setMessage(null);
    setDraft((current) => setIn(current, path, value));
  }

  const fieldProps = { draft, onChange: update };

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await saveLinksPageSettings(draft);
      setMessage({ type: "ok", text: "Page liens enregistrée. Elle est à jour sur le site." });
    } catch (saveError) {
      console.error("Links page save failed", saveError);
      setMessage({ type: "error", text: "Enregistrement impossible. Vérifie ta connexion et tes droits (site web)." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave}>
      <Panel
        title="Page liens (QR code)"
        subtitle="La page que le public ouvre en scannant le QR code affiché à la Coque. Les résultats en direct, le streaming, l'horaire, la date et le lieu viennent de « Édition courante »."
        actions={
          <a className="button button--secondary button--small" href="/links" target="_blank" rel="noreferrer">
            Voir la page
          </a>
        }
      >
        <div className="links-admin-qr">
          {qr.png ? <img src={qr.png} alt={`QR code vers ${PUBLIC_LINKS_URL}`} /> : <div className="links-admin-qr__placeholder" />}
          <div>
            <p>
              Le QR code ouvre <strong>{PUBLIC_LINKS_URL}</strong>. Il ne change jamais : tu peux l'imprimer dès maintenant et modifier les liens
              ensuite.
            </p>
            <div className="links-admin-actions">
              <a className="button button--primary button--small" href={qr.png || undefined} download="qr-cmcm-links.png">
                Télécharger le QR (PNG)
              </a>
              <a className="button button--secondary button--small" href={qr.svg || undefined} download="qr-cmcm-links.svg">
                Télécharger le QR (SVG, impression)
              </a>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Mode « jour J »" subtitle="Le jour J, la page met en avant les résultats et le direct, et affiche « Maintenant sur la piste ».">
        <div className="links-admin-radios" role="radiogroup" aria-label="Mode jour J">
          {[
            ["auto", "Automatique : le jour de l'édition"],
            ["on", "Forcé : toujours en mode jour J"],
            ["off", "Désactivé"],
          ].map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="liveMode" value={value} checked={draft.liveMode === value} onChange={() => update(["liveMode"], value)} />
              {label}
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="Blocs affichés" subtitle="Un bloc sans lien ou sans contenu reste masqué automatiquement.">
        <div className="links-admin-blocks">
          {LINKS_PAGE_BLOCKS.map((block) => (
            <label key={block.key}>
              <input type="checkbox" checked={draft.blocks[block.key] !== false} onChange={(event) => update(["blocks", block.key], event.target.checked)} />
              {block.label}
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="Photos" subtitle="Tant que la galerie du meeting est vide, la page montre la galerie de l'édition précédente.">
        <div className="auth-form auth-form--compact links-admin-form">
          <TextField
            {...fieldProps}
            label="Galerie du meeting (Sprintshot, le jour J)"
            path={["photos", "currentUrl"]}
            type="url"
            placeholder="https://…"
            hint="Dès qu'elle est remplie, elle remplace la galerie de l'édition précédente."
          />
          <TextField
            {...fieldProps}
            label="Crédit à mentionner"
            path={["photos", "currentCredit"]}
            placeholder={DEFAULT_LINKS_PAGE.photos.currentCredit}
            hint="Affiché avec « Gratuites — merci de créditer … », uniquement pour la galerie du meeting."
          />
          <TextField {...fieldProps} label="Galerie de l'édition précédente" path={["photos", "previousUrl"]} type="url" placeholder="https://flaphoto.net/…" />
          <LocalizedField {...fieldProps} label="Titre de la galerie précédente" path={["photos", "previousLabel"]} />
        </div>
      </Panel>

      <Panel title="Billets">
        <div className="auth-form auth-form--compact links-admin-form">
          <TextField {...fieldProps} label="Lien de la billetterie" path={["tickets", "url"]} type="url" placeholder="https://www.ticket-regional.lu/" />
          <LocalizedField {...fieldProps} label="Texte avant le meeting" path={["tickets", "note"]} />
          <LocalizedField {...fieldProps} label="Texte le jour J" path={["tickets", "dayNote"]} />
        </div>
      </Panel>

      <Panel title="Venir à la Coque" subtitle="Les lignes vides ne s'affichent pas.">
        <div className="auth-form auth-form--compact links-admin-form">
          <LocalizedField {...fieldProps} label="Ouverture des portes" path={["access", "doors"]} hint="Ex. : Ouverture des portes à 14:00" />
          <LocalizedField {...fieldProps} label="Transports" path={["access", "transport"]} />
          <LocalizedField {...fieldProps} label="Parking" path={["access", "parking"]} />
          <TextField {...fieldProps} label="Lien « Itinéraire »" path={["access", "mapsUrl"]} type="url" placeholder="https://www.google.com/maps/…" />
          <TextField {...fieldProps} label="Lien « Infos pratiques »" path={["access", "infoUrl"]} placeholder="/event" hint="Une page du site (ex. /event) ou une adresse complète." />
        </div>
      </Panel>

      <Panel title="Réseaux sociaux et contact" subtitle="Laisse un champ vide pour masquer le réseau.">
        <div className="auth-form auth-form--compact links-admin-form">
          <TextField {...fieldProps} label="Instagram" path={["social", "instagram"]} type="url" />
          <TextField {...fieldProps} label="Facebook" path={["social", "facebook"]} type="url" />
          <TextField {...fieldProps} label="YouTube" path={["social", "youtube"]} type="url" />
          <TextField {...fieldProps} label="E-mail de contact" path={["contactEmail"]} type="email" />
        </div>
      </Panel>

      <div className="links-admin-save">
        {message ? <p className={message.type === "ok" ? "panel-note panel-note--success" : "form-error"}>{message.text}</p> : null}
        <button className="button button--primary" type="submit" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer la page liens"}
        </button>
      </div>
    </form>
  );
}

export { WebsiteLinksPage };
