import { useCoquePlan } from "../app/coque-plan/coque-plan-hooks";
import { PlanCanvas, PlanLegend } from "../app/coque-plan/coque-plan-view";

// Venue map public (plan « Site internet » de Accréditations › Plans), affiché seulement une fois
// publié depuis l'éditeur.
export function SiteVenueMap() {
  const { elements, published, loading } = useCoquePlan();
  if (loading || !published) return null;
  return (
    <section className="site-section site-section--alt" id="venue-map">
      <div className="site-container">
        <div className="site-section-header">
          <span className="site-eyebrow">Venue map</span>
          <h2 className="site-heading site-heading--sm">Find your way at the Coque</h2>
          <p className="site-lead">Entrance, tickets, bar, kids&apos; corner and toilets: everything is on the entrance level.</p>
        </div>
        <div className="site-venue-map">
          <div className="site-venue-map__plan">
            <PlanCanvas elements={elements} mapKey="web" lang="en" />
          </div>
          <PlanLegend elements={elements} mapKey="web" lang="en" />
        </div>
      </div>
    </section>
  );
}
