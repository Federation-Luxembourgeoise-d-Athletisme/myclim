// Textes de la page publique Pré-programme (/programme), en anglais et en
// français. {u12} / {u14} sont remplacés par les années de naissance de
// l'édition, {date} par la date d'ouverture des inscriptions.
const SITE_PREPROGRAMME_COPY = {
  en: {
    heroEyebrow: "Before the main show",
    heroTitle: "Pre-programme",
    heroLead:
      "Youth races, national races, a Special Olympics race, the Business Race and the Influencer Race, on the same track as the elite and before the main programme.",
    heroFrom: "From {time}",
    heroRegister: "Register",
    heroSchedule: "See the schedule",
    dateTbc: "Date to be announced",

    profilesTitle: "I want to take part",
    statusOpen: "Registration open",
    statusOpensOn: "Opens {date}",
    freeAdultEntry: "Free adult entry",
    youthTitle: "My child",
    youthBody: "U12 born {u12} · U14 born {u14} · licensed in a Luxembourg club · or basket carrier",
    youthCta: "Register a child",
    athleteTitle: "Athlete",
    athleteBody: "National races 60 m and 800 m · 8 and 6 places per race · selection on performance",
    athleteCta: "Apply",
    companyTitle: "Company",
    companyBody: "Business Race · mixed 4 × 200 m relay · 6 companies maximum",
    companyStatus: "Limited places",
    companyCta: "See the packs",
    spectatorTitle: "Spectator",
    spectatorBody: "One ticket for the whole meeting: come early, the pre-programme starts before the elite.",
    spectatorStatus: "Free adult entry for pre-programme athletes",
    spectatorCta: "Get tickets",

    scheduleTitle: "Schedule",
    scheduleNote: "Times may still change slightly; the final timetable is published a few days before the meeting.",

    eventsTitle: "The races",
    youthEventTitle: "Youth races",
    youthEventBody:
      "Luxembourg's youngest licensed athletes race on the same track as the elite. Places are allocated in order of complete applications, then a waiting list applies.",
    youthEventAges: "U12 born {u12} · U14 born {u14} · Luxembourg licence",
    youthEventFacts: ["U12 60 m · U14 60 m and 1000 m", "One race per child", "Basket carrier also possible"],
    nationalEventTitle: "National races",
    nationalEventBody:
      "Women's and men's 60 m and 800 m, run by the athletes' commission. Selection is based on performance, with priority to Luxembourg licence holders; the organisers then handle the entries of selected athletes.",
    nationalEventFacts: ["8 places per 60 m race, 6 per 800 m race", "Foreign athletes may be accepted", "Under 18: explicit parental consent"],
    specialOlympicsTitle: "Special Olympics race",
    specialOlympicsBody:
      "An inclusive race in front of the full meeting audience, celebrating personal achievement and sport for all.",
    specialOlympicsFacts: ["Inclusion at the heart of a top-level meeting", "Every athlete celebrated by the crowd"],
    influencerTitle: "Influencer Race",
    influencerBody:
      "Two 60 m races, one for women and one for men: Luxembourg influencers go head-to-head with local sports stars.",
    influencerFacts: ["Women's and men's 60 m", "Elite sport meets social media"],
    influencerCta: "Follow on Instagram",

    businessEyebrow: "Corporate experience",
    businessTitle: "Business Race",
    businessLead:
      "Six Luxembourg companies race side by side in front of the meeting audience: team spirit, sport and a premium brand experience.",
    businessFormat: "Mixed 4 × 200 m relay · 2 women and 2 men · official presentation, podium and speaker",
    businessWinner: "The winning company hands out a Winner Card during the main programme.",
    pack1Title: "Business Race Experience",
    pack1Price: "€250",
    pack1Items: ["1 team in the relay", "Baton-passing training", "Optional lunch before the event", "4 VIP and 8 standard places"],
    pack2Title: "Business Team Building",
    pack2Price: "From €1,500",
    pack2Note: "From 15 participants · about 15 days before the meeting",
    pack2Items: [
      "1 team in the relay",
      "Team-building session with an FLA elite athlete",
      "Talk on performance, motivation or leadership",
      "10 VIP places",
    ],
    formTitle: "Request a place",
    formCompany: "Company",
    formContact: "Contact name",
    formPack: "Pack",
    formSubmit: "Write to us",
    formHint: "Opens your email app with a pre-filled message to communication@fla.lu.",
    formError: "Fill in the company and the contact name.",
    mailSubject: "Business Race {year} – {company} – {pack}",
    mailBody: "Hello,\n\nWe would like to take part in the Business Race {year}.\n\nCompany: {company}\nContact: {contact}\nPack: {pack}\n\n",

    faqTitle: "Frequently asked questions",
    faq: [
      { q: "Which birth years for U12 and U14?", a: "For this edition: U12 = born {u12}, U14 = born {u14}." },
      {
        q: "Where do I find my FLA bib number?",
        a: "It's the bib number given by the FLA, not the licence number. Your club can give it to you.",
      },
      {
        q: "How are national race athletes selected?",
        a: "The athletes' commission selects on performance (personal best, 2026 best or other relevant times), with priority to Luxembourg licence holders.",
      },
      {
        q: "When do we get the decision?",
        a: "You'll receive an email, and the status is visible in your MyCLIM space.",
      },
      {
        q: "Do participants need a ticket?",
        a: "One ticket gives access to the whole meeting. Pre-programme athletes get a free adult entry.",
      },
      {
        q: "Can I register more than one child?",
        a: "Yes, as many as you like in the same form, and more later from your parent space.",
      },
    ],

    finalTitle: "Ready to take part?",
    finalYouth: "Register a child",
    finalNational: "Apply for a national race",
    finalBusiness: "Book a Business Race team",
  },
  fr: {
    heroEyebrow: "Avant le grand spectacle",
    heroTitle: "Pré-programme",
    heroLead:
      "Courses jeunes, courses nationales, course Special Olympics, Business Race et Influencer Race, sur la même piste que l'élite et avant le programme principal.",
    heroFrom: "À partir de {time}",
    heroRegister: "S'inscrire",
    heroSchedule: "Voir le déroulé",
    dateTbc: "Date bientôt annoncée",

    profilesTitle: "Je veux participer",
    statusOpen: "Inscriptions ouvertes",
    statusOpensOn: "Ouverture le {date}",
    freeAdultEntry: "Entrée adulte offerte",
    youthTitle: "Mon enfant",
    youthBody: "U12 nés en {u12} · U14 nés en {u14} · licenciés dans un club luxembourgeois · ou porte-panier",
    youthCta: "Inscrire un enfant",
    athleteTitle: "Athlète",
    athleteBody: "Courses nationales 60 m et 800 m · 8 et 6 places par course · sélection sur performance",
    athleteCta: "Postuler",
    companyTitle: "Entreprise",
    companyBody: "Business Race · relais mixte 4 × 200 m · 6 entreprises maximum",
    companyStatus: "Places limitées",
    companyCta: "Voir les packs",
    spectatorTitle: "Spectateur",
    spectatorBody: "Un seul billet pour tout le meeting : venez tôt, le pré-programme commence avant l'élite.",
    spectatorStatus: "Entrée adulte offerte aux athlètes du pré-programme",
    spectatorCta: "Billetterie",

    scheduleTitle: "Déroulé",
    scheduleNote: "Les horaires peuvent encore bouger légèrement ; l'horaire définitif est publié quelques jours avant le meeting.",

    eventsTitle: "Les courses",
    youthEventTitle: "Courses jeunes",
    youthEventBody:
      "Les plus jeunes licenciés luxembourgeois courent sur la même piste que l'élite. Les places sont attribuées dans l'ordre des dossiers complets, puis une liste d'attente s'applique.",
    youthEventAges: "U12 nés en {u12} · U14 nés en {u14} · licence luxembourgeoise",
    youthEventFacts: ["U12 60 m · U14 60 m et 1000 m", "Une course par enfant", "Porte-panier également possible"],
    nationalEventTitle: "Courses nationales",
    nationalEventBody:
      "60 m et 800 m femmes et hommes, pilotés par la commission des athlètes. La sélection se fait sur performance, avec priorité aux licenciés luxembourgeois ; l'organisation engage ensuite les athlètes retenus.",
    nationalEventFacts: ["8 places par course de 60 m, 6 par course de 800 m", "Athlètes étrangers possibles", "Moins de 18 ans : accord parental explicite"],
    specialOlympicsTitle: "Course Special Olympics",
    specialOlympicsBody:
      "Une course inclusive devant tout le public du meeting, qui célèbre la réussite de chacun et le sport pour tous.",
    specialOlympicsFacts: ["L'inclusion au cœur d'un meeting de haut niveau", "Chaque athlète porté par le public"],
    influencerTitle: "Influencer Race",
    influencerBody:
      "Deux 60 m, un femmes et un hommes : des influenceurs luxembourgeois face à des stars du sport local.",
    influencerFacts: ["60 m femmes et hommes", "Le sport de haut niveau rencontre les réseaux sociaux"],
    influencerCta: "Suivre sur Instagram",

    businessEyebrow: "Expérience entreprise",
    businessTitle: "Business Race",
    businessLead:
      "Six entreprises luxembourgeoises courent côte à côte devant le public du meeting : esprit d'équipe, sport et une expérience de marque haut de gamme.",
    businessFormat: "Relais mixte 4 × 200 m · 2 femmes et 2 hommes · présentation officielle, podium et speaker",
    businessWinner: "L'entreprise gagnante remet une Winner Card pendant le programme principal.",
    pack1Title: "Business Race Experience",
    pack1Price: "250 €",
    pack1Items: ["1 équipe dans le relais", "Entraînement au passage de témoin", "Déjeuner avant l'événement en option", "4 places VIP et 8 places standard"],
    pack2Title: "Business Team Building",
    pack2Price: "À partir de 1 500 €",
    pack2Note: "Dès 15 participants · environ 15 jours avant le meeting",
    pack2Items: [
      "1 équipe dans le relais",
      "Séance de team building avec un athlète élite de la FLA",
      "Conférence sur la performance, la motivation ou le leadership",
      "10 places VIP",
    ],
    formTitle: "Demander une place",
    formCompany: "Entreprise",
    formContact: "Nom du contact",
    formPack: "Pack",
    formSubmit: "Nous écrire",
    formHint: "Ouvre votre messagerie avec un message pré-rempli à communication@fla.lu.",
    formError: "Indiquez l'entreprise et le nom du contact.",
    mailSubject: "Business Race {year} – {company} – {pack}",
    mailBody: "Bonjour,\n\nNous souhaitons participer à la Business Race {year}.\n\nEntreprise : {company}\nContact : {contact}\nPack : {pack}\n\n",

    faqTitle: "Questions fréquentes",
    faq: [
      { q: "Quelles années de naissance pour les U12 et U14 ?", a: "Pour cette édition : U12 = nés en {u12}, U14 = nés en {u14}." },
      {
        q: "Où trouver mon numéro de dossard FLA ?",
        a: "C'est le numéro de dossard attribué par la FLA, pas le numéro de licence. Votre club peut vous le donner.",
      },
      {
        q: "Comment sont sélectionnés les athlètes des courses nationales ?",
        a: "La commission des athlètes sélectionne sur performance (record personnel, meilleure perf. 2026 ou autres temps pertinents), avec priorité aux licenciés luxembourgeois.",
      },
      {
        q: "Quand reçoit-on la décision ?",
        a: "Vous recevez un email, et le statut est visible dans votre espace MyCLIM.",
      },
      {
        q: "Les participants ont-ils besoin d'un billet ?",
        a: "Un seul billet donne accès à tout le meeting. Les athlètes du pré-programme ont une entrée adulte offerte.",
      },
      {
        q: "Puis-je inscrire plusieurs enfants ?",
        a: "Oui, autant que vous voulez dans le même formulaire, puis d'autres plus tard depuis votre espace parent.",
      },
    ],

    finalTitle: "Prêt à participer ?",
    finalYouth: "Inscrire un enfant",
    finalNational: "Postuler aux courses nationales",
    finalBusiness: "Réserver une équipe Business Race",
  },
};

function getSitePreprogrammeCopy(language) {
  return SITE_PREPROGRAMME_COPY[language] || SITE_PREPROGRAMME_COPY.en;
}

export { getSitePreprogrammeCopy };
