// @ts-nocheck: the project has no React type packages; esbuild builds this file.
import { PlanCard } from "./PlanCard.tsx";

export function PricingPage() {
  return (
    <main>
      <h1>Pricing</h1>
      <PlanCard name="Starter" price="$9" />
    </main>
  );
}
